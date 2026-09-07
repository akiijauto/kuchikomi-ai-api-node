import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GenerateHandler } from '../src/handlers/generate.js';
import { Request } from '../src/http/request.js';
import { LimitExceeded, PlanNotFound } from '../src/store/errors.js';
import { FakeGenerator, FakeProfileStore, FakeUsageStore, profile } from './fakes.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

function request(body) {
  return new Request('POST', '/api/generate', {}, body);
}

/** 正常に通る組み合わせで組み立てる。壊したい部分だけ差し替えて使う。 */
function handler(profiles = null, usage = null, generator = null) {
  return new GenerateHandler(
    profiles ?? new FakeProfileStore(profile()),
    usage ?? new FakeUsageStore(1),
    generator ?? new FakeGenerator(),
  );
}

const VALID_BODY = JSON.stringify({ review: { reviewText: 'とても良い店', rating: 5 } });

describe('壊れた入力と、形が違う入力を分ける', () => {
  it('JSONとして壊れていれば「不正なリクエストです」', async () => {
    const res = await handler().handle(request('{"review":'), USER_ID);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '不正なリクエストです');
  });

  it('JSONではあるが形が違えば別の文言', async () => {
    // 「壊れている」と「形が違う」を同じ文言にしてしまうと、
    // 送り手はどちらを直せばよいのか分からない。
    const res = await handler().handle(request('{"foo":1}'), USER_ID);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '入力内容を確認してください');
  });

  it('reviewが配列でも形が違うとして弾く', async () => {
    // typeof [] === 'object' なので、配列を外し忘れると素通りする。
    const res = await handler().handle(request('{"review":[]}'), USER_ID);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '入力内容を確認してください');
  });
});

describe('文字数の数え方', () => {
  it('日本語5文字は通る', async () => {
    // 「とても良い」はちょうど5文字。UTF-8では15バイトある。
    const body = JSON.stringify({ review: { reviewText: 'とても良い', rating: 5 } });

    assert.equal((await handler().handle(request(body), USER_ID)).status, 200);
  });

  it('日本語2文字はバイト数では6でも弾かれる', async () => {
    const body = JSON.stringify({ review: { reviewText: '美味', rating: 5 } });
    const res = await handler().handle(request(body), USER_ID);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '入力内容を確認してください');
  });

  it('4文字は短すぎるので弾かれる', async () => {
    const body = JSON.stringify({ review: { reviewText: 'abcd', rating: 3 } });

    assert.equal((await handler().handle(request(body), USER_ID)).status, 400);
  });

  it('2000文字は通り2001文字は弾かれる', async () => {
    const ok = JSON.stringify({ review: { reviewText: 'あ'.repeat(2000), rating: 3 } });
    assert.equal((await handler().handle(request(ok), USER_ID)).status, 200);

    const ng = JSON.stringify({ review: { reviewText: 'あ'.repeat(2001), rating: 3 } });
    assert.equal((await handler().handle(request(ng), USER_ID)).status, 400);
  });

  it('BMP外の文字はコードポイントで数える（JavaScript固有の落とし穴）', async () => {
    // 「𩸽」は UTF-16 では2コード単位。text.length で数えると
    // 「𩸽𩸽𩸽」(3文字) が 6 と判定され、5文字未満の入力が通ってしまう。
    // 他の4実装(PHP mb_strlen / Ruby length / Go RuneCountInString)は
    // どれもコードポイントで数えるので、そこだけ答えが食い違う。
    const three = '𩸽𩸽𩸽';
    assert.equal(three.length, 6, 'UTF-16では6コード単位');
    assert.equal([...three].length, 3, 'コードポイントでは3文字');

    const body = JSON.stringify({ review: { reviewText: three, rating: 5 } });
    const res = await handler().handle(request(body), USER_ID);

    assert.equal(res.status, 400, '3文字なので弾かれる');
  });
});

describe('星の値', () => {
  // 生のJSONで書く。JSON.stringify(5.0) は "5" へ正規化されてしまい、
  // 「浮動小数を弾く」ことを確かめたつもりが整数を渡すだけになる。
  const rejected = [
    ['文字列の5', '"5"'],
    ['浮動小数の5.0', '5.0'],
    ['指数表記の5e0', '5e0'],
    ['0', '0'],
    ['6', '6'],
    ['null', 'null'],
    ['真偽値', 'true'],
  ];

  for (const [name, ratingJson] of rejected) {
    it(`${name} は弾かれる`, async () => {
      const body = `{"review":{"reviewText":"とても良い","rating":${ratingJson}}}`;
      const res = await handler().handle(request(body), USER_ID);

      assert.equal(res.status, 400);
      assert.equal(res.body.error, '入力内容を確認してください');
    });
  }

  it('rating が欠けていれば弾かれる', async () => {
    const res = await handler().handle(request('{"review":{"reviewText":"とても良い"}}'), USER_ID);

    assert.equal(res.status, 400);
  });

  for (const ratingJson of ['1', '3', '5']) {
    it(`整数の${ratingJson}は通る`, async () => {
      // 弾く側だけを確かめると、全部弾いていても気づけない。
      const body = `{"review":{"reviewText":"とても良い","rating":${ratingJson}}}`;

      assert.equal((await handler().handle(request(body), USER_ID)).status, 200);
    });
  }
});

