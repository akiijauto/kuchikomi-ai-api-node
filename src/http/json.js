/**
 * JSONの読み取り。
 *
 * ここに独立したモジュールがあるのは、**JavaScriptだけが持っている不利**を
 * 埋めるため。他の4実装（TypeScript/Ruby/Go/PHP）は「星は整数だけを受ける」を
 * 素直に書けるが、素のJavaScriptでは書けない。
 *
 *   JSON.parse('5.0') === 5           // true
 *   Number.isInteger(JSON.parse('5.0'))  // true
 *
 * JSONの 5.0 と 5 は、パースし終えた時点でどちらも同じ数値になっていて
 * 区別が付かない。PHPは float と int を区別し、Goは json.Number を Atoi に
 * かけ、Rubyは Integer かどうかを見るので、この3つは 5.0 を弾く。
 * TypeScript版も実行時はJavaScriptなので同じ弱点を持つ。
 *
 * Node.js 22 以降の JSON.parse は、リバイバの第3引数で**元の文字列**を
 * 受け取れる（JSON.parse source text access）。これを使えば
 * 「書かれていたのが 5 なのか 5.0 なのか」を後から見分けられる。
 */

/**
 * 整数リテラルとして書かれていなかった数値。
 *
 * 数値のまま返すと Number.isInteger を通ってしまうので、
 * 別の型にして「整数ではなかった」ことを呼び出し側へ伝える。
 * value を持っているのはデバッグのためで、判定には使わない。
 */
export class NonIntegerNumber {
  constructor(source, value) {
    this.source = source;
    this.value = value;
  }
}

/** 前後に符号以外の飾りが付かない整数リテラルだけを整数とみなす。 */
const INTEGER_LITERAL = /^-?(?:0|[1-9]\d*)$/;

/**
 * この実行環境が JSON.parse のソーステキスト参照に対応しているか。
 *
 * 対応していない環境では 5.0 と 5 を区別できず、**このAPIだけが
 * 他の実装より緩くなる**。黙って緩くなるのが一番まずいので、
 * 起動時とテストで明示的に確かめる（test/json.test.js 参照）。
 */
export const HAS_SOURCE_TEXT_ACCESS = (() => {
  let seen;
  JSON.parse('1.0', (_key, value, context) => {
    seen = context?.source;
    return value;
  });

  return seen === '1.0';
})();

/**
 * JSONを読む。整数リテラルでなかった数値は NonIntegerNumber になる。
 *
 * 壊れたJSONは SyntaxError のまま投げる（呼び出し側で400に翻訳する）。
 */
export function parseJson(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number') {
      return value;
    }

    const source = context?.source;
    if (typeof source !== 'string') {
      return value;
    }

    return INTEGER_LITERAL.test(source) ? value : new NonIntegerNumber(source, value);
  });
}
