import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { t } from '../sync/i18n';

describe('i18n', () => {
	// Store original window
	const originalWindow = global.window;

	beforeEach(() => {
		// Mock window with localStorage
		const storage: Record<string, string> = {};
		(global as any).window = {
			localStorage: {
				getItem: (key: string) => storage[key] || null,
				setItem: (key: string, value: string) => { storage[key] = value; },
				removeItem: (key: string) => { delete storage[key]; },
				clear: () => { Object.keys(storage).forEach(key => delete storage[key]); },
				length: 0,
				key: () => null,
			},
		};
	});

	afterEach(() => {
		// Restore original window
		(global as any).window = originalWindow;
	});

	describe('English translations', () => {
		beforeEach(() => {
			(global as any).window.localStorage.setItem('language', 'en');
		});

		it('should return English conflict title', () => {
			expect(t('conflictTitle')).toBe('Sync Conflicts Detected');
		});

		it('should return English button labels', () => {
			expect(t('keepLocal')).toBe('Keep Local');
			expect(t('keepRemote')).toBe('Keep Remote');
			expect(t('apply')).toBe('Apply');
			expect(t('cancel')).toBe('Cancel');
		});

		it('should return English diff toggle labels', () => {
			expect(t('showDiff')).toBe('Show Diff');
			expect(t('hideDiff')).toBe('Hide Diff');
		});

		it('should return English settings labels', () => {
			expect(t('conflictFolderName')).toBe('Conflict folder');
			expect(t('clearConflicts')).toBe('Clear conflict files');
			expect(t('clearAll')).toBe('Clear all');
		});
	});

	describe('Japanese translations', () => {
		beforeEach(() => {
			(global as any).window.localStorage.setItem('language', 'ja');
		});

		it('should return Japanese conflict title', () => {
			expect(t('conflictTitle')).toBe('同期の競合を検出');
		});

		it('should return Japanese button labels', () => {
			expect(t('keepLocal')).toBe('ローカルを保持');
			expect(t('keepRemote')).toBe('リモートを保持');
			expect(t('apply')).toBe('適用');
			expect(t('cancel')).toBe('キャンセル');
		});

		it('should return Japanese diff toggle labels', () => {
			expect(t('showDiff')).toBe('差分を表示');
			expect(t('hideDiff')).toBe('差分を非表示');
		});

		it('should return Japanese settings labels', () => {
			expect(t('conflictFolderName')).toBe('競合フォルダ');
			expect(t('clearConflicts')).toBe('競合ファイルを削除');
			expect(t('clearAll')).toBe('すべて削除');
		});
	});

	describe('parameter substitution', () => {
		beforeEach(() => {
			(global as any).window.localStorage.setItem('language', 'en');
		});

		it('should substitute folder parameter', () => {
			const result = t('conflictSaveNotice', { folder: 'my_folder' });
			expect(result).toContain('my_folder/');
		});

		it('should substitute count parameter', () => {
			const result = t('confirmDelete', { count: '5' });
			expect(result).toBe('Delete 5 conflict file(s)?');
		});

		it('should substitute time parameter', () => {
			const result = t('localTime', { time: '2024-01-24 10:30' });
			expect(result).toBe('Local: 2024-01-24 10:30');
		});

		it('should handle multiple parameters', () => {
			const result = t('deleted', { count: '3' });
			expect(result).toBe('Deleted 3 conflict file(s)');
		});
	});

	describe('language detection', () => {
		it('should default to English when no language set', () => {
			(global as any).window.localStorage.removeItem('language');
			expect(t('conflictTitle')).toBe('Sync Conflicts Detected');
		});

		it('should default to English for unsupported languages', () => {
			(global as any).window.localStorage.setItem('language', 'fr');
			expect(t('conflictTitle')).toBe('Sync Conflicts Detected');
		});

		it('should detect ja-JP as Japanese', () => {
			(global as any).window.localStorage.setItem('language', 'ja-JP');
			expect(t('conflictTitle')).toBe('同期の競合を検出');
		});
	});

	describe('fallback behavior', () => {
		it('should fall back to English when window is undefined', () => {
			(global as any).window = undefined;
			expect(t('conflictTitle')).toBe('Sync Conflicts Detected');
		});
	});
});
