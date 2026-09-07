import { LimitExceeded, PlanNotFound, StoreError } from './errors.js';

/**
 * public.usage_logs への加算をまとめる。
 */
export class UsageStore {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  /**
   * 今月の利用回数を1つ増やし、増やした後の値を返す。
   *
   * 上限チェックをアプリ側で「今の件数を読む→上限と比較する→書く」の3手順に
   * 分解しない。分解すると、同時に2本のリクエストが来たとき、両方が「読む」を
   * 済ませた直後の隙間に割り込んで、どちらも「まだ上限に達していない」と
   * 判定してしまい、合計で上限を超えて加算できてしまう。
   *
   * Node は1プロセスでも複数の要求を同時に扱う（await の間に別の要求が進む）ので、
   * この隙間は**シングルスレッドでも開く**。「並行処理をしていないから安全」は
   * 成り立たない。DB関数 public.increment_usage は上限の比較と加算を1つのSQL文の
   * 中で完結させるため、呼び出し側の実装言語やプロセス数に関わらず上限を超えない。
   *
   * @throws {LimitExceeded} 今月の上限に達しているとき(SQLSTATE P0001)
   * @throws {PlanNotFound} 上限を決められないとき(SQLSTATE P0002)
   * @throws {StoreError} それ以外のDB失敗
   */
  async increment(userId, month) {
    // プールから1本借りて、その1本の上でトランザクションを張る。
    // pool.query() を並べるとSQLごとに別の接続になり得るため、
    // set_config で立てた値が increment_usage を実行する接続に載らない。
    const client = await this.#pool.connect().catch((cause) => {
      throw new StoreError('データベースへ接続できませんでした', { cause });
    });

    try {
      await client.query('begin');

      // increment_usage の中の auth.uid() 相当(request.jwt.claim.sub)が読む値を
      // ここで立てる。set_config の第3引数 true は「このトランザクションの中だけ
      // 有効」という意味で、プールで同じ接続が使い回されても、このリクエストが
      // 立てた利用者IDが次の別リクエストへ漏れることがない。
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);

      const result = await client.query('select public.increment_usage($1) as count', [month]);

      await client.query('commit');

      return Number(result.rows[0].count);
    } catch (cause) {
      await client.query('rollback').catch(() => {});

      // メッセージ文字列ではなくSQLSTATEで判定する。文言(USAGE_LIMIT_EXCEEDED等)で
      // 判定すると、DB側がエラーメッセージの文言だけを変えた瞬間に静かに壊れる。
      // pg は SQLSTATE を error.code に入れる。
      if (cause?.code === 'P0001') {
        throw new LimitExceeded('usage limit exceeded', { cause });
      }
      if (cause?.code === 'P0002') {
        throw new PlanNotFound('usage plan not found', { cause });
      }

      throw new StoreError('利用回数を加算できませんでした', { cause });
    } finally {
      client.release();
    }
  }
}
