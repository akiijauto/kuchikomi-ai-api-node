import { Response } from '../http/response.js';

/**
 * 死活監視。
 *
 * 他の4実装と同じく、認証基盤にもDBにも依存させない。
 * ここがDBを見に行くと「アプリは生きているがDBが不調」のときに
 * コンテナごと落とされ、どちらが壊れているのか切り分けられなくなる。
 */
export class HealthHandler {
  #startedAt;

  constructor(startedAt) {
    this.#startedAt = startedAt;
  }

  async handle() {
    const uptime = (performance.now() - this.#startedAt) / 1000;

    return Response.json(200, { status: 'ok', uptime: Number(uptime.toFixed(3)) });
  }
}
