# kuchikomi-ai-api-node

稼働中の個人開発サービス「クチコミ返信AI」のAPIを **Node.js（素のJavaScript）** で実装したもの。

同じ仕様の実装が5つある。これはその5つ目で、**同じ入力に同じ答えを返すこと**を条件に書いている。

| 実装 | リポジトリ |
| --- | --- |
| TypeScript (Next.js) | [kuchikomi-ai-multi-stack](https://github.com/akiijauto/kuchikomi-ai-multi-stack) の `web/` |
| Ruby (Rails) | [kuchikomi-ai-api-rails](https://github.com/akiijauto/kuchikomi-ai-api-rails) |
| Go | [kuchikomi-ai-api-go](https://github.com/akiijauto/kuchikomi-ai-api-go) |
| PHP | [kuchikomi-ai-api-php](https://github.com/akiijauto/kuchikomi-ai-api-php) |
| **JavaScript (Node.js)** | ここ |

Webフレームワークを使わない。`node:http` だけで書いてある（Go版が `net/http` のみ、
PHP版がフレームワーク無しで書かれているのと同じ判断）。

## なぜ同じものを何度も書くのか

「フレームワークが何をやってくれていたのか」は、**自分で書いて初めて分かる**から。

Next.js版を書いていたときは、JWTの署名方式を検証する必要があることすら意識していなかった。
Supabaseのクライアントがやってくれていたからで、それに気づいたのはGo版で認証を自分で書いたとき。

そしてこのNode.js版で分かったのは、**TypeScript版が実行時に抱えていた弱点**だった。
下の「JavaScriptだけが取りこぼしていたもの」に書いた `5.0` の話は、
TypeScript版にもそのまま当てはまる。型を書いていても、実行時に消える情報は消える。

## エンドポイント

| メソッド | パス | 認証 | 内容 |
| --- | --- | --- | --- |
| GET | `/api/health` | 不要 | 死活監視。DBを見に行かない |
| POST | `/api/generate` | 必要 | クチコミへの返信案を作る |
| POST | `/api/demo/token` | 不要 | デモ用トークン。`DEMO_MODE=1` のときだけ生える |

`/api/health` がDBを見に行かないのは意図的で、
ここでDBを触ると「アプリは生きているがDBが不調」のときにコンテナごと落とされ、
**どちらが壊れているのか切り分けられなくなる**。

## JavaScriptだけが取りこぼしていたもの

他の4実装では素直に書けたのに、JavaScriptでは同じようには書けなかったところ。
**5実装で答えを揃える、という条件を置いたから見つかった。**

### 1. `5.0` と `5` の区別が、パースし終えた時点で消えている

星は整数だけを受ける仕様で、`5.0` も `"5"` も弾く。他の3実装は素直に書ける。

| 実装 | `5.0` を弾く方法 |
| --- | --- |
| PHP | `is_int(5.0)` が `false`（floatとintが別の型） |
| Go | `json.Number` を `Atoi("5.0")` にかけると失敗する |
| Ruby | `Integer === 5.0` が `false` |
| **JavaScript** | **書けない** |

```js
JSON.parse('5.0') === 5            // true
Number.isInteger(JSON.parse('5.0')) // true
```

JavaScriptの数値は倍精度浮動小数ひとつしかないので、`5.0` を読み終えた時点で
`5` と見分けが付かない。**TypeScriptでも同じ**で、`rating: number` と書いても
実行時には何も残らない。

Node.js 22 以降の `JSON.parse` は、リバイバの第3引数で**元の文字列**を受け取れる
（JSON.parse source text access）。これを使って、整数リテラルとして書かれて
いなかった数値を別の型へ置き換えている（[`src/http/json.js`](src/http/json.js)）。

```js
JSON.parse('5.0', (key, value, context) => context.source) // '5.0'
```

対応していない実行環境では**このAPIだけが他の4実装より緩くなる**。
黙って緩くなるのが一番まずいので、起動時に警告を出し、テストでも落とすようにしてある。
`package.json` の `engines` が Node.js 22 以上を要求しているのはこのため。

### 2. 文字数が UTF-16 のコード単位で数えられる

口コミは5文字以上2000文字以下。`String#length` はコード単位を返すので、
BMP外の文字（一部の漢字や絵文字）が2として数えられる。

```js
'𩸽𩸽𩸽'.length      // 6
[...'𩸽𩸽𩸽'].length // 3
```

PHPの `mb_strlen`・Rubyの `String#length`・Goの `utf8.RuneCountInString` は
どれもコードポイントで数えるので、`length` のままだと**3文字の口コミが6文字として通る**。
スプレッドで展開して数えることで揃えている。

（PHP版では逆に、`strlen`（バイト数）を使うと「美味しい」が12文字と判定される、
という別の形の同じ失敗があった。数え方は実装ごとに違う、という一点に尽きる。）

### 3. インターフェースが無いので、差し替えの正しさを言語が保証しない

PHP版・Go版は `ProfileReader` / `UsageCounter` というインターフェースを切って、
テストではダミー実装に差し替えていた。名前を間違えれば型検査で落ちる。

JavaScriptには型としてのインターフェースが無く、**同じ名前のメソッドを持っていれば
差し替わる**。楽な代わりに、名前を間違えても実行するまで気づけない。
[`test/fakes.js`](test/fakes.js) に本物と突き合わせて書いてあるのはそのためで、
本物のメソッド名を変えたらここも一緒に変える必要がある。**これは規律であって、保証ではない。**

### 4. シングルスレッドでも、上限判定の隙間は開く

「JavaScriptはシングルスレッドだから同時実行の心配が要らない」は成り立たない。
`await` のたびに別のリクエストが進むので、「今の件数を読む→上限と比較する→書く」を
アプリ側で書けば、読んだ直後の隙間に割り込まれる。

上限の判定と加算はDB関数 `public.increment_usage` の中で完結させてある。
5実装すべてが同じ関数を呼ぶので、**上限の挙動は実装によらず一致する**。

### 5. `Content-Length` は文字数ではなくバイト数

`JSON.stringify(...).length` を `Content-Length` に入れると、日本語を含む応答が
途中で切れる。`Buffer.byteLength` で数えている。

### 6. プランの表を素の添字で引くと、プロトタイプの値を拾う

```js
const LIMITS = { free: 5, pro: 300 };
LIMITS['constructor'] // 関数が返る（上限として使えない値）
```

`Object.hasOwn` で自分の持ち物に限っている。未知のプラン名は `free` と同じ扱い、
というのが他の4実装と揃えた仕様で、そこに `constructor` も含まれる。

### 7. 鍵の長さは、ライブラリが見てくれるとは限らない

PHP版が `JWT_SECRET` に32バイト以上を要求しているのは、`firebase/php-jwt` が
短い鍵を拒むから。**`jose` は16バイトの鍵でもHS256の署名・検証を通す**（実測）。

つまりNode版は「通してしまえる」側にいる。それでも同じ制約を入れたのは、
`JwtVerifier` がトークン検証の失敗をすべて401にまとめているため。弱い鍵をそのまま
通すと、鍵の強度の問題が「トークンが無効です」に化けて表に出てこない。
**ライブラリの制約ではなく、こちらの判断として入れている**（[`src/config.js`](src/config.js)）。

## 5実装で挙動を揃えるためにやっていること

### 上限判定はアプリに持たせない

上で書いたとおり、DB関数 `public.increment_usage` が上限の比較と加算を1つのSQL文の
中で完結させる。アプリ側に持たせていたら、APIを2つ並べた時点で枠が2倍になっていた
（これは Go版と Rails版をAWSで同時に動かして実測してある）。

### 集計月はUTCで切る

実行環境のタイムゾーンで切ると、同じ利用者が別々の月として数えられ、実装で答えが変わる。
`toISOString()` が常にUTCを返すことに乗っている（`getMonth()` は実行環境のタイムゾーン）。

### 文言とステータスコードを変えない

「JSONとして壊れている」(`不正なリクエストです`) と「JSONではあるが形が違う」
(`入力内容を確認してください`) を分けて返す。同じ文言にすると、送り手はどちらを
直せばよいのか分からない。

### 既定モデルを揃える

5実装とも `claude-sonnet-4-6`。ここがずれると、出力の違いが「言語の違い」なのか
「設定の違い」なのか分からなくなる。**替えるときは5実装をまとめて替える。**

## 実装ごとの違い

揃えなかったところ。理由があって違えている。

| | Go | PHP | Node.js |
| --- | --- | --- | --- |
| DB接続 | 起動時に開く | リクエストごと | 最初に必要になったとき |
| Anthropic呼び出し | 公式SDK | curl直叩き | 公式SDK |
| JWT | golang-jwt | firebase/php-jwt | jose |
| 短い鍵 | 通す | 拒む | 拒む（自分の判断） |
| HEALTHCHECK | バイナリの `-healthcheck` | curl | `node src/server.js --healthcheck` |
| 実行イメージ | distroless | php:cli | node:slim |

DB接続を遅延させたのは、DBの設定が無い環境でも `/api/health` を動かすため
（CIでコンテナを起動して死活監視だけ確かめられる）。その代わり `DATABASE_URL` の
書き間違いは起動時ではなく最初の `/api/generate` で表に出る。

HEALTHCHECKにcurlを入れなかったのは、イメージが太るだけでなく、
侵入されたときに中で使える道具が1つ増えるから。

## 動かす

```bash
cp .env.example .env   # JWT_SECRET を32バイト以上にする
npm ci
npm start
```

```bash
curl -s localhost:3000/api/health
# {"status":"ok","uptime":0.42}
```

`ANTHROPIC_API_KEY` が未設定なら、返信生成はモック（`"mock": true`）を返す。
鍵が無くても認証・上限・応答形式まで通して確かめられる。

テーブルは `db/init/01_schema.sql` で作れる（元リポジトリの `web/supabase/schema.sql`
の複製。**変更は必ず本体側で行う**）。

## テスト

```bash
npm test
```

外部への通信もPostgreSQLも要らない。ハンドラは依存を引数で受け取るので、
入力の検証を確かめたいだけのテストがDB待ちにならない。

Anthropicの呼び出しは、差し替えたクライアントで「送る中身」と「受け取った結果の扱い」
だけを見ている。APIキーも課金も要らない。

## Docker

```bash
docker build -t kuchikomi-node .
docker run --rm -p 3000:3000 -e JWT_SECRET=... kuchikomi-node
```

非rootユーザー（`node`）で動く。CIではビルドしたイメージを起動して
`/api/health` が応答すること・`HEALTHCHECK` が `healthy` になること・
`USER` が `node` であることまで確かめている（ビルドが通ることと、起動して応答することは別）。

## ライセンス

MIT
