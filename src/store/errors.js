/**
 * データベース層の失敗の分類。
 *
 * increment_usage が返す SQLSTATE のうち P0001(上限超過)・P0002(プラン不明)は
 * それぞれ専用の例外にするが、それ以外（接続断・SQL構文誤りなど）はすべて
 * StoreError に包む。呼び出し側は「業務上のエラー2種」と「それ以外」だけを
 * 区別できればよく、pg の実装詳細を知る必要がなくなる。
 */

/** その他の分類に当てはまらないデータベース層の失敗。 */
export class StoreError extends Error {}

/** 今月の利用回数が plan_limits.monthly_limit に達している（SQLSTATE P0001）。 */
export class LimitExceeded extends Error {}

/** 利用者の上限を決められなかった（SQLSTATE P0002）。 */
export class PlanNotFound extends Error {}

/** public.profiles に該当する行が無い。 */
export class ProfileNotFound extends Error {}
