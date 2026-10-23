# generate-dragon

Cloudflare Workers上で動く、発表ドラゴン画像を作るDiscord Botです。
`/generate_dragon`でテキスト・画像・テキスト＋画像を指定すると、1600×900のPNGを返信します。

DiscordのHTTP Interactionsでコマンドを受信し、署名を検証して遅延応答を返します。
日本語フォントから文字をSVGのパスへ変換し、素材・添付画像と合成したSVGをresvgのWasmでPNGに変換します。
常時接続、discord.js、node-canvas、動画処理、Dockerは使いません。

## セットアップ

Node.js 22.18以降とCloudflareのアカウントが必要です。

```sh
npm ci
cp .dev.vars.example .dev.vars
cp .env.example .env
```

Discord Developer PortalのGeneral InformationにあるPublic Keyを`.dev.vars`の`DISCORD_PUBLIC_KEY`へ設定します。
`.env`にはコマンド登録用の`DISCORD_APPLICATION_ID`と`DISCORD_BOT_TOKEN`を設定します。
開発サーバーだけに登録するときは`DISCORD_GUILD_ID`も設定してください。空欄ならグローバル登録になります。
Botトークンは登録スクリプトだけが使用し、Workerには不要です。

```sh
npm run register-commands
npm run dev
```

既存のDiscordアプリを使えます。登録処理は`generate_dragon`だけを追加・更新します。
以前にGuild用として登録したコマンドがある場合は、同じGuild IDを指定して更新してください。

## デプロイ

本番URL: <https://generate-dragon.chigansub.workers.dev>

Discordの受信URL: <https://generate-dragon.chigansub.workers.dev/interactions>

Cloudflareには`DISCORD_PUBLIC_KEY`をSecretとして設定します。
`DISCORD_BOT_TOKEN`と`DISCORD_APPLICATION_ID`はローカルの`.env`でコマンド登録に使用します。
`ASSETS`は`wrangler.jsonc`で定義したStatic Assets bindingです。

```sh
npx wrangler login
npx wrangler secret put DISCORD_PUBLIC_KEY
npm run deploy
```

`secret put`の入力にはDiscordアプリのPublic Keyを指定してください。
Discord Developer PortalのInteractions Endpoint URLへ、デプロイしたWorkerのURLに`/interactions`を付けて設定します。
例: `https://generate-dragon.<subdomain>.workers.dev/interactions`
署名検証とPING応答が成功すると保存できます。
HTTP方式への切り替えに伴い、旧BotのGateway接続によるオンライン表示・アクティビティ設定は行いません。

素材画像とフォントは`public/`からStatic Assetsとして同時にデプロイします。
WorkerはAssets bindingで読み込み、素材ファイルの公開ルートは提供しません。
画像パス用の環境変数と`DISCORD_BOT_NAME`は不要です。

## コマンド

| 引数 | 内容 |
| --- | --- |
| `title` | 下部のタイトル。必須、200文字以内 |
| `type` | `text` / `image` / `text_image`。必須 |
| `content` | 吹き出しの文字。テキストを含むモードで必須、1000文字・40行以内。`\n`または実改行で改行 |
| `image` | 画像を含むモードで必須。PNG・JPEG・GIF、8MB以内、各辺4096px・合計800万画素以内 |

GIFも出力は静止PNGです。添付画像は縦横比を維持して吹き出し内に収めます。
生成・送信に失敗した場合は遅延応答をエラーメッセージに更新します。

## 開発コマンド

```sh
npm run typegen  # Wrangler設定からWorkerの型を生成
npm run check    # TypeScriptの型チェック
npm run compile  # 型チェックとデプロイ用ビルド（デプロイしない）
npm test         # workerd上で画像生成・Discord応答を検証
```

画像生成はHTTP応答後に`ctx.waitUntil()`で処理します。応答後の実行猶予は30秒です。
無料プランのCPU上限は10msのため、Wasmによる画像生成の運用にはWorkers Paidを想定しています。

`npm test`は実際のWorkerとStatic Assetsをローカルのworkerdで実行します。
Discord APIと添付画像の取得だけをテスト用に差し替えるため、トークンや外部への投稿は不要です。
3種類の生成モード、日本語、改行、長文、40行、縦長・横長の画像、PNG・JPEG・GIF、同時生成と取得失敗時の応答を検証します。
生成PNG・一覧画像・処理時間は`.wrangler/generation-validation/`に保存します。
本番Cloudflare上のCPU時間・メモリ使用量や、実際のDiscordとの接続は別途確認してください。

## 使用ライブラリ

| ライブラリ | 用途 |
| --- | --- |
| `discord-api-types` | Discord APIの型・定数 |
| `opentype.js` | 日本語フォントの計測とSVGパス生成 |
| `@resvg/resvg-wasm` | SVGからPNGへの変換 |
| `wrangler` | ローカル実行・型生成・デプロイ |

## 素材

- `public/img/dragon.png`: [ニコニコモンズ nc355601](https://commons.nicovideo.jp/works/agreement/nc355601)
- `public/img/balloon.png`: [ニコニコモンズ nc355602](https://commons.nicovideo.jp/works/agreement/nc355602)
- `public/font/GenJyuuGothic-Normal.ttf`: 日本語描画用フォント

## 参考

- [Discord HTTP Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Workersの実行時間・CPU制限](https://developers.cloudflare.com/workers/platform/limits/)
