import { AuthError, JwtIssuer, JwtVerifier } from './auth/jwt.js';
import { DemoTokenHandler } from './handlers/demoToken.js';
import { GenerateHandler } from './handlers/generate.js';
import { HealthHandler } from './handlers/health.js';
import { Response } from './http/response.js';
import { ClaudeGenerator } from './reply/claudeGenerator.js';
import { MockGenerator } from './reply/mockGenerator.js';
import { Router } from './router.js';
import { createPool } from './store/database.js';
import { ProfileStore } from './store/profileStore.js';
import { UsageStore } from './store/usageStore.js';

/**
 * ルーティング表を組み立て、認証が要る経路には認証を適用し、リクエストを1行ログに残す。
 *
 * Go版 internal/app/server.go の Server.New()、PHP版 App\Kernel に相当する。
 *
 * 接続プールを起動時ではなく最初に必要になったときに作っているのが Go版との違い。
 * Go版は main.go が起動時に store.Open() して、DATABASE_URL が無ければ起動しない。
 * こちらを遅延させたのは、DBが要らない /api/health を、DBの設定が無い環境でも
 * 動かすため（CIでコンテナを起動して死活監視だけ確かめられる）。
 * その代わり、DATABASE_URL の書き間違いは起動時ではなく最初の /api/generate で表に出る。
 */
export class Kernel {
  #config;
  #router;
  #verifier;
  #startedAt;

  #pool = null;
  #generator = null;

  constructor(config) {
    this.#config = config;
    this.#startedAt = performance.now();
    this.#verifier = new JwtVerifier(config.jwtSecret);
    this.#router = new Router();

    this.#registerRoutes();
  }

  /** リクエストを1件処理する。ルーティング・ログを一括りにするのがKernelの役目。 */
  async handle(request) {
    const started = performance.now();

    let response;
    try {
      response = await this.#router.dispatch(request);
    } catch (e) {
      // ルートは見つかったが、依存の組み立て(DB接続など)やハンドラの外側で
      // 予期せず落ちたときの最後の受け皿。個々のハンドラが使っているのと
      // 同じ文言にして、利用者から見た挙動を揃える。
      console.error('未捕捉の例外: ' + errorName(e));
      response = Response.error(500, '生成に失敗しました。時間をおいて再度お試しください');
    }

    this.#logRequest(request, response, started);

    return response;
  }

  async close() {
    await this.#pool?.end();
  }

  #registerRoutes() {
    // 死活監視はDBにも認証にも依存させない。
    // ここがDBを見に行くと「アプリは生きているがDBが不調」でコンテナごと落とされ、
    // 切り分けができなくなる。
    const health = new HealthHandler(this.#startedAt);
    this.#router.add('GET', '/api/health', (r) => health.handle(r));

    // /api/generate はDB(プロフィール・利用回数)と生成器に依存する。
    // Store/Generator の実体化をここ(クロージャの中)まで遅らせ、実際に
    // このルートが呼ばれるまでDB接続を発生させない。
    this.#router.add(
      'POST',
      '/api/generate',
      this.#withAuth((r, userId) => {
        const handler = new GenerateHandler(
          this.#profileStore(),
          this.#usageStore(),
          this.#generatorFor(),
        );

        return handler.handle(r, userId);
      }),
    );

    // デモ用トークン発行口は DEMO_MODE のときだけ「存在する」。
    // ハンドラの中で判定する形にすると、設定を間違えたときに口が開いたままになる。
    // これは「誰でもログイン済みになれる入口」なので、無いことが保証される側に倒す。
    if (this.#config.demoMode) {
      const issuer = new JwtIssuer(this.#config.jwtSecret);
      this.#router.add('POST', '/api/demo/token', () => {
        return new DemoTokenHandler(this.#profileStore(), issuer).handle();
      });
    }
  }

  /** 認証が要る経路を包む。userId をハンドラへ渡す。 */
  #withAuth(handler) {
    return async (request) => {
      let userId;
      try {
        userId = await this.#verifier.verifyBearer(request.header('authorization'));
      } catch (e) {
        if (e instanceof AuthError) {
          return Response.error(401, 'ログインが必要です');
        }
        throw e;
      }

      return handler(request, userId);
    };
  }

  #getPool() {
    this.#pool ??= createPool(this.#config.databaseUrl);

    return this.#pool;
  }

  #profileStore() {
    return new ProfileStore(this.#getPool());
  }

  #usageStore() {
    return new UsageStore(this.#getPool());
  }

  /**
   * 鍵が無いと動かない、ではなく「経路は通るが中身はデモ」にする。
   * 鍵の無いテスト環境やCIでも認証・上限・応答形式まで通して確かめられる
   * （Go版 newGenerator、PHP版 Kernel::generator() と同じ判断）。
   * 一度選んだ生成器は使い回す。
   */
  #generatorFor() {
    if (this.#generator !== null) {
      return this.#generator;
    }

    if (this.#config.anthropicApiKey === null) {
      this.#generator = new MockGenerator();
    } else if (this.#config.anthropicModel !== '') {
      this.#generator = new ClaudeGenerator(
        this.#config.anthropicApiKey,
        this.#config.anthropicModel,
      );
    } else {
      // モデル名が空なら ClaudeGenerator の既定値に委ね、既定値の文字列をここで重複して持たない。
      this.#generator = new ClaudeGenerator(this.#config.anthropicApiKey);
    }

    return this.#generator;
  }

  /**
   * 1リクエスト1行のログを出す。
   *
   * Content-Length を必ず出しているのは2026-09-03の教訓による。
   * Rails版で「日本語のときだけ400」が起きた原因はアプリではなく送信側のシェルが
   * UTF-8以外で送っていたことで、受け取ったバイト数の記録があったおかげで切り分けられた。
   * 値が無い・数値でないときは -1（Go版の r.ContentLength が「不明なら-1」を返すのに合わせる）。
   */
  #logRequest(request, response, started) {
    const raw = request.header('content-length');
    const contentLength = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : -1;

    console.log(
      JSON.stringify({
        method: request.method,
        path: request.path,
        status: response.status,
        req_content_length: contentLength,
        duration_ms: Math.round(performance.now() - started),
      }),
    );
  }
}

function errorName(e) {
  return e && e.constructor ? e.constructor.name : 'Error';
}
