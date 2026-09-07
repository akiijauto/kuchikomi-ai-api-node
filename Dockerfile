# syntax=docker/dockerfile:1

# Node.js実装の実行イメージ。
# Go版(distroless)/Rails版(ruby:slim)/PHP版(php:cli)と並べて、同じ機能が実行時に
# 何を必要とするかを比べられるようにしてある。テーブル定義の正本はここには置かず、
# 元リポジトリ(kuchikomi-ai-multi-stack)のままにしてある。
# このイメージ自体はDBスキーマの投入をしない。

# ---- 依存関係のインストール ----
# 依存だけを先に入れて、アプリ本体(src)の変更ではこの層が再利用されるようにする
# (package.json / package-lock.json が変わらない限り)。
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm install ではなく npm ci。lock を正として入れ直すので、
# 手元とCIとイメージで版が食い違わない。
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 実行イメージ ----
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# 非rootユーザーで動かす。node公式イメージには node (uid=1000) が最初から
# 存在するのでそれを使う(Rails版が独自にrailsユーザーを作っているのとは対照的)。
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# HEALTHCHECKの方式について:
# curl を入れず、アプリ自身の --healthcheck に自己診断させている。
# Go版がシェルの無いdistrolessのためにバイナリへ -healthcheck を持たせたのと同じ形で、
# PHP版(curlを入れてHTTPで叩く)とは逆の判断。curlを足すとイメージが太るだけでなく、
# 侵入されたときに中で使える道具が1つ増える。
#
# exec フォームなのでシェルを介さない。そのため ${PORT} は展開されないが、
# アプリが自分の設定からポートを読むので指定する必要がない。
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "src/server.js", "--healthcheck"]

# node をPID 1にすると SIGTERM を自分で受けられる(server.js が listen している)。
# npm start 経由にすると npm がPID 1になり、シグナルがアプリまで届かず
# 停止に10秒かかる。
CMD ["node", "src/server.js"]
