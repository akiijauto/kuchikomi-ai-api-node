import pg from 'pg';

import { StoreError } from './errors.js';

/**
 * DATABASE_URL から接続プールを作る。
 *
 * PHP版は PDO のDSN形式が postgres:// を受け付けないため URL を分解していたが、
 * pg は接続文字列をそのまま解釈できるので、その手当ては要らない。
 *
 * PHP がリクエストごとに接続し直すのに対し、Node は Go と同じく常駐プロセスなので、
 * プールを1つ作って使い回す（Go版 store.Open() と同じ形）。
 */
export function createPool(databaseUrl) {
  if (databaseUrl === '') {
    throw new StoreError('DATABASE_URL が未設定です');
  }

  return new pg.Pool({
    connectionString: databaseUrl,
    // 接続できないまま無期限に待たない。
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
}
