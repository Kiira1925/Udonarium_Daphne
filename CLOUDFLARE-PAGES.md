# Cloudflare Pages + Functions への移行手順

Udonarium Daphne を Cloudflare Pages + Functions に配置するための設定メモです。

## 構成

- Angular の静的ファイルを Cloudflare Pages で配信します。
- SkyWay 2023 のトークン発行 API を Pages Functions の `/v1/skyway2023/token` に配置します。
- アプリ側は既存どおり同一オリジンの `/v1/status` と `/v1/skyway2023/token` を参照します。

## リポジトリ側の設定

このリポジトリには Pages Functions 用のファイルを追加済みです。

- `functions/v1/status.js`
- `functions/v1/skyway2023/token.js`
- `src/_routes.json`

`_routes.json` はビルド時に `dist/udonarium-daphne/_routes.json` へコピーされます。Functions の呼び出し対象は `/v1/*` のみにしています。

## Cloudflare Pages の作成

1. Cloudflare ダッシュボードで Workers & Pages を開きます。
2. Pages から GitHub リポジトリ `Kiira1925/Udonarium_Daphne` を接続します。
3. ビルド設定を以下にします。

```text
Framework preset: Angular または None
Build command: npm run build:pages
Build output directory: dist/udonarium-daphne
Root directory: /
```

## 環境変数

Pages の Settings > Environment variables に以下を設定します。

```text
SKYWAY_APP_ID=SkyWay の Application ID
SKYWAY_SECRET_KEY=SkyWay の Secret Key
```

任意で以下も設定できます。

```text
SKYWAY_LOBBY_SIZE=4
SKYWAY_TOKEN_TTL_SEC=86400
```

Secret Key は必ず Cloudflare の環境変数として保存し、リポジトリには含めないでください。

## 動作確認

デプロイ後、以下を確認します。

```text
https://<project>.pages.dev/v1/status
```

`skyway` が `true` なら SkyWay 用の環境変数が認識されています。

```json
{"ok":true,"skyway":true}
```

アプリ本体は以下で開きます。

```text
https://<project>.pages.dev/
```

## ローカル確認

Pages 用ビルドは以下で実行できます。

```bash
npm run build:pages
```

Cloudflare Functions まで含めたローカル確認には Wrangler を使います。

```bash
npx wrangler pages dev dist/udonarium-daphne --compatibility-date=2026-06-13
```

ローカルで Functions の環境変数を使う場合は、Wrangler の `.dev.vars` やダッシュボード側の設定を利用してください。

## 補足

Quick Tunnel の `trycloudflare.com` URL は一時公開用で、起動し直すたびに URL が変わり、古い URL は無効になります。常設公開では Pages の `pages.dev` URL または独自ドメインを使ってください。