describe('プロフィール', () => {
  it('プロフィールが無ければ設定を促す', async () => {
    const res = await handler(new FakeProfileStore(null)).handle(request(VALID_BODY), USER_ID);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '先にお店のプロフィールを設定してください');
  });

  it('店名が空のプロフィールも未設定として扱う', async () => {
    const profiles = new FakeProfileStore(profile({ storeName: '' }));
    const res = await handler(profiles).handle(request(VALID_BODY), USER_ID);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '先にお店のプロフィールを設定してください');
  });

  it('プロフィール取得が失敗したら500を返す', async () => {
    const profiles = new FakeProfileStore(null, new Error('接続できません'));
    const res = await handler(profiles).handle(request(VALID_BODY), USER_ID);

    assert.equal(res.status, 500);
    assert.equal(res.body.error, '生成に失敗しました。時間をおいて再度お試しください');
  });

  it('内部エラーの本文に例外メッセージを含めない', async () => {
    // 例外には接続文字列が混ざりうる。利用者にそのまま返さない。
    const secret = 'postgres://user:とても秘密@db:5432/app';
    const profiles = new FakeProfileStore(null, new Error(secret));
    const res = await handler(profiles).handle(request(VALID_BODY), USER_ID);

    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes('postgres://'));
    assert.ok(!serialized.includes('とても秘密'));
  });
});

describe('上限', () => {
  it('上限に達したら429とfreeプランの文言を返す', async () => {
    const res = await handler(
      new FakeProfileStore(profile({ plan: 'free' })),
      new FakeUsageStore(1, new LimitExceeded('上限')),
    ).handle(request(VALID_BODY), USER_ID);

    assert.equal(res.status, 429);
    assert.ok(res.body.error.includes('5件'));
    assert.ok(res.body.error.includes('プロプラン'));
  });

  it('有料プランの上限文言はアップグレードを案内しない', async () => {
    const res = await handler(
      new FakeProfileStore(profile({ plan: 'pro' })),
      new FakeUsageStore(1, new LimitExceeded('上限')),
    ).handle(request(VALID_BODY), USER_ID);

    assert.equal(res.status, 429);
    assert.ok(res.body.error.includes('300件'));
    assert.ok(!res.body.error.includes('プロプラン'));
  });

  it('DB側がプランを決められない場合はプロフィール設定を促す', async () => {
    const res = await handler(null, new FakeUsageStore(1, new PlanNotFound('プラン不明'))).handle(
      request(VALID_BODY),
      USER_ID,
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.error, '先にお店のプロフィールを設定してください');
  });
});

describe('生成', () => {
  it('生成が失敗したら500を返す', async () => {
    const res = await handler(null, null, new FakeGenerator(new Error('APIが応答しません'))).handle(
      request(VALID_BODY),
      USER_ID,
    );

    assert.equal(res.status, 500);
  });

  it('成功したら返信と利用状況を返す', async () => {
    const usage = new FakeUsageStore(3);
    const res = await handler(new FakeProfileStore(profile({ plan: 'free' })), usage).handle(
      request(VALID_BODY),
      USER_ID,
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.usage.used, 3);
    assert.equal(res.body.usage.limit, 5);
    assert.equal(res.body.mock, true);
    assert.equal(res.body.replies.length, 1);
    assert.deepEqual(res.body.replies[0], { style: 'polite', text: 'テスト用の返信' });
  });

  it('加算は利用者IDと集計月で呼ばれる', async () => {
    const usage = new FakeUsageStore(1);
    await handler(null, usage).handle(request(VALID_BODY), USER_ID);

    assert.equal(usage.calls.length, 1);
    assert.equal(usage.calls[0][0], USER_ID);
    assert.match(usage.calls[0][1], /^\d{4}-\d{2}$/);
  });

  it('検証で弾かれた入力では加算しない', async () => {
    // 形が違うだけで利用枠を消費してしまうと、
    // 送り手は何もできないまま上限に達する。
    const usage = new FakeUsageStore(1);
    await handler(null, usage).handle(request('{"foo":1}'), USER_ID);

    assert.deepEqual(usage.calls, []);
  });

  it('生成器には検証後の口コミがそのまま渡る', async () => {
    const generator = new FakeGenerator();
    await handler(null, null, generator).handle(request(VALID_BODY), USER_ID);

    assert.deepEqual(generator.received, { text: 'とても良い店', rating: 5 });
  });
});
