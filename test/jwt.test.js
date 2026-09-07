import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SignJWT } from 'jose';

import { AuthError, JwtIssuer, JwtVerifier } from '../src/auth/jwt.js';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);
const USER_ID = '00000000-0000-4000-8000-000000000001';

function key(secret) {
  return new TextEncoder().encode(secret);
}

describe('トークンの検証', () => {
  it('自分で発行したトークンを検証できる', async () => {
    const token = await new JwtIssuer(SECRET).issue(USER_ID, 900);
    const sub = await new JwtVerifier(SECRET).verifyBearer(`Bearer ${token}`);

    assert.equal(sub, USER_ID);
  });

  it('別の鍵で署名されたトークンは通さない', async () => {
    const token = await new JwtIssuer(OTHER_SECRET).issue(USER_ID, 900);

    await assert.rejects(() => new JwtVerifier(SECRET).verifyBearer(`Bearer ${token}`), AuthError);
  });

  it('HS256以外で署名されたトークンは通さない', async () => {
    // algorithms を指定しないと、jose はトークンのヘッダに書かれた alg を見て
    // 検証方式を決める。受け入れる署名方式はこちらが決める、という形にしておかないと
    // アルゴリズム混同や alg=none を通す経路が生まれる。
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(USER_ID)
      .setExpirationTime('15m')
      .sign(key(SECRET));

    await assert.rejects(() => new JwtVerifier(SECRET).verifyBearer(`Bearer ${token}`), AuthError);
  });

  it('期限切れのトークンは通さない', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuedAt(past - 900)
      .setExpirationTime(past)
      .sign(key(SECRET));

    await assert.rejects(() => new JwtVerifier(SECRET).verifyBearer(`Bearer ${token}`), AuthError);
  });

  it('subが無いトークンは通さない', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .sign(key(SECRET));

    await assert.rejects(() => new JwtVerifier(SECRET).verifyBearer(`Bearer ${token}`), AuthError);
  });
});

describe('Authorizationヘッダの形', () => {
  const verifier = new JwtVerifier(SECRET);

  for (const [name, header] of [
    ['ヘッダが無い', undefined],
    ['Bearerが付いていない', 'abc.def.ghi'],
    ['小文字のbearer', 'bearer abc.def.ghi'],
    ['トークンが空', 'Bearer '],
  ]) {
    it(`${name} なら認証エラー`, async () => {
      await assert.rejects(() => verifier.verifyBearer(header), AuthError);
    });
  }
});

describe('デモ用トークンの中身', () => {
  it('Go版に合わせて aud は文字列で入る', async () => {
    const token = await new JwtIssuer(SECRET).issue(USER_ID, 900);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

    assert.equal(payload.aud, 'authenticated');
    assert.equal(payload.sub, USER_ID);
    assert.equal(typeof payload.exp, 'number');
    assert.equal(payload.exp - payload.iat, 900);
  });
});
