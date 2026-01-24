# Obsidian GDrive Vaultプラグイン

Obsidian用の手動同期プラグイン。VaultをGoogle Driveに同期します。

## 機能

- **手動同期**: 好きなタイミングでPush/Pull
- **競合解決**: ローカルかリモートを選択、マークダウンファイルはSide-by-side diffで差分表示
- **競合バックアップ**: 選択しなかった方を`sync_conflicts/`フォルダに保存、手動マージ用
- **バージョン管理**: 実際に変更がある時のみ同期
- **スマート同期**: フルPush/Pullはハッシュ比較で未変更ファイルをスキップ
- **完了サマリー**: 更新されたファイル一覧と更新時刻を表示
- **並列処理**: 5並列でアップロード/ダウンロード
- **クロスプラットフォーム**: デスクトップ、Android、iOSで動作
- **多言語対応**: 英語・日本語UI

## インストール

このプラグインには自分のOAuthサーバーが必要です。

### 1. OAuthサーバーをデプロイ

詳細は[obsidian-oauth/README_ja.md](obsidian-oauth/README_ja.md)を参照。

1. Google Cloud Projectを作成
2. OAuth同意画面と認証情報を設定
3. Google App Engineにデプロイ

### 2. プラグインをビルド

1. このリポジトリをフォーク
2. `config.ts`にOAuthサーバーURLを設定:
   ```typescript
   export const OAUTH_CONFIG = {
     refreshAccessTokenURL: "https://YOUR_PROJECT.appspot.com/auth/obsidian/refresh-token",
     fetchRefreshTokenURL: "https://YOUR_PROJECT.appspot.com/auth/obsidian",
   };
   ```
4. mainブランチにpush（GitHub Actionがリリースを作成）

### 3. BRATでインストール

