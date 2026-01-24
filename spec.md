# 実装仕様書

Obsidian Google Drive Sync プラグインの技術仕様書

## 概要

ObsidianのVaultをGoogle Driveと同期するプラグイン。オフライン対応、自動同期、複数デバイス間でのVault共有を実現する。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `main.ts` | メインプラグインクラス、設定UI、イベントハンドラ |
| `actions.js` | Google Drive API ラッパー関数群 |
| `esbuild.config.mjs` | ビルド設定 |

## 主要クラス・インターフェース

### driveSyncPlugin クラス (main.ts:165)

Obsidianの`Plugin`クラスを継承したメインクラス。

#### 主要プロパティ

| プロパティ | 型 | 説明 |
|-----------|---|------|
| `settings` | `driveValues` | プラグイン設定 |
| `cloudFiles` | `string[]` | Google Drive上のファイルパス一覧 |
| `localFiles` | `string[]` | ローカルVault内のファイルパス一覧 |
| `syncQueue` | `string[]` | 同期待ちファイルのキュー |
| `pendingSyncItems` | `pendingSyncItemInterface[]` | オフライン時の保留中操作 |
| `connectedToInternet` | `boolean` | インターネット接続状態 |
| `haltAllOperations` | `boolean` | エラー多発時の全操作停止フラグ |

### driveValues インターフェース (main.ts:108)

プラグイン設定の型定義。

| フィールド | 型 | デフォルト値 | 説明 |
|-----------|---|-------------|------|
| `refreshToken` | `string` | `""` | OAuth リフレッシュトークン |
| `accessToken` | `string` | `""` | OAuth アクセストークン |
| `accessTokenExpiryTime` | `string` | `""` | トークン有効期限 |
| `vaultId` | `any` | `""` | Google Drive上のVaultフォルダID |
| `rootFolderId` | `any` | `""` | obsidianルートフォルダID |
| `filesList` | `any[]` | `[]` | Drive上ファイル一覧（オフライン用キャッシュ） |
| `refreshTime` | `string` | `"5"` | 同期間隔（秒） |
| `blacklistPaths` | `string[]` | `[]` | 同期除外パス |
| `forceFocus` | `boolean` | `false` | 強制フォーカスモード |

### pendingSyncItemInterface (main.ts:157)

オフライン操作のキューアイテム。

| フィールド | 型 | 説明 |
|-----------|---|------|
| `fileID` | `string?` | ファイルID（オフライン作成時はダミーUUID） |
| `action` | `"UPLOAD" \| "MODIFY" \| "RENAME" \| "DELETE"` | 操作種別 |
| `timeStamp` | `string` | 操作日時 |
| `newFileName` | `string?` | 新ファイル名（UPLOAD/RENAME時） |
| `isBinaryFile` | `boolean?` | バイナリファイルフラグ |

## 同期フロー

### 1. 初期化 (`initFunction`)

```
1. アクセストークン取得（refreshTokenから）
2. Google Driveの「obsidian」フォルダ検索/作成
3. Vault名と同名のフォルダをDriveから検索
4. 見つかれば既存Vault、なければ新規初期化が必要
5. 定期的なrefreshAll()とcheckAndEmptySyncQueue()を登録
```

### 2. 定期同期 (`refreshAll`)

```
1. トークン有効期限チェック（30分未満なら更新）
2. Drive上のファイル一覧取得
3. cloudFiles と localFiles を比較
4. ローカルにないファイルをダウンロード
5. DriveにないがlastSync済みのファイルを削除
```

### 3. ファイル変更検知

Obsidianのイベントをフックして処理:

| イベント | 処理 |
|---------|------|
| `create` | 新規ファイルをDriveにアップロード |
| `modify` | 2.5秒デバウンス後にsyncQueueに追加 |
| `rename` | Driveのファイル名を更新 |
| `delete` | Driveからファイルを削除 |

### 4. オフライン同期

