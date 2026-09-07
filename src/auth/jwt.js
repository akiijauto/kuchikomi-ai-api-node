import { SignJWT, jwtVerify } from 'jose';

/**
 * ログイン基盤(Supabase)が発行したJWTの検証と、デモ用の発行。
 *
 * Go版 internal/auth/auth.go、PHP版 App\Auth\* と同じ判断をしている。
 * 「署名が正しいか」と「誰なのか(sub)」を取り出すだけ。
 */

/**
 * 認証に失敗したことを表す例外の総称。
 *
 * 「トークンが無い・壊れている・期限切れ・別の鍵で署名」のどれであったかは、
 * 呼び出し側にも利用者にも区別して返さない（攻撃者への手がかりを与えないため）。
 * Go版 ErrUnauthorized、PHP版 AuthException と同じ判断。
 */
export class AuthError extends Error {}

const BEARER_PREFIX = 'Bearer ';

/**
 * Authorization ヘッダから "Bearer " を取り除いた部分を取り出す。
 * 形式が違えば null を返す（呼び出し側の扱いを揃えるため、例外にはしない）。
 */
function bearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();

  return token === '' ? null : token;
}

export class JwtVerifier {
  #key;

  constructor(secret) {
    this.#key = new TextEncoder().encode(secret);
  }

  /**
   * Authorization ヘッダ全体("Bearer xxx")を受け取り、sub(利用者ID)を返す。
   *
   * algorithms に HS256 だけを渡すのが要点で、飾りではない。
   * これを省くと jose はトークンのヘッダに書かれた alg を見て検証方式を決める。
   * 受け入れる署名方式は**こちらが決める**という形にしておかないと、
   * アルゴリズム混同（例: RS256用の公開鍵をHS256の共有鍵として誤用させる）や
   * alg=none を通す経路が生まれる。
   * Go版の jwt.WithValidMethods([]string{"HS256"})、PHP版の new Key($secret, 'HS256')
   * と同じ意図。実測では HS512 で署名したトークンが
   * ERR_JOSE_ALG_NOT_ALLOWED で弾かれることを確かめてある（test/jwt.test.js）。
   *
   * @throws {AuthError}
   */
  async verifyBearer(authorizationHeader) {
    const token = bearerToken(authorizationHeader);
    if (token === null) {
      throw new AuthError('認証トークンがありません');
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.#key, { algorithms: ['HS256'] }));
    } catch {
      // 壊れている・期限切れ・署名不一致・alg不一致をすべて同じ扱いにする。
      throw new AuthError('認証トークンが無効です');
    }

    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new AuthError('認証トークンにsubがありません');
    }

    return payload.sub;
  }
}

/**
 * デモ画面用に、Supabaseが出すものと同じ形のトークンを作る。
 *
 * 本来の利用者はSupabaseでログインして得たトークンを持ってくるので、
 * 本番でこれを使うことはない（呼び出し口はDEMO_MODEのときだけ生える）。
 */
export class JwtIssuer {
  #key;

  constructor(secret) {
    this.#key = new TextEncoder().encode(secret);
  }

  async issue(subject, ttlSeconds) {
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(subject)
      // 単一値の aud は配列ではなく文字列にする。golang-jwt/v5 の ClaimStrings が
      // 要素数1のとき文字列としてマーシャルするため、Go版が出すトークンの形
      // ("aud":"authenticated") に合わせる。
      .setAudience('authenticated')
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(this.#key);
  }
}
