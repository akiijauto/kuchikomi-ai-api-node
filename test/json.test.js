import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HAS_SOURCE_TEXT_ACCESS, NonIntegerNumber, parseJson } from '../src/http/json.js';

describe('JSONの整数リテラル判定', () => {
  it('この実行環境はソーステキスト参照に対応している', () => {
    // 対応していない環境では 5.0 と 5 を区別できず、このAPIだけが
    // 他の4実装より緩くなる。**黙って緩くなるのが一番まずい**ので、
    // ここで落ちるようにしてある。落ちたら Node.js のバージョンを見ること。
    assert.equal(HAS_SOURCE_TEXT_ACCESS, true, `Node ${process.version} は非対応`);
  });

  it('整数リテラルはそのまま数値になる', () => {
    assert.equal(parseJson('5'), 5);
    assert.equal(parseJson('-3'), -3);
    assert.equal(parseJson('0'), 0);
  });

  it('浮動小数・指数表記は NonIntegerNumber になる', () => {
    // JSON.parse したあとでは 5.0 も 5 も同じ数値で、区別が付かない。
    assert.equal(JSON.parse('5.0'), 5);
    assert.equal(Number.isInteger(JSON.parse('5.0')), true);

    // 元の文字列を見て置き換えている。
    assert.ok(parseJson('5.0') instanceof NonIntegerNumber);
    assert.ok(parseJson('5e0') instanceof NonIntegerNumber);
    assert.ok(parseJson('0.5') instanceof NonIntegerNumber);
  });

  it('置き換えは入れ子の中でも効く', () => {
    const parsed = parseJson('{"review":{"rating":5.0,"count":5}}');

    assert.ok(parsed.review.rating instanceof NonIntegerNumber);
    assert.equal(parsed.review.rating.source, '5.0');
    assert.equal(parsed.review.count, 5);
  });

  it('数値以外はそのまま通す', () => {
    const parsed = parseJson('{"a":"5","b":true,"c":null,"d":[1,2]}');

    assert.equal(parsed.a, '5');
    assert.equal(parsed.b, true);
    assert.equal(parsed.c, null);
    assert.deepEqual(parsed.d, [1, 2]);
  });

  it('壊れたJSONは SyntaxError のまま投げる', () => {
    assert.throws(() => parseJson('{"review":'), SyntaxError);
  });
});
