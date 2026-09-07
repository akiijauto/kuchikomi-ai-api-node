import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Config, ConfigError } from '../src/config.js';

function env(overrides = {}) {
  return {
    JWT_SECRET: 'a'.repeat(48),
    DATABASE_URL: 'postgresql://u:p@localhost:5432/app',
    ...overrides,
  };
}

describe('JWT_SECRET', () => {
  it('無ければ起動時に落ちる', () => {
    // ハンドラの中で気づく形にすると「ログインが必要です」に化けて、
    // 設定漏れなのか本当に未ログインなのか追えなくなる。
    assert.throws(() => Config.fromEnv({ DATABASE_URL: 'x' }), ConfigError);
  });

  it('空文字も未設定として扱う', () => {
    assert.throws(() => Config.fromEnv(env({ JWT_SECRET: '' })), ConfigError);
  });

  it('32バイト未満なら起動時に落ちる', () => {
    assert.throws(() => Config.fromEnv(env({ JWT_SECRET: 'a'.repeat(31) })), /短すぎ/);
  });

  it('ちょうど32バイトなら通る', () => {
    assert.equal(Config.fromEnv(env({ JWT_SECRET: 'a'.repeat(32) })).jwtSecret.length, 32);
  });

  it('長さはバイト数で見る', () => {
    // 「あ」はUTF-8で3バイト。11文字で33バイトなので通る。
    // 文字数で見ていると11文字として弾いてしまう。
    assert.doesNotThrow(() => Config.fromEnv(env({ JWT_SECRET: 'あ'.repeat(11) })));
    assert.throws(() => Config.fromEnv(env({ JWT_SECRET: 'あ'.repeat(10) })), /短すぎ/);
  });
});

describe('DEMO_MODE', () => {
  it('1のときだけ有効になる', () => {
    // 本番でこの経路が開いていると、誰でも利用枠を消費できてしまう。
    // 「設定されていれば有効」にすると DEMO_MODE=0 でも開いてしまう。
    assert.equal(Config.fromEnv(env({ DEMO_MODE: '1' })).demoMode, true);
    assert.equal(Config.fromEnv(env({ DEMO_MODE: '0' })).demoMode, false);
    assert.equal(Config.fromEnv(env({ DEMO_MODE: 'true' })).demoMode, false);
    assert.equal(Config.fromEnv(env()).demoMode, false);
  });
});

describe('PORT', () => {
  it('未設定なら3000', () => {
    assert.equal(Config.fromEnv(env()).port, 3000);
  });

  it('数字でなければ落とす', () => {
    // parseInt は 'abc' で NaN を返すだけで例外にならない。
    // そのまま listen へ渡すと、意図しないポートで待ち受ける。
    assert.throws(() => Config.fromEnv(env({ PORT: 'abc' })), ConfigError);
    assert.throws(() => Config.fromEnv(env({ PORT: '0' })), ConfigError);
    assert.throws(() => Config.fromEnv(env({ PORT: '70000' })), ConfigError);
  });
});

describe('Anthropic', () => {
  it('APIキーが無ければ null（呼び出し側がモックを選ぶ）', () => {
    assert.equal(Config.fromEnv(env()).anthropicApiKey, null);
  });

  it('モデル名が空なら空文字（既定値は生成器側が持つ）', () => {
    assert.equal(Config.fromEnv(env()).anthropicModel, '');
  });
});
