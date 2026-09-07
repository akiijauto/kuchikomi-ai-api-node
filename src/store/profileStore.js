import { ProfileNotFound, StoreError } from './errors.js';

/**
 * public.profiles への読み書きをまとめる。
 *
 * PHP版・Go版は ProfileReader というインターフェースを切って、テストのときだけ
 * ダミー実装へ差し替えられるようにしていた。JavaScriptには型としての
 * インターフェースが無いので、**同じ形のメソッドを持っていれば差し替えられる**
 * （ダックタイピング）。楽な代わりに、差し替え側のメソッド名を間違えても
 * 実行するまで気づけない。test/fakes.js に本物と同じ形で置いてあるのはそのため。
 */
export class ProfileStore {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  /**
   * 自分の行だけを読む。
   *
   * 本番のSupabaseでは行レベルセキュリティ(RLS)が最後の砦になるが、
   * この接続はテーブル所有者のロールで繋ぐためRLSは素通りする。
   * ここで id を条件に入れているのは飾りではない（Go版・Rails版・PHP版と同じ判断）。
   *
   * @throws {ProfileNotFound} 該当する行が無いとき
   * @throws {StoreError} それ以外のDB失敗
   */
  async find(userId) {
    let result;
    try {
      result = await this.#pool.query(
        `select store_name, industry, tone, signature, plan
           from public.profiles where id = $1`,
        [userId],
      );
    } catch (cause) {
      throw new StoreError('プロフィールを読み取れませんでした', { cause });
    }

    const row = result.rows[0];
    if (row === undefined) {
      throw new ProfileNotFound(`profile not found: ${userId}`);
    }

    return {
      storeName: row.store_name,
      industry: row.industry,
      tone: row.tone,
      signature: row.signature,
      plan: row.plan,
    };
  }

  /**
   * デモ画面用の利用者とプロフィールを用意する。DEMO_MODE のときだけ呼ばれる。
   *
   * public.profiles の行は 01_schema.sql の on_auth_user_created トリガーが
   * auth.users への insert をきっかけに自動で作るので、ここで profiles を
   * insert しようとすると主キー重複になる。作るのではなく更新する。
   * auth.users 側は on conflict do nothing にして、何度呼んでも行が増えない
   * （＝このメソッドが冪等になる）ようにしている。
   *
   * @throws {StoreError}
   */
  async ensureDemoUser(userId, profile) {
    try {
      await this.#pool.query(
        `insert into auth.users (id, email) values ($1, $2)
         on conflict (id) do nothing`,
        [userId, `${userId}@example.test`],
      );

      await this.#pool.query(
        `update public.profiles
            set store_name = $2,
                industry = $3,
                tone = $4,
                signature = $5
          where id = $1`,
        [userId, profile.storeName, profile.industry, profile.tone, profile.signature],
      );
    } catch (cause) {
      throw new StoreError('デモ用の利用者を用意できませんでした', { cause });
    }
  }
}
