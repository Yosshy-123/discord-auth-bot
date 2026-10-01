# discord-auth-bot

Discordサーバー向けの認証Bot。参加者に対して、Discordアカウントのメールアドレス確認 → Cloudflare Turnstileでのbot対策確認 → IP/UA/WebRTC情報の取得、を行い、通過したユーザーにだけ認証ロールを付与します。VPN・Proxy・Torの拒否にも対応しています。

## 機能

- **メール確認**: Discord OAuth2でメールアドレスと確認状態を取得(未設定・未確認は拒否)
- **Bot対策**: Cloudflare Turnstileによる人間確認
- **情報収集**: 認証時のIPアドレス、User-Agent(サーバー/クライアント両方)、WebRTC経由の公開IP
- **VPN/Proxy/Tor拒否**: proxycheck.ioを使い、サーバー管理者が選んだ種別(Tor / VPN / Proxy)を拒否
- **柔軟な設定**: `/config` コマンドのパネルから、チャンネル・ロール・拒否対象をまとめて設定
- **管理コマンド**: `/userinfo` で取得済み情報を確認、`/userdata delete` でユーザーのデータを削除
- **監査ログ**: 設定変更や情報閲覧をログチャンネルと内部監査ログの両方に記録

## 構成

```
src/
├── config.ts          # 環境変数の読み込み・検証
├── db/                 # Drizzle ORMスキーマ、マイグレーション、クエリ層
├── lib/                 # 暗号化、Turnstile、proxycheck.io、Discord OAuth
├── web/                 # 認証サイト(Hono)— ルーティング、セッション、テンプレート
├── discord/             # Botクライアント、スラッシュコマンド、イベント
└── jobs/                # 定期クリーンアップジョブ
```

Bot本体と認証サイトは同一プロセスで動きます。外部公開はCloudflare Tunnel経由を想定しており、アプリ自体は公開ポートを持ちません。

## 必要なもの

- Node.js 22以上
- PostgreSQL 15以上
- Discord Developer Portalで作成したアプリケーション(Bot + OAuth2)
- Cloudflare アカウント(Turnstile、および任意でTunnel)
- (任意)proxycheck.io のAPIキー — VPN/Proxy判定の精度向上に

## セットアップ

### 1. Discordアプリケーションの準備

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot設定で **Server Members Intent** を有効化
3. OAuth2 > Redirects に `${BASE_URL}/auth/callback` を登録
4. Botを招待する際のスコープは `bot applications.commands`、権限は `268454912`(Manage Roles / View Channel / Send Messages / Embed Links)

### 2. 環境変数

```bash
cp .env.app.example .env.app   # Bot/Web用
cp .env.example .env           # docker compose用(Tunnelトークンのみ)
```

`.env.app` の `STATE_HMAC_KEY` と `DATA_ENC_KEYS` はランダム値を生成して設定してください。

```bash
openssl rand -base64 32   # STATE_HMAC_KEY
openssl rand -base64 32   # DATA_ENC_KEYS の "1:<ここ>" 部分
```

各変数の説明は `.env.app.example` 内のコメントを参照してください。

### 3. 外部公開(Cloudflare Tunnel)

1. Cloudflare Zero Trustダッシュボード → Networks → Tunnels → Create a tunnel
2. 発行されたトークンを `.env` の `CLOUDFLARE_TUNNEL_TOKEN` に設定
3. Public Hostnameで、認証サイトのドメイン → Service `HTTP` → `http://app:3000` を設定
4. Access(ログイン必須化)は設定しない — 認証サイトは一般ユーザーが直接アクセスする必要があるため

固定グローバルIPで直接公開する場合は、`src/web/ip.ts` のIP取得方法を環境に合わせて変更してください。

### 4. データベース

```bash
npm install
npm run db:migrate:dev
```

本番環境(コンテナ内)では `npm run db:migrate` を使います(コンパイル済みJSを実行)。

### 5. スラッシュコマンドの登録

```bash
npm run register-commands
```

### 6. 起動

```bash
docker compose up -d --build
```

ローカルで直接動かす場合は `npm run dev`(ホットリロード)または `npm run build && npm start` を使ってください。

## 開発

```bash
npm install
npm run typecheck   # 型チェックのみ
npm run dev         # ローカル起動(tsx watch)
npm run db:generate # スキーマ変更後にマイグレーションを再生成
```

## ライセンス

MIT
