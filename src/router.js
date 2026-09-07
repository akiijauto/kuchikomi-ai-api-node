import { Response } from './http/response.js';

/**
 * 「メソッド＋パス」の完全一致だけで引く素朴なルータ。
 *
 * Go版はルーティング用のライブラリを入れず net/http.ServeMux だけで済ませ、
 * PHP版もフレームワークを足さなかった。この規模でExpressやFastifyを入れる
 * 理由がないという判断をNode版でも踏襲する。
 *
 * 一致しなければメソッド違いも含めて一律404にするのはPHP版と同じ。
 * Go 1.22 の ServeMux は405を返し分けるが、この規模では過剰と判断した。
 */
export class Router {
  #routes = new Map();

  add(method, path, handler) {
    this.#routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  async dispatch(request) {
    const handler = this.#routes.get(`${request.method.toUpperCase()} ${request.path}`);
    if (handler === undefined) {
      return Response.error(404, '見つかりません');
    }

    return handler(request);
  }
}
