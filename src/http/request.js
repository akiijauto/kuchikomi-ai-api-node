/**
 * 1リクエスト分の素データ。
 *
 * node:http の IncomingMessage をそのまま持ち回らず値オブジェクトにしているのは、
 * ハンドラのテストで実際のサーバーを立てずに任意のリクエストを組み立てられる
 * ようにするため（PHP版 App\Http\Request と同じ狙い）。
 */
export class Request {
  /**
   * @param {string} method
   * @param {string} path
   * @param {Record<string,string>} headers キーはすべて小文字
   * @param {string} body
   */
  constructor(method, path, headers, body) {
    this.method = method;
    this.path = path;
    this.headers = headers;
    this.body = body;
  }

  /** 大小文字を区別せずヘッダを引く。無ければ undefined。 */
  header(name) {
    return this.headers[name.toLowerCase()];
  }
}

/** 本文の読み取り上限。これを超えるものは読まずに切る。 */
export const MAX_BODY_BYTES = 1048576;

/**
 * IncomingMessage を読み切って Request を作る。
 *
 * 上限を超えたら 413 相当として本文を読むのをやめ、超過したことだけを返す。
 * 「全部読んでから長さを見る」と、その時点でメモリを使い切れてしまう。
 *
 * node:http はヘッダ名を小文字に正規化してくれるので、PHP版のように
 * HTTP_ 接頭辞を剥がす処理は要らない。
 */
export async function readRequest(req) {
  const url = new URL(req.url ?? '/', 'http://localhost');

  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      break;
    }
    chunks.push(chunk);
  }

  if (tooLarge) {
    // 送り手が送り続けている途中で読むのをやめると接続が詰まるので、
    // 残りを捨てる。req.destroy() でもよいが、こちらのほうが
    // 応答を返してから閉じられる。
    req.resume();
  }

  return {
    request: new Request(
      req.method ?? 'GET',
      url.pathname,
      req.headers,
      tooLarge ? '' : Buffer.concat(chunks).toString('utf8'),
    ),
    tooLarge,
  };
}
