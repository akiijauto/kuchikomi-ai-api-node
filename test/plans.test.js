import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { currentMonthKey, limit, limitMessage } from '../src/plans.js';

describe('プランごとの上限', () => {
  it('上限はプランごとに決まる', () => {
    assert.equal(limit('free'), 5);
    assert.equal(limit('pro'), 300);
  });

  it('未知のプランはfreeと同じ扱いになる', () => {
    // 他の4実装がそうしている。ここだけ例外を投げると挙動が食い違う。
    assert.equal(limit('enterprise'), 5);
    assert.equal(limit(''), 5);
  });

  it('プロトタイプ由来の名前を上限として拾わない', () => {
    // JavaScript固有の落とし穴。素のオブジェクトに対する `LIMITS[plan]` は
    // 'constructor' や 'toString' でプロトタイプの値を拾ってしまい、
    // 数値でないものが上限として返る。Object.hasOwn で自分の持ち物に限っている。
    assert.equal(limit('constructor'), 5);
    assert.equal(limit('toString'), 5);
    assert.equal(limit('__proto__'), 5);
  });
});

describe('集計月', () => {
  it('UTCで切る', () => {
    // 日本時間の2月1日0時30分は、UTCではまだ1月31日。
    // 実行環境のタイムゾーンで切ってしまうと、同じ利用者が
    // 別々の月として数えられ、5実装で答えが変わる。
    const jst = new Date('2026-02-01T00:30:00+09:00');

    assert.equal(currentMonthKey(jst), '2026-01');
  });

  it('UTCの月初で切り替わる', () => {
    assert.equal(currentMonthKey(new Date('2026-02-01T00:00:00Z')), '2026-02');
    assert.equal(currentMonthKey(new Date('2026-01-31T23:59:59Z')), '2026-01');
  });
});

describe('上限に達したときの文言', () => {
  it('freeプランはアップグレードを案内する', () => {
    const message = limitMessage('free', 5);

    assert.ok(message.includes('5件'));
    assert.ok(message.includes('プロプラン'));
  });

  it('有料プランはアップグレードを案内しない', () => {
    const message = limitMessage('pro', 300);

    assert.ok(message.includes('300件'));
    assert.ok(!message.includes('プロプラン'));
  });
});