```
1. connectedToInternet = false 時、操作をpendingSyncItemsに記録
2. pendingSync-gdrive-plugin ファイルに永続化
3. 接続回復時、completeAllPendingSyncs()で順次実行
4. タイムスタンプ比較で競合を解決（新しい方が優先）
```

## 同期追跡メカニズム

### Markdownファイル

YAMLフロントマターの`lastSync`プロパティで追跡:

```yaml
---
lastSync: Sat Dec 06 2025 10:30:00 GMT+0900
---
```

パターン: `metaPattern = /^---\n[\s\S]*---/`
パターン: `driveDataPattern = /\nlastSync:.*\n/`

### バイナリファイル（添付ファイル）

`.attachment-tracking-obsidian-gdrive-sync/` フォルダ内に空ファイルで追跡:
- ファイルパス中の`/`を`.`に置換して保存
- 例: `images/photo.png` → `.attachment-tracking.../images.photo.png`

## Google Drive API (actions.js)

### 関数一覧

| 関数 | 説明 |
|-----|------|
| `getVaultId(accessToken, vault, root)` | Vault名からフォルダIDを取得 |
| `uploadFile(accessToken, fileName, buffer, parentId)` | ファイルアップロード |
| `modifyFile(accessToken, fileId, buffer)` | ファイル内容更新 |
| `renameFile(accessToken, fileId, newName)` | ファイル名変更 |
| `deleteFile(accessToken, fileId)` | ファイル削除 |
| `uploadFolder(accessToken, foldername, rootId)` | フォルダ作成 |
| `getFilesList(accessToken, vault)` | ファイル一覧取得（ページネーション対応） |
| `getFoldersList(accessToken, vault)` | フォルダ一覧取得 |
| `getFile(accessToken, fileId)` | ファイルダウンロード |
| `getFileInfo(accessToken, id)` | ファイルメタデータ取得 |

### Drive上のファイル構造

```
Google Drive/
└── obsidian/                    # rootFolderId
    └── {VaultName}/             # vaultId
        ├── note.md              # フラット構造
        ├── folder1.note2.md     # パスを/→ファイル名に変換
        └── images.photo.png     # 添付ファイルも同様
```

**注意**: Driveではフォルダ階層を再現せず、パス全体をファイル名として保存。

## エラーハンドリング

### レート制限

1分間に5回以上エラーが発生すると`haltAllOperations = true`で全操作停止。

### 接続監視

`checkForConnectivity()`: 5秒間隔でgithub.comへfetchして接続確認。

### ログ機能

| ファイル | 設定 | 内容 |
|---------|-----|------|
| `error-log-gdrive-plugin.md` | `errorLoggingToFile` | エラー詳細 |
| `verbose-log-gdrive-plugin.md` | `verboseLoggingToFile` | 全操作ログ |

## 設定画面 (syncSettings クラス)

### 設定項目

| 項目 | 説明 |
|-----|------|
| Set refresh token | OAuthトークン設定 |
| Initialize vault | 新規Vault初期化 |
| Set refresh time | 同期間隔（秒） |
| Auto refresh binary files | バイナリ自動同期 |
| Blacklist paths | 除外パス（カンマ区切り） |
| Force Focus Mode | 編集フォーカス維持 |
| Enable Error/Verbose logging | ログ出力 |

## コマンド

| コマンドID | 説明 |
|-----------|------|
| `drive-upload-current` | 現在のファイルをアップロード |
| `drive-download-current` | 現在のファイルをダウンロード |
| `toggle-force-sync` | 強制フォーカスモード切替 |

## 除外ファイル

以下のファイルは同期対象外:

```javascript
const ignoreFiles = [
    "pendingSync-gdrive-plugin",
    "error-log-gdrive-plugin.md",
    "verbose-log-gdrive-plugin.md",
];
```

## 既知の制限事項

1. 1000ファイル以上のVaultでは最適化されていない
2. バイナリファイルの同期は実験的機能
3. テンプレートから作成したノートは`lastSync`タグが引き継がれ削除される可能性あり（ブラックリスト設定で回避）
4. Driveには自分で作成したファイルのみアクセス可能（セキュリティ制限）
