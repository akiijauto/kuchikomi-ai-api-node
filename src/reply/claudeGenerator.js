import Anthropic from '@anthropic-ai/sdk';

import { systemPrompt, trimJsonFence, userPrompt, withSignature } from './prompt.js';

/**
 * Anthropic Messages API を公式SDK(@anthropic-ai/sdk)で呼ぶ生成器。
 *
 * PHP版は公式SDKを使わずcurlで直接叩いている（Go版が最小限の依存で書かれて
 * いたのに合わせた判断）。Node版で公式SDKを使うのは、再送・タイムアウト・
 * エラーの型分けを自前で書き直す理由がないため。fetch で書くと、
 * 429と5xxの再送を自分で実装することになる。
 *
 * APIキーが空のときはこのクラスを作らない設計になっている（呼び出し側がMockを選ぶ）。
 */

// 他の4実装と同じ既定値。
// 5実装で同じモデル・同じプロンプトにしておかないと、出力の違いが
// 「言語の違い」なのか「設定の違い」なのか分からなくなる。
// **新しいモデルへ替えるときは5実装をまとめて替える。ここだけ替えない。**
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MAX_TOKENS = 2048;

// 返信案の形。構造化出力(output_config.format)で形を保証させ、
// 「JSONのつもりが散文だった」を実行時に持ち込まないようにする（Go版と同じ）。
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['label', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['replies'],
  additionalProperties: false,
};

export class ClaudeGenerator {
  #client;
  #model;

  constructor(apiKey, model = DEFAULT_MODEL, { timeoutMs = 30_000, client } = {}) {
    // @anthropic-ai/sdk の timeout はミリ秒（PHPのcurlは秒）。
    // ここを秒のつもりで 30 と書くと30ミリ秒で打ち切られ、必ず失敗する。
    this.#client = client ?? new Anthropic({ apiKey, timeout: timeoutMs });
    this.#model = model;
  }

  get model() {
    return this.#model;
  }

  async generate(profile, review) {
    const message = await this.#client.messages.create({
      model: this.#model,
      max_tokens: MAX_TOKENS,
      // 返信文の作成に長い推論は要らない。既定のまま投げると
      // 待ち時間とトークンを無駄に使う（Go版・Ruby版・PHP版と同じ設定に揃えてある）。
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: REPLY_SCHEMA },
      },
      system: [{ type: 'text', text: systemPrompt(profile) }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(review) }] }],
    });

    const replies = parseReplies(extractText(message));

    return { replies: withSignature(replies, profile.signature), mock: false };
  }
}

/** レスポンスの content 配列から最初のテキストブロックを取り出す。 */
function extractText(message) {
  const block = message?.content?.find((b) => b?.type === 'text' && typeof b.text === 'string');
  if (block === undefined) {
    throw new Error('生成結果が空でした');
  }

  return block.text;
}

/**
 * 生成結果を返信案の配列にする。
 *
 * SDKの返り値は形が保証されていないものとして扱い、1つでも欠けていれば
 * 全体を失敗にする。**部分的な結果を返さない**（3案のうち2案だけ返ると、
 * 呼び出し側は成功として扱ってしまう）。
 */
function parseReplies(text) {
  let parsed;
  try {
    parsed = JSON.parse(trimJsonFence(text));
  } catch {
    throw new Error('生成結果を読み取れませんでした');
  }

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.replies)) {
    throw new Error('生成結果を読み取れませんでした');
  }

  if (parsed.replies.length === 0) {
    throw new Error('返信案が1件も返りませんでした');
  }

  return parsed.replies.map((item) => {
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof item.label !== 'string' ||
      typeof item.text !== 'string'
    ) {
      throw new Error('生成結果を読み取れませんでした');
    }

    // Go版の構造体では見出しのフィールド名が Label だが、
    // 呼び出し側の契約では style という名前を使う（PHP版 ReplyItem と同じ）。
    return { style: item.label, text: item.text };
  });
}
