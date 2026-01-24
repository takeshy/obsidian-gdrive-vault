/**
 * Internationalization support for sync dialogs
 */

type Language = 'en' | 'ja';

const translations = {
	en: {
		// Conflict Dialog
		conflictTitle: 'Sync Conflicts Detected',
		conflictDescription: 'The following files have been modified both locally and remotely. Choose which version to keep.',
		conflictSaveNotice: 'The unselected version will be saved to {folder}/. Use it for merging if needed. Please delete when no longer needed.',
		keepLocal: 'Keep Local',
		keepRemote: 'Keep Remote',
		showDiff: 'Show Diff',
		hideDiff: 'Hide Diff',
		apply: 'Apply',
		cancel: 'Cancel',
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
	},
	ja: {
		// Conflict Dialog
		conflictTitle: '同期の競合を検出',
		conflictDescription: '以下のファイルがローカルとリモートの両方で変更されています。保持するバージョンを選択してください。',
		conflictSaveNotice: '選択されなかったバージョンは{folder}/に保存されます。マージ等にお使いください。不要になれば削除をお願いします。',
		keepLocal: 'ローカルを保持',
		keepRemote: 'リモートを保持',
		showDiff: '差分を表示',
		hideDiff: '差分を非表示',
		apply: '適用',
		cancel: 'キャンセル',
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
