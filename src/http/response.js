/**
 * 1レスポンス分のデータ。このAPIはJSONしか返さないので、本文はオブジェクトで持つ。
 *
 * Go版の writeJSON / errorBody、PHP版の App\Http\Response に相当する。
 *
 * ハンドラが ServerResponse を直接触らないのは、テストで実際のHTTPサーバーを
 * 立てずに「何を返したか」を確かめられるようにするため。
 */
export class Response {
  #status;
  #body;

  constructor(status, body) {
    this.#status = status;
    this.#body = body;
  }

  static json(status, body) {
    return new Response(status, body);
  }

  /** 本文を {"error": message} の形に固定する（Go版 errorBody と同じ形）。 */
  static error(status, message) {
    return new Response(status, { error: message });
  }

  get status() {
    return this.#status;
  }

  get body() {
    return this.#body;
  }

  /**
   * node:http の ServerResponse へ書き出す。
   *
   * Content-Length をバイト数で自分から入れているのは、日本語の本文で
   * 文字数とバイト数がずれるため。Buffer.byteLength を使わず
   * 文字列の length を渡すと、日本語を含む応答が途中で切れる。
   */
  send(res) {
    const payload = Buffer.from(JSON.stringify(this.#body), 'utf8');

    res.writeHead(this.#status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': payload.byteLength,
    });
    res.end(payload);
  }
}
