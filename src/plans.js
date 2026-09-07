/**
 * プランごとの上限。
 *
 * ここにある数字は画面表示とエラー文言のための複製で、
 * 上限の強制そのものは DB 側（plan_limits テーブルと increment_usage 関数）が正本。
 * アプリ側の数字がずれても実際の制限は破られないが、
 * 利用者に見せる文言だけが食い違うことになるので、変えるときは両方直す。
 *
 * Next.js版 web/src/lib/plans.ts、Rails版 Plans、Go版 internal/app/plans.go、
 * PHP版 App\Plans と同じ値。
 */

const LIMITS = Object.freeze({ free: 5, pro: 300 });

/** 未知のプラン名は free と同じ扱いにする（他の4実装と揃える）。 */
export function limit(plan) {
  return Object.hasOwn(LIMITS, plan) ? LIMITS[plan] : LIMITS.free;
}

/**
 * 利用回数の集計単位（YYYY-MM）。
 *
 * UTC で切るのが要点。実行環境のタイムゾーンで切ると、
 * 同じ利用者が別々の月として数えられてしまい、5実装で答えが変わる。
 *
 * toISOString() が常にUTCを返すことに乗っている。Date#getMonth() を使うと
 * 実行環境のタイムゾーンで切ってしまい、日本時間の月初0時30分が
 * 前月ではなく当月として数えられる。
 */
export function currentMonthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

export function limitMessage(plan, monthlyLimit) {
  if (plan === 'free') {
    return `今月の無料利用回数(${monthlyLimit}件)の上限に達しました。プロプランへのアップグレードをご検討ください`;
  }

  return `今月の利用回数(${monthlyLimit}件)の上限に達しました`;
}
