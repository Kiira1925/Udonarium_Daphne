# Udonarium DaphneをCloudflare Quick Tunnelで一時公開する

Qiitaの記事と同じ方向性で、ローカルPC上のUdonarium DaphneをCloudflare Quick Tunnel経由で一時公開できます。

## 準備

1. `cloudflared` をインストールします。

   ```bat
   winget install --id Cloudflare.cloudflared
   ```

2. `.env.public.example` を `.env.public` にコピーし、SkyWayの値を設定します。

   ```env
SKYWAY_APP_ID=your-skyway-application-id
SKYWAY_SECRET_KEY=your-skyway-secret-key
SKYWAY_LOBBY_SIZE=4
PORT=4200
CLOUDFLARED_PROTOCOL=http2
```

`.env.public` は秘密鍵を含むため、git管理から除外しています。

## 起動

`start-public-cloudflare.bat` を実行します。

起動後、ターミナルに `PUBLIC URL:` として表示される `https://*.trycloudflare.com/` のURLを参加者に共有してください。

現在の公開URLは `public-url.txt` にも保存されます。ターミナルを見失った場合は、このファイルを開いて最新のURLを確認できます。

`PORT` が既に使用中の場合は、自動的に次の空きポートを使用します。Cloudflareとの接続は既定で `http2` を使用します。QUICを試したい場合は `.env.public` の `CLOUDFLARED_PROTOCOL` を `quic` に変更してください。

## 接続できない場合

- ブラウザで `DNS_PROBE_FINISHED_NXDOMAIN` が表示される場合、その `trycloudflare.com` URLは既に無効になっている可能性が高いです。バッチを起動し直し、新しく表示された `PUBLIC URL` を共有してください。
- Quick TunnelのURLは、バッチを閉じたりPCがスリープしたりすると使えなくなります。
- 古い `cloudflared` のウィンドウが残っている場合は閉じてから、もう一度 `start-public-cloudflare.bat` を実行してください。

## 注意

- Quick TunnelのURLは起動するたびに変わります。
- 公開中は、そのURLを知っている人がアクセスできます。
- PCをスリープしたり、バッチを終了したりすると接続できなくなります。
- ルーム利用後はターミナルを閉じて公開を停止してください。
