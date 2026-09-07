import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ClaudeGenerator, DEFAULT_MODEL } from '../src/reply/claudeGenerator.js';
import { MockGenerator } from '../src/reply/mockGenerator.js';
import { systemPrompt, trimJsonFence, withSignature } from '../src/reply/prompt.js';
import { profile } from './fakes.js';

/**
 * 外部へ通信する部分は試さない（APIキーも課金も要るため）。
 * 差し替え可能なクライアントを渡して、送る中身と受け取った結果の扱いだけを見る。
 */
function fakeClient(text, capture = {}) {
  return {
    messages: {
      async create(body) {
        capture.body = body;

        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

describe('モデルの既定値', () => {
  it('他の4実装と同じ', () => {
    // ここがずれると、同じ入力に対して実装ごとに違う返信が返り、
    // 「言語の違い」なのか「設定の違い」なのか分からなくなる。
    assert.equal(DEFAULT_MODEL, 'claude-sonnet-4-6');
  });

  it('引数を省略したときだけ既定値が効く', () => {
    // JavaScriptの既定引数は「undefined のとき」にしか効かない。
    // 空文字を渡すと空のまま通り、モデル名が空でAPIを叩くことになる。
    // Kernel が空なら引数ごと省略しているのはこのため。
    assert.equal(new ClaudeGenerator('dummy', undefined, { client: fakeClient('{}') }).model, DEFAULT_MODEL);
    assert.equal(new ClaudeGenerator('dummy', '', { client: fakeClient('{}') }).model, '');
  });
});

describe('リクエストの中身', () => {
  it('推論を切り、構造化出力で形を固定して送る', async () => {
    const capture = {};
    const body = JSON.stringify({ replies: [{ label: '標準', text: 'ありがとうございます' }] });
    const generator = new ClaudeGenerator('dummy', undefined, { client: fakeClient(body, capture) });

    await generator.generate(profile({ signature: '' }), { text: 'とても良い', rating: 5 });

    assert.equal(capture.body.model, DEFAULT_MODEL);
    assert.deepEqual(capture.body.thinking, { type: 'disabled' });
    assert.equal(capture.body.output_config.effort, 'low');
    assert.equal(capture.body.output_config.format.type, 'json_schema');
    assert.equal(capture.body.system[0].text, systemPrompt(profile({ signature: '' })));
  });
});

describe('生成結果の読み取り', () => {
  it('labelをstyleへ移し、署名を末尾に付ける', async () => {
    const body = JSON.stringify({ replies: [{ label: '標準', text: '本文' }] });
    const generator = new ClaudeGenerator('dummy', undefined, { client: fakeClient(body) });

    const result = await generator.generate(profile({ signature: '店主' }), {
      text: 'とても良い',
      rating: 5,
    });

    assert.equal(result.mock, false);
    assert.deepEqual(result.replies, [{ style: '標準', text: '本文\n\n店主' }]);
  });

  it('コードフェンスで囲まれていても読める', async () => {
    const body = '```json\n{"replies":[{"label":"標準","text":"本文"}]}\n```';
    const generator = new ClaudeGenerator('dummy', undefined, { client: fakeClient(body) });

    const result = await generator.generate(profile({ signature: '' }), {
      text: 'とても良い',
      rating: 5,
    });

    assert.equal(result.replies[0].text, '本文');
  });

  for (const [name, body] of [
    ['JSONでない', 'こんにちは'],
    ['repliesが無い', '{"foo":1}'],
    ['repliesが空', '{"replies":[]}'],
    ['labelが欠けている', '{"replies":[{"text":"本文"}]}'],
    ['textが数値', '{"replies":[{"label":"標準","text":1}]}'],
  ]) {
    it(`${name} なら失敗させる（部分的な結果を返さない）`, async () => {
      const generator = new ClaudeGenerator('dummy', undefined, { client: fakeClient(body) });

      await assert.rejects(() =>
        generator.generate(profile(), { text: 'とても良い', rating: 5 }),
      );
    });
  }
});

describe('プロンプトの組み立て', () => {
  it('未知の文体は polite にフォールバックする', () => {
    assert.ok(systemPrompt(profile({ tone: 'unknown' })).includes('敬語を基本とした'));
    assert.ok(systemPrompt(profile({ tone: 'casual' })).includes('常連客に話しかける'));
  });

  it('署名が空なら何も足さない', () => {
    const replies = [{ style: 'a', text: 'b' }];

    assert.deepEqual(withSignature(replies, ''), replies);
  });

  it('署名を足しても元の配列を書き換えない', () => {
    const replies = [{ style: 'a', text: 'b' }];
    withSignature(replies, '店主');

    assert.equal(replies[0].text, 'b');
  });

  it('コードフェンスの除去', () => {
    assert.equal(trimJsonFence('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(trimJsonFence('```\n{"a":1}\n```'), '{"a":1}');
    assert.equal(trimJsonFence('{"a":1}'), '{"a":1}');
  });
});

describe('モックの生成器', () => {
  it('低評価と高評価で内容を変え、常に3案返す', async () => {
    const low = await new MockGenerator().generate(profile(), { text: 'x', rating: 1 });
    const high = await new MockGenerator().generate(profile(), { text: 'x', rating: 5 });

    assert.equal(low.replies.length, 3);
    assert.equal(high.replies.length, 3);
    assert.equal(low.mock, true);
    assert.ok(low.replies[0].text.includes('申し訳'));
    assert.ok(!high.replies[0].text.includes('申し訳'));
  });
});
