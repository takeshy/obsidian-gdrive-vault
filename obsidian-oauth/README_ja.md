# GDrive Vault用OAuthサーバー

このディレクトリにはGDrive VaultプラグインのGoogle認証を処理するOAuthサーバーが含まれています。

## 前提条件

- Google Cloud Platformアカウント
- gcloud CLIのインストールと設定

## セットアップ手順

### 1. Google Cloud Projectの作成

1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. 「プロジェクトを選択」→「新しいプロジェクト」をクリック
3. プロジェクト名を入力して「作成」をクリック
4. プロジェクトが作成されたら選択

### 2. Google Drive APIの有効化

1. 「APIとサービス」→「ライブラリ」に移動
2. 「Google Drive API」を検索
3. クリックして「有効にする」をクリック

### 3. OAuth同意画面の設定

1. 「APIとサービス」→「OAuth同意画面」に移動
2. 「外部」ユーザータイプを選択して「作成」をクリック
3. 必須項目を入力:
   - アプリ名: 任意の名前（例: 「GDrive Vault」）
   - ユーザーサポートメール: あなたのメールアドレス
   - デベロッパーの連絡先メール: あなたのメールアドレス
4. 「保存して続行」をクリック
5. 「スコープ」ページで「スコープを追加または削除」をクリック
6. スコープを追加: `https://www.googleapis.com/auth/drive.file`
7. 「保存して続行」をクリック
8. テストモードの場合はテストユーザーを追加
9. 「保存して続行」をクリック

### 4. OAuth 2.0クライアントIDの作成

1. 「APIとサービス」→「認証情報」に移動
2. 「認証情報を作成」→「OAuthクライアントID」をクリック
3. アプリケーションの種類で「ウェブアプリケーション」を選択
4. 名前を入力（例: 「GDrive Vault OAuth」）
5. 「承認済みのリダイレクトURI」に追加:
   ```
   https://YOUR_PROJECT_ID.appspot.com/auth/obsidian/callback
   ```
   （`YOUR_PROJECT_ID`を実際のプロジェクトIDに置き換え）
6. 「作成」をクリック
7. クライアントIDとクライアントシークレットをコピー

### 5. app.yamlの設定

1. `app.yaml.example`を`app.yaml`にコピー:
   ```bash
   cp app.yaml.example app.yaml
   ```

2. `app.yaml`を編集してプレースホルダーを置き換え:
   ```yaml
   runtime: nodejs22

   env_variables:
     CLIENT_ID: "your-client-id.apps.googleusercontent.com"
     CLIENT_SECRET: "your-client-secret"
     REDIRECT_URI: "https://your-project-id.appspot.com/auth/obsidian/callback"
   ```

### 6. Google App Engineへのデプロイ

1. gcloud CLIがインストール・認証されていることを確認:
   ```bash
   gcloud auth login
   ```

2. プロジェクトを設定:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

3. アプリをデプロイ:
   ```bash
   gcloud app deploy
   ```

4. アプリのURLを確認: `https://YOUR_PROJECT_ID.appspot.com`

### 7. プラグインの設定とビルド

1. プラグインリポジトリのルートで`config.ts`を編集:
   ```typescript
   export const OAUTH_CONFIG = {
     refreshAccessTokenURL: "https://YOUR_PROJECT_ID.appspot.com/auth/obsidian/refresh-token",
     fetchRefreshTokenURL: "https://YOUR_PROJECT_ID.appspot.com/auth/obsidian",
   };
   ```

2. プラグインをビルド:
   ```bash
   pnpm install
   pnpm build
   ```

3. `main.js`と`manifest.json`をプラグインフォルダにコピー（`.obsidian/plugins/obsidian-gdrive-vault/`）

## トラブルシューティング

### 「Access blocked: This app's request is invalid」

- OAuthクライアントのリダイレクトURIが`app.yaml`のものと一致しているか確認
- URIが`/auth/obsidian/callback`で終わっているか確認

### 「Error 403: access_denied」

- アプリがテストモードの場合、GoogleアカウントがテストユーザーとLて追加されているか確認
- 全ユーザー向けに公開するには、OAuth同意画面で「アプリを公開」をクリック

### 「Error: redirect_uri_mismatch」

- OAuthクライアント認証情報のリダイレクトURIが`app.yaml`のものと完全に一致する必要がある
- 末尾のスラッシュやプロトコルの不一致（http vs https）を確認

## セキュリティに関する注意

- 実際のクレデンシャルを含む`app.yaml`をコミットしない（`.gitignore`に含まれています）
- クライアントシークレットは機密に保つ
- 必要なスコープのみにAPIアクセスを制限することを検討
