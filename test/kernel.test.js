import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Config } from '../src/config.js';
import { Request } from '../src/http/request.js';
import { Kernel } from '../src/kernel.js';

/**
 * ルーティングと認証の入口だけを確かめる。
 * DBには一切触れない経路しか通していないので、PostgreSQLは要らない。
 */
function kernel(overrides = {}) {
  return new Kernel(
    Config.fromEnv({
      JWT_SECRET: 'a'.repeat(48),
      DATABASE_URL: 'postgresql://u:p@localhost:5432/app',
      ...overrides,
    }),
  );
}

describe('死活監視', () => {
  it('認証もDBも要らずに200を返す', async () => {
    const res = await kernel().handle(new Request('GET', '/api/health', {}, ''));

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.uptime, 'number');
  });
});

describe('ルーティング', () => {
  it('知らないパスは404', async () => {
    const res = await kernel().handle(new Request('GET', '/api/unknown', {}, ''));

    assert.equal(res.status, 404);
    assert.equal(res.body.error, '見つかりません');
  });

  it('メソッド違いも404にする（405は返し分けない）', async () => {
    const res = await kernel().handle(new Request('POST', '/api/health', {}, ''));

    assert.equal(res.status, 404);
  });
});

describe('デモ用トークンの口', () => {
  it('DEMO_MODEが1でなければ経路そのものが無い', async () => {
    // ハンドラの中で判定する形にすると、設定を間違えたときに口が開いたままになる。
    const res = await kernel().handle(new Request('POST', '/api/demo/token', {}, ''));

    assert.equal(res.status, 404);
  });

  it('DEMO_MODEが1なら経路が生える', async () => {
    // DBへ繋ぎに行って失敗するが、404ではないこと＝経路があることを確かめる。
    const res = await kernel({ DEMO_MODE: '1' }).handle(
      new Request('POST', '/api/demo/token', {}, ''),
    );

    assert.notEqual(res.status, 404);
  });
});

describe('認証', () => {
  it('トークンが無ければ401（DBに触る前に止まる）', async () => {
    const res = await kernel().handle(new Request('POST', '/api/generate', {}, '{}'));

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'ログインが必要です');
  });

  it('壊れたトークンでも理由を返さない', async () => {
    const res = await kernel().handle(
      new Request('POST', '/api/generate', { authorization: 'Bearer abc.def.ghi' }, '{}'),
    );

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'ログインが必要です');
  });
});
