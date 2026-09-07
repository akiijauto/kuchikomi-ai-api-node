import http from 'node:http';

import { Config, ConfigError } from './config.js';
import { HAS_SOURCE_TEXT_ACCESS } from './http/json.js';
import { MAX_BODY_BYTES, readRequest } from './http/request.js';
import { Response } from './http/response.js';
import { Kernel } from './kernel.js';

/**
 * 起動口。薄く保つ: 設定を読み、Kernelに渡し、送るだけ。
 * ルーティング表の組み立ては Kernel の役目であって、ここでは行わない。
 */

const HEALTHCHECK_TIMEOUT_MS = 4000;

/**
 * コンテナのHEALTHCHECKから呼ばれる自己診断。
 *
 * curl を入れずに済ませるためにこの口を用意している。
 * Go版が distroless(シェル無し)のためにバイナリ自身へ -healthcheck を持たせたのと
 * 同じ形。イメージにcurlを足すと、そのぶん中に入れる道具も増える。
 */
async function runHealthcheck(port) {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/api/health', {
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });

    return res.ok ? 0 : 1;
  } catch {
    return 1;
  }
}

function main() {
  let config;
  try {
    config = Config.fromEnv();
  } catch (e) {
    if (e instanceof ConfigError) {
      // JWT_SECRET未設定など、設定漏れによる起動失敗。
      // 「ログインが必要です」に化けさせず、原因が追えるようログに残して落とす。
      console.error('起動できませんでした: ' + e.message);
      process.exitCode = 1;

      return;
    }
    throw e;
  }

  if (process.argv.includes('--healthcheck')) {
    runHealthcheck(config.port).then((code) => {
      process.exitCode = code;
    });

    return;
  }

  // 5.0 と 5 を区別できない実行環境では、星の検証が他の4実装より緩くなる。
  // 黙って緩くなるのが一番まずいので、起動時に残す（src/http/json.js 参照）。
  if (!HAS_SOURCE_TEXT_ACCESS) {
    console.error(
      '警告: この実行環境は JSON.parse のソーステキスト参照に対応していません。' +
        'rating の 5.0 を 5 と区別できず、他の実装より緩くなります（Node.js 22以上が必要）',
    );
  }

  const kernel = new Kernel(config);

  const server = http.createServer((req, res) => {
    readRequest(req)
      .then(({ request, tooLarge }) => {
        if (tooLarge) {
          // 上限を超えたものは読み切らずに切る。全部読んでから長さを見ると、
          // その時点でメモリを使い切れてしまう。
          return Response.error(400, '不正なリクエストです');
        }

        return kernel.handle(request);
      })
      .catch((e) => {
        console.error('リクエストの読み取りに失敗: ' + (e && e.constructor ? e.constructor.name : 'Error'));

        return Response.error(400, '不正なリクエストです');
      })
      .then((response) => response.send(res));
  });

  // ヘッダだけ送って黙る接続に居座られないようにする。
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  // listen に失敗したときの受け皿。
  // これを付けないと EADDRINUSE がそのまま未処理の error イベントになり、
  // スタックトレースだけが出て「何が起きたのか」が読み取れない
  // （実測でこの形になったので足した）。
  server.on('error', (e) => {
    console.error(`待ち受けを開始できませんでした: ${e.code ?? e.message}`);
    process.exitCode = 1;
  });

  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        message: 'listening',
        port: config.port,
        demo_mode: config.demoMode,
        max_body_bytes: MAX_BODY_BYTES,
      }),
    );
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => {
        kernel.close().finally(() => process.exit(0));
      });
    });
  }
}

main();
