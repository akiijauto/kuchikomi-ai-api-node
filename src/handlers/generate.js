import { NonIntegerNumber, parseJson } from '../http/json.js';
import { Response } from '../http/response.js';
import { currentMonthKey, limit, limitMessage } from '../plans.js';
import { LimitExceeded, PlanNotFound, ProfileNotFound } from '../store/errors.js';

/**
 * クチコミへの返信案を作る。
 *
 * Next.js版 web/src/app/api/generate/route.ts の移植で、ステータスコードと文言を
 * 他の4実装に合わせてある。同じ入力に同じ答えを返すことがこの演習の眼目なので、
 * 文言を勝手に変えない。
 *
 * 依存を引数で受け取っているのは、入力検証を確かめたいだけのテストにまで
 * PostgreSQLを要求しないため。
 */

const INTERNAL_ERROR = '生成に失敗しました。時間をおいて再度お試しください';
const NEED_PROFILE = '先にお店のプロフィールを設定してください';
const BAD_SHAPE = '入力内容を確認してください';
const BAD_REQUEST = '不正なリクエストです';

const MIN_REVIEW_CHARS = 5;
const MAX_REVIEW_CHARS = 2000;

export class GenerateHandler {
  #profiles;
  #usage;
  #generator;

  constructor(profiles, usage, generator) {
    this.#profiles = profiles;
    this.#usage = usage;
    this.#generator = generator;
  }

  async handle(request, userId) {
    // 「JSONとして壊れている」と「JSONではあるが形が違う」を分けて返す。
    // 他の4実装が別の文言を返しているので、ここも合わせる。
    let decoded;
    try {
      decoded = parseJson(request.body);
    } catch {
      return Response.error(400, BAD_REQUEST);
    }

    const review = isPlainObject(decoded) ? decoded.review : undefined;
    if (!isPlainObject(review)) {
      return Response.error(400, BAD_SHAPE);
    }

    const text = review.reviewText;
    if (typeof text !== 'string') {
      return Response.error(400, BAD_SHAPE);
    }

    // 長さは text.length ではなく [...text].length で数える。
    //
    // JavaScript の String#length は UTF-16 のコード単位を返すので、
    // BMP外の文字（「𩸽」のような一部の漢字、絵文字）が2として数えられる。
    // PHPの mb_strlen・Rubyの String#length・Goの utf8.RuneCountInString は
    // どれもコードポイントで数えるため、そこだけ答えが食い違う。
    // スプレッドはコードポイント単位で回るのでこちらに揃う。
    const length = [...text].length;
    if (length < MIN_REVIEW_CHARS || length > MAX_REVIEW_CHARS) {
      return Response.error(400, BAD_SHAPE);
    }

    // 星は整数だけを受ける。5.0(浮動小数)や "5"(文字列)は弾く。
    // JSONを読んだ時点では 5.0 と 5 の区別が消えているので、
    // src/http/json.js が元の文字列を見て NonIntegerNumber に置き換えている。
    const rating = review.rating;
    if (rating instanceof NonIntegerNumber || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return Response.error(400, BAD_SHAPE);
    }

    let profile;
    try {
      profile = await this.#profiles.find(userId);
    } catch (e) {
      if (e instanceof ProfileNotFound) {
        return Response.error(400, NEED_PROFILE);
      }
      logFailure('プロフィールの取得に失敗', e);

      return Response.error(500, INTERNAL_ERROR);
    }

    if (profile.storeName === '') {
      return Response.error(400, NEED_PROFILE);
    }

    const monthlyLimit = limit(profile.plan);

    // 上限チェックと加算はDB関数の中で原子的に行う。
    // ここで「読んでから書く」と、同時リクエストが上限を超えて通る隙間ができる。
    let used;
    try {
      used = await this.#usage.increment(userId, currentMonthKey());
    } catch (e) {
      if (e instanceof LimitExceeded) {
        return Response.error(429, limitMessage(profile.plan, monthlyLimit));
      }
      if (e instanceof PlanNotFound) {
        // プロフィール行が無い・未知のプラン。DB側が加算を拒否している。
        return Response.error(400, NEED_PROFILE);
      }
      logFailure('利用回数の加算に失敗', e);

      return Response.error(500, INTERNAL_ERROR);
    }

    let result;
    try {
      result = await this.#generator.generate(profile, { text, rating });
    } catch (e) {
      logFailure('生成に失敗', e);

      return Response.error(500, INTERNAL_ERROR);
    }

    return Response.json(200, {
      replies: result.replies.map((r) => ({ style: r.style, text: r.text })),
      mock: result.mock,
      usage: { used, limit: monthlyLimit },
    });
  }
}

/**
 * 素のオブジェクトかどうか。
 *
 * typeof null === 'object' なので null を先に外す。配列を通すと
 * review が [] のときに review.reviewText が undefined のまま先へ進む。
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 失敗の記録。
 *
 * 例外メッセージには接続文字列やAPIキーが混ざりうるので、そのままは出さない。
 * 種類(クラス名)と、こちらで書いた説明だけを残す。
 */
function logFailure(what, e) {
  console.error(`${what}: ${e?.constructor?.name ?? 'Error'}`);
}
