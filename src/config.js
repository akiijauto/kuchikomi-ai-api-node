/**
 * サーバの設定。すべて環境変数から作る（読み込みはここに集約する）。
 *
 * Go版 internal/app/server.go の Config、PHP版 App\Config と対応する。
 *
 * JWT_SECRET が無いときに起動時点で落とすのはPHP版と同じ判断。
 * ハンドラの中で気づく形にすると「ログインが必要です」に化けて、
 * 設定漏れなのか本当に未ログインなのか追えなくなる。
 */

/** HS256 の鍵として要求する最小長。 */
const MIN_JWT_SECRET_BYTES = 32;

export class ConfigError extends Error {}

export class Config {
  constructor({ databaseUrl, jwtSecret, port, demoMode, anthropicApiKey, anthropicModel }) {
    this.databaseUrl = databaseUrl;
    this.jwtSecret = jwtSecret;
    this.port = port;
    this.demoMode = demoMode;
    this.anthropicApiKey = anthropicApiKey;
    this.anthropicModel = anthropicModel;
    Object.freeze(this);
  }

  /**
   * 環境変数から作る。JWT_SECRET が未設定・空・短すぎるときは ConfigError を投げる。
   *
   * @param {Record<string,string|undefined>} env テストでは差し替えて環境変数を汚さない
   */
  static fromEnv(env = process.env) {
    const get = (name) => {
      const value = env[name];

      return value === undefined || value === '' ? null : String(value);
    };

    const jwtSecret = get('JWT_SECRET');
    if (jwtSecret === null) {
      throw new ConfigError('JWT_SECRET が未設定です');
    }

    // 鍵の長さをここで見る。
    //
    // これはライブラリの制約ではなく、こちら側の判断で入れている。
    // 実測すると jose は16バイトの鍵でもHS256の署名・検証を通す
    // （PHP版が使う firebase/php-jwt は32バイト未満を拒む）。
    // つまり Node版は「通してしまえる」側にいる。
    //
    // それでも拒むほうを選んだのは、JwtVerifier がトークン検証の失敗を
    // すべて401にまとめているため。弱い鍵をそのまま通すと、鍵の強度の
    // 問題が「トークンが無効です」に化けて表に出てこない。
    // 実運用の鍵は48バイトで生成しているので、この制約は実害を出さない。
    const secretBytes = Buffer.byteLength(jwtSecret, 'utf8');
    if (secretBytes < MIN_JWT_SECRET_BYTES) {
      throw new ConfigError(
        `JWT_SECRET が短すぎます(${secretBytes}バイト)。HS256 には ${MIN_JWT_SECRET_BYTES} バイト以上を要求しています`,
      );
    }

    const port = Number.parseInt(get('PORT') ?? '3000', 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new ConfigError(`PORT の値が不正です: ${get('PORT')}`);
    }

    return new Config({
      databaseUrl: get('DATABASE_URL') ?? '',
      jwtSecret,
      port,
      // 文字列 "1" のときだけ有効。Go版の os.Getenv("DEMO_MODE") == "1" と同じ判断で、
      // "true"/"yes" 等の表記ゆれを受け付けない（暗黙の緩さを持ち込まない）。
      demoMode: get('DEMO_MODE') === '1',
      anthropicApiKey: get('ANTHROPIC_API_KEY'),
      // 空なら ClaudeGenerator 自身の既定値に委ねる。既定モデル名をここで重複して持たない。
      anthropicModel: get('ANTHROPIC_MODEL') ?? '',
    });
  }
}
