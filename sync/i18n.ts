/**
 * Internationalization support for sync dialogs
 */

type Language = 'en' | 'ja';

const translations = {
	en: {
		// Common
		ok: 'OK',
		cancel: 'Cancel',
		proceed: 'Proceed',

		// Conflict Dialog
		conflictTitle: 'Sync Conflicts Detected',
		conflictDescription: 'The following files have been modified both locally and remotely. Choose which version to keep.',
		conflictSaveNotice: 'The unselected version will be saved to {folder}/. Use it for merging if needed. Please delete when no longer needed.',
		keepLocal: 'Keep Local',
		keepRemote: 'Keep Remote',
		showDiff: 'Show Diff',
		hideDiff: 'Hide Diff',
		apply: 'Apply',
		localTime: 'Local: {time}',
		remoteTime: 'Remote: {time}',

		// Settings
		conflictFolderName: 'Conflict folder',
		conflictFolderDesc: 'Directory to save conflicted files',
		clearConflicts: 'Clear conflict files',
		clearConflictsDesc: 'Delete all files in the conflict folder',
		clearAll: 'Clear all',
		confirmDelete: 'Delete {count} conflict file(s)?',
		deleted: 'Deleted {count} conflict file(s)',
		noConflicts: 'No conflict files to delete',
		folderNotExist: 'Conflict folder does not exist',

		// Sync Status
		syncStatusTitle: 'Sync Status',
		lastUpdatedAt: 'Last updated at',
		lastUpdatedAtDesc: 'The last time this vault was synced',
		notSynced: 'Not synced yet',

		// Delete Confirmation Dialog
		deleteConfirmTitle: 'Modified Files Will Be Saved',
		deleteConfirmDescription: 'The following files were deleted on remote but have been modified locally after the last sync.',
		deleteConfirmNotice: 'These files will be saved to {folder}/ before deletion.',
		modifiedAt: 'Modified: {time}',

		// Remote Excluded Files
		remoteExcludedFilesTitle: 'Remote Excluded Files',
		remoteExcludedFilesDesc: 'Files/folders on remote that match your current exclude patterns. These are kept for other devices with different exclude settings.',
		loading: 'Loading...',
		noExcludedFiles: 'No excluded files found on remote.',
		deleteFromRemote: 'Delete',
		filesMatching: '{count} file(s) matching "{pattern}"',
		individualFile: 'Individual file',
		dotFilesAndFolders: '(dot files/folders)',
		deleteExcludedTitle: 'Delete "{name}"',
		deleteFileTitle: 'Delete File',
		deleting: 'Deleting...',
		deletedFiles: 'Deleted {count} file(s)',
		deletedFile: 'Deleted "{name}"',
		deleteFailed: 'Failed to delete. Check console for details.',
		loadFailed: 'Failed to load. Check console for details.',

		// Delete Excluded Files Dialog
		deleteExcludedDesc: 'The following {count} file(s) will be deleted from Google Drive:',
		localFilesUnaffected: 'Local files will not be affected.',
		cannotBeUndone: 'This action cannot be undone.',

		// Sync Engine Messages
		checkingChanges: 'Checking for changes...',
		noRemoteData: 'No remote sync data found. Uploading vault...',
		noRemoteDataPull: 'No remote sync data found. Nothing to pull.',
		pushCancelled: 'Push cancelled.',
		pushFailed: 'Push failed. Check console for details.',
		pushComplete: 'Push complete!',
		pullCancelled: 'Pull cancelled.',
		pullFailed: 'Pull failed. Check console for details.',
		pullComplete: 'Pull complete!',
		alreadyUpToDate: 'Already up to date.',
		fullPushComplete: 'Full push complete!',
		fullPushFailed: 'Full push failed. Check console for details.',
		fullPushCancelled: 'Full push cancelled.',
		fullPullComplete: 'Full pull complete!',
		fullPullFailed: 'Full pull failed. Check console for details.',
		fullPullCancelled: 'Full pull cancelled.',

		// Sync Progress
		syncProgress: 'Syncing...',
		uploading: 'Uploading {current}/{total}',
		downloading: 'Downloading {current}/{total}',
		processing: 'Processing...',

		// Full Sync Confirmation
		fullPushConfirmTitle: 'Full Push',
		fullPushConfirmMessage: 'This will upload all files and overwrite remote. Continue?',
		fullPullConfirmTitle: 'Full Pull',
		fullPullConfirmMessage: 'This will download all files and overwrite local. Continue?',

		// Main Plugin Messages
		networkError: 'Oops! Network error :(',
		noRefreshToken: 'Or maybe no refresh token provided?',
		rootFolderNotExist: 'ERROR: Root folder does not exist. Please reload the plug-in.',
		rootFolderCheckHint: 'If this error persists, please check if there is a folder named "obsidian" in your Google Drive.',
		creatingVault: 'Creating vault in Google Drive...',
		vaultCreated: 'Vault created!',
		reloadPlugin: 'Please reload the plug-in.',
		initVaultFailed: 'ERROR: Unable to initialize Vault in Google Drive',
		fetchTokenRetry: 'ERROR: Couldn\'t fetch accessToken. Trying again in 5 secs, please wait...',
		fatalConnectionTimeout: 'FATAL ERROR: Connection timeout, couldn\'t fetch accessToken :(',
		checkConnectionRestart: 'Check your internet connection and restart the plugin...',
		noInternet: 'No internet connection detected.',
		initializingFiles: 'Initializing required files',
		fetchRootFolderFailed: 'FATAL ERROR: Could not fetch rootFolder',
		getVaultIdFailed: 'FATAL ERROR: Couldn\'t get VaultID from Google Drive :(',
		checkConnectionReload: 'Check internet connection and restart plugin.',
		vaultNotFound: 'Oops! No vaults named {name} found in Google Drive',
		initVaultHint: 'Try initializing vault in Google Drive from plug-in settings :)',
		invalidToken: 'ERROR: Invalid token',
		noInternetError: 'ERROR: No internet connection!',
		syncEngineNotInit: 'Sync engine not initialized. Please reload the plugin.',
		rootFolderCreated: 'Root folder created, please reload the plugin.',
		loggedIn: 'Logged in',
		loggedInSuccess: 'Logged in successfully',
		logInFailed: 'Log in failed',
		openLinkToLogin: 'Open this link to log in',
		checking: 'Checking...',

		// Section Headers
		conflictResolution: 'Conflict Resolution',
		fullSyncOperations: 'Full Sync Operations',

		// Sync Complete Dialog
		updatedFiles: 'Updated files',
		skippedUnchanged: 'Skipped {count} unchanged file(s)',
		uploadComplete: 'Upload Complete',
		downloadComplete: 'Download Complete',

		// Orphan Files
		orphanFilesTitle: 'Orphan Files',
		orphanFilesDesc: 'Files on Google Drive not tracked in sync metadata. These files will not be synced to other devices.',
		orphanFilesButton: 'Detect Orphan Files',
		orphanFilesButtonDesc: 'Find and delete files on Google Drive that are not tracked in metadata',
		noOrphanFiles: 'No orphan files found.',
		selectAll: 'Select All',
		deleteSelected: 'Delete Selected ({count})',
		orphanFilesDeleted: 'Deleted {count} orphan file(s)',
	},
	ja: {
		// Common
		ok: 'OK',
		cancel: 'キャンセル',
		proceed: '実行',

		// Conflict Dialog
		conflictTitle: '同期の競合を検出',
		conflictDescription: '以下のファイルがローカルとリモートの両方で変更されています。保持するバージョンを選択してください。',
		conflictSaveNotice: '選択されなかったバージョンは{folder}/に保存されます。マージ等にお使いください。不要になれば削除をお願いします。',
		keepLocal: 'ローカルを保持',
		keepRemote: 'リモートを保持',
		showDiff: '差分を表示',
		hideDiff: '差分を非表示',
		apply: '適用',
		localTime: 'ローカル: {time}',
		remoteTime: 'リモート: {time}',

		// Settings
		conflictFolderName: '競合フォルダ',
		conflictFolderDesc: '競合ファイルを保存するディレクトリ',
		clearConflicts: '競合ファイルを削除',
		clearConflictsDesc: '競合フォルダ内のすべてのファイルを削除',
		clearAll: 'すべて削除',
		confirmDelete: '{count}個の競合ファイルを削除しますか?',
		deleted: '{count}個の競合ファイルを削除しました',
		noConflicts: '削除する競合ファイルがありません',
		folderNotExist: '競合フォルダが存在しません',

		// Sync Status
		syncStatusTitle: '同期ステータス',
		lastUpdatedAt: '最終更新日時',
		lastUpdatedAtDesc: 'このVaultが最後に同期された日時',
		notSynced: '未同期',

		// Delete Confirmation Dialog
		deleteConfirmTitle: '変更されたファイルを保存します',
		deleteConfirmDescription: '以下のファイルはリモートで削除されましたが、最後の同期以降にローカルで変更されています。',
		deleteConfirmNotice: 'これらのファイルは削除前に{folder}/に保存されます。',
		modifiedAt: '更新: {time}',

		// Remote Excluded Files
		remoteExcludedFilesTitle: 'リモートの除外ファイル',
		remoteExcludedFilesDesc: '現在の除外パターンに一致するリモートのファイル/フォルダ。異なる除外設定の他デバイス用に保持されています。',
		loading: '読み込み中...',
		noExcludedFiles: 'リモートに除外ファイルはありません。',
		deleteFromRemote: '削除',
		filesMatching: '"{pattern}"に一致する{count}個のファイル',
		individualFile: '個別ファイル',
		dotFilesAndFolders: '(ドットファイル/フォルダ)',
		deleteExcludedTitle: '"{name}"を削除',
		deleteFileTitle: 'ファイルを削除',
		deleting: '削除中...',
		deletedFiles: '{count}個のファイルを削除しました',
		deletedFile: '"{name}"を削除しました',
		deleteFailed: '削除に失敗しました。詳細はコンソールを確認してください。',
		loadFailed: '読み込みに失敗しました。詳細はコンソールを確認してください。',

		// Delete Excluded Files Dialog
		deleteExcludedDesc: '以下の{count}個のファイルがGoogle Driveから削除されます:',
		localFilesUnaffected: 'ローカルファイルは影響を受けません。',
		cannotBeUndone: 'この操作は元に戻せません。',

		// Sync Engine Messages
		checkingChanges: '変更を確認中...',
		noRemoteData: 'リモートに同期データがありません。Vaultをアップロードします...',
		noRemoteDataPull: 'リモートに同期データがありません。プルするものがありません。',
		pushCancelled: 'プッシュがキャンセルされました。',
		pushFailed: 'プッシュに失敗しました。詳細はコンソールを確認してください。',
		pushComplete: 'プッシュ完了！',
		pullCancelled: 'プルがキャンセルされました。',
		pullFailed: 'プルに失敗しました。詳細はコンソールを確認してください。',
		pullComplete: 'プル完了！',
		alreadyUpToDate: '既に最新です。',
		fullPushComplete: 'フルプッシュ完了！',
		fullPushFailed: 'フルプッシュに失敗しました。詳細はコンソールを確認してください。',
		fullPushCancelled: 'フルプッシュがキャンセルされました。',
		fullPullComplete: 'フルプル完了！',
		fullPullFailed: 'フルプルに失敗しました。詳細はコンソールを確認してください。',
		fullPullCancelled: 'フルプルがキャンセルされました。',

		// Sync Progress
		syncProgress: '同期中...',
		uploading: 'アップロード中 {current}/{total}',
		downloading: 'ダウンロード中 {current}/{total}',
		processing: '処理中...',

		// Full Sync Confirmation
		fullPushConfirmTitle: 'フルプッシュ',
		fullPushConfirmMessage: 'すべてのファイルをアップロードし、リモートを上書きします。続行しますか？',
		fullPullConfirmTitle: 'フルプル',
		fullPullConfirmMessage: 'すべてのファイルをダウンロードし、ローカルを上書きします。続行しますか？',

		// Main Plugin Messages
		networkError: 'ネットワークエラーが発生しました :(',
		noRefreshToken: 'リフレッシュトークンが設定されていない可能性があります。',
		rootFolderNotExist: 'エラー: ルートフォルダが存在しません。プラグインを再読み込みしてください。',
		rootFolderCheckHint: 'このエラーが続く場合は、Google Driveに「obsidian」という名前のフォルダがあるか確認してください。',
		creatingVault: 'Google DriveにVaultを作成中...',
		vaultCreated: 'Vaultを作成しました！',
		reloadPlugin: 'プラグインを再読み込みしてください。',
		initVaultFailed: 'エラー: Google DriveでVaultを初期化できませんでした',
		fetchTokenRetry: 'エラー: アクセストークンを取得できませんでした。5秒後に再試行します...',
		fatalConnectionTimeout: '致命的エラー: 接続タイムアウト。アクセストークンを取得できませんでした :(',
		checkConnectionRestart: 'インターネット接続を確認し、プラグインを再起動してください...',
		noInternet: 'インターネット接続が検出されませんでした。',
		initializingFiles: '必要なファイルを初期化中',
		fetchRootFolderFailed: '致命的エラー: ルートフォルダを取得できませんでした',
		getVaultIdFailed: '致命的エラー: Google DriveからVault IDを取得できませんでした :(',
		checkConnectionReload: 'インターネット接続を確認し、プラグインを再起動してください。',
		vaultNotFound: 'Google Driveに{name}という名前のVaultが見つかりません',
		initVaultHint: 'プラグイン設定からGoogle DriveでVaultを初期化してください :)',
		invalidToken: 'エラー: 無効なトークン',
		noInternetError: 'エラー: インターネット接続がありません！',
		syncEngineNotInit: '同期エンジンが初期化されていません。プラグインを再読み込みしてください。',
		rootFolderCreated: 'ルートフォルダを作成しました。プラグインを再読み込みしてください。',
		loggedIn: 'ログイン済み',
		loggedInSuccess: 'ログインに成功しました',
		logInFailed: 'ログインに失敗しました',
		openLinkToLogin: 'このリンクを開いてログイン',
		checking: '確認中...',

		// Section Headers
		conflictResolution: '競合解決',
		fullSyncOperations: 'フル同期操作',

		// Sync Complete Dialog
		updatedFiles: '更新されたファイル',
		skippedUnchanged: '未変更の{count}ファイルをスキップしました',
		uploadComplete: 'アップロード完了',
		downloadComplete: 'ダウンロード完了',

		// Orphan Files
		orphanFilesTitle: 'Orphanファイル',
		orphanFilesDesc: 'Google Drive上にあるが同期メタデータで追跡されていないファイル。これらのファイルは他のデバイスに同期されません。',
		orphanFilesButton: 'Orphanファイルを検出',
		orphanFilesButtonDesc: 'メタデータで追跡されていないGoogle Drive上のファイルを検出・削除',
		noOrphanFiles: 'Orphanファイルは見つかりませんでした。',
		selectAll: 'すべて選択',
		deleteSelected: '選択を削除 ({count})',
		orphanFilesDeleted: '{count}個のOrphanファイルを削除しました',
	},
};

type TranslationKey = keyof typeof translations['en'];

/**
 * Get the current language from Obsidian's locale setting
 */
function getCurrentLanguage(): Language {
	// Handle Node.js environment (for tests)
	if (typeof window === 'undefined' || !window.localStorage) {
		return 'en';
	}
	const locale = window.localStorage.getItem('language') || 'en';
	return locale.startsWith('ja') ? 'ja' : 'en';
}

/**
 * Get a translated string with optional parameter substitution
 */
export function t(key: TranslationKey, params?: Record<string, string>): string {
	const lang = getCurrentLanguage();
	let text = translations[lang][key] || translations['en'][key] || key;

	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(`{${k}}`, v);
		}
	}

	return text;
}
