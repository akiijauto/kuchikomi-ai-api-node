import { Response } from '../http/response.js';

/**
 * デモ画面用にトークンを発行する。
 *
 * 本来の利用者は Supabase でログインして得たトークンを持ってくる。
 * デモでは Supabase が無いので、同じ形のトークンをこちら側で作る。
 *
 * DEMO_MODE が有効なときだけ経路を生やす（Kernel 側で判定）。
 * 本番でこの経路が開いていると、誰でも利用枠を消費できてしまう。
 */

/**
 * デモ用の固定利用者。
 *
 * 他の実装と同じIDを使う。同じDBを見たときに行が増えないほうが、
 * 5実装が同じカウンタを共有していることを確かめやすい。
 */
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

const TTL_SECONDS = 900;

const DEMO_PROFILE = Object.freeze({
  storeName: 'デモ食堂',
  industry: '飲食店',
  tone: 'friendly',
  signature: '店主 デモ',
  plan: 'free',
});

export class DemoTokenHandler {
  #profiles;
  #issuer;

  constructor(profiles, issuer) {
    this.#profiles = profiles;
    this.#issuer = issuer;
  }

  async handle() {
    let token;
    try {
      await this.#profiles.ensureDemoUser(DEMO_USER_ID, DEMO_PROFILE);
      token = await this.#issuer.issue(DEMO_USER_ID, TTL_SECONDS);
    } catch (e) {
      // 例外にはトークンや接続文字列が混ざりうるので、種類だけ残す。
      console.error(`デモ用トークンの発行に失敗: ${e?.constructor?.name ?? 'Error'}`);

      return Response.error(500, '生成に失敗しました。時間をおいて再度お試しください');
    }

    return Response.json(200, { token, expires_in: TTL_SECONDS });
  }
}