1. コミュニティプラグインから[BRAT](https://github.com/TfTHacker/obsidian42-brat)をインストール
2. BRAT設定を開き「Add Beta plugin」をクリック
3. フォークのURLを入力: `https://github.com/YOUR_USERNAME/obsidian-gdrive-vault`
4. 「Add Plugin」をクリック

### 手動インストール

1. フォークのReleasesから`main.js`と`manifest.json`をダウンロード
2. `.obsidian/plugins/obsidian-gdrive-vault/`フォルダを作成
3. ファイルをコピー
4. Obsidian設定でプラグインを有効化

## セットアップ

1. プラグイン設定を開きログインリンクをクリック
2. Googleアカウントでサインインし権限を許可
3. Refresh Tokenをコピーして設定に貼り付け
4. プラグインを再読み込み
5. 「Initialize vault」をクリックしてGoogle DriveにVaultフォルダを作成

![初期設定](initial_setting.png)

追加デバイスの場合:
1. 同じ名前のVaultを作成
2. フォークからプラグインをインストール
3. 同じGoogleアカウントで設定
4. **Pull Changes**で全ファイルをダウンロード

## 使い方

### リボンボタン

| ボタン | 動作 |
|--------|------|
| アップロードアイコン | **Push Changes** - ローカルの変更をGoogle Driveにアップロード |
| ダウンロードアイコン | **Pull Changes** - リモートの変更をローカルにダウンロード |

### コマンド（コマンドパレット）

| コマンド | 説明 |
|----------|------|
| `Push changes to Google Drive` | 変更ファイルをアップロード |
| `Pull changes from Google Drive` | 変更ファイルをダウンロード |
| `Full push to Google Drive` | Vault全体をアップロード（未変更ファイルはスキップ） |
| `Full pull from Google Drive` | Vault全体をダウンロード（未変更ファイルはスキップ） |

フル同期操作はファイルハッシュを比較し、既に同一のファイルはスキップします。完了時に実際に更新されたファイルの一覧がダイアログで表示されます。

### 設定

| 設定 | 説明 |
|------|------|
| Exclude patterns | 同期から除外するglobパターン |
| Conflict folder | 競合バックアップの保存先フォルダ名（デフォルト: `sync_conflicts`） |
| Clear conflict files | 競合フォルダ内のファイルを一括削除 |
| Remote Excluded Files | 現在の除外パターンに一致するリモートファイルの表示・削除 |
| Full Push | Vault全体をアップロード |
| Full Pull | Vault全体をダウンロード |

![設定画面](settings.png)

デフォルト除外パターン:
- `.obsidian/**` - Obsidian設定フォルダ
- `.**` - ドットファイル
- `.*/**` - ドットフォルダ
- `sync_conflicts/**` - 競合バックアップフォルダ

## 同期の仕組み

### メタファイル

プラグインはメタファイルで同期状態を追跡:

| 場所 | ファイル |
|------|----------|
| ローカル | `.obsidian/gdrive-vault-meta.json` |
| リモート | `_gdrive-vault-meta.json` |

メタファイル構造:
```json
{
  "lastUpdatedAt": "2024-01-24T10:30:00.000Z",
  "lastSyncTimestamp": "2024-01-24T10:30:00.000Z",
  "files": {
    "notes/daily.md": {
      "hash": "sha256...",
      "modifiedTime": "2024-01-24T09:15:00.000Z"
    }
  }
}
```

### 最終更新日時

- ファイルが実際にアップロード/削除された時のみ更新
- リモートに新しい変更があるか検出に使用
- 設定画面で確認可能
- 変更なし = タイムスタンプ変更なし

### Push Changesのフロー

1. **リモートにメタなし**: 全アップロード、現在時刻でメタ作成
2. **ローカルにメタなし**: ハッシュ比較、異なれば競合表示、その後Push
3. **ローカルが新しいか同じ**: 変更ファイルをアップロード、タイムスタンプを更新
4. **リモートが新しい**: 競合チェック、あればダイアログ表示

### Pull Changesのフロー

1. **リモートにメタなし**: 何もしない
2. **ローカルにメタなし**: ハッシュ比較、異なれば競合表示、その後ダウンロード
3. **ローカルが新しいか同じ**: 何もしない
4. **リモートが新しい**: 変更ファイルをダウンロード、削除されたファイルを削除

### 競合解決

ローカルとリモートの両方で同じファイルが変更された場合:

| オプション | 動作 |
|------------|------|
| ローカルを保持 | ローカル版をリモートにアップロード、リモート版を`sync_conflicts/`に保存 |
| リモートを保持 | リモート版をローカルにダウンロード、ローカル版を`sync_conflicts/`に保存 |

**機能:**
- **Side-by-side diff表示** - マークダウンファイルのローカル・リモート差分を並列表示
- **モバイル対応** - 狭い画面では縦並びレイアウト
- **競合フォルダにバックアップ** - 選択しなかった方を`sync_conflicts/ファイル名_YYYYMMDD_HHMMSS.ext`として保存
- **手動マージ対応** - バックアップファイルを使って手動でマージ可能

競合フォルダは自動的に同期対象外になります。不要になったバックアップファイルは設定画面または手動で削除してください。

### 同期完了ダイアログ

同期完了後、実際に転送されたファイルの一覧がダイアログで表示されます:

![アップロード完了](uploaded.png)

**Push Changes:**
- Google Driveに**アップロード**されたファイルを表示
- 「リモートを保持」を選択したファイルは表示されません（ローカルにバックアップされるのみ）

**Pull Changes:**
- Google Driveから**ダウンロード**されたファイルを表示
- 「ローカルを保持」を選択したファイルは表示されません（リモート版が競合フォルダにバックアップされるのみ）

**Full Push/Pull:**
- 実際に転送されたすべてのファイルを表示
- スキップされたファイル数を表示（ハッシュが一致する未変更ファイル）

ダイアログは「OK」をクリックして閉じる必要があり、同期結果を確実に確認できます。

## FAQ

### モバイルで動作しますか？

はい！AndroidとiOSで動作します。デスクトップと同じ方法でインストール。

### Vault名はデバイス間で一致させる必要がありますか？

はい。プラグインはVault名で同期対象を識別します。

### Google Driveに直接ファイルを追加できますか？

いいえ。プラグインは自身が作成したファイルのみアクセス可能（セキュリティ制限）。

### なぜファイルがGoogle Driveでフラットに保存されるのですか？

実装がシンプルになるためです。Obsidianは`folder/subfolder/note.md`のようなファイル名からフォルダ構造を再構築できます。

### ファイルを除外するには？

設定でglobパターンを追加:
- `*.tmp` - .tmpファイルを除外
- `drafts/**` - draftsフォルダを除外
- `**/private/**` - 「private」フォルダを除外

### 除外設定したファイルがリモートに残っている場合は？

除外ファイルは意図的にGoogle Driveに残されます。これによりデバイスごとに異なる除外パターンを使用できます。例：
- デスクトップA: すべてを同期
- デスクトップB: `large-assets/**`を除外
- モバイル: `large-assets/**`と`archives/**`を除外

各デバイスは自身の除外パターンに一致するファイルのみダウンロード/アップロードしますが、あるデバイスで除外されたファイルも他のデバイス間では同期できます。

リモートから除外ファイルを削除するには、設定の**Remote Excluded Files**を使用してください。

## トラブルシューティング

1. プラグインが有効か確認
2. Refresh Tokenが正しいか確認
3. インターネット接続を確認
4. コンソールでエラーメッセージを確認（Ctrl+Shift+I）


## ライセンス

MIT
