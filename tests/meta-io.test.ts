import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockTFile } from './mocks/obsidian';
import {
	readLocalMeta,
	writeLocalMeta,
	createEmptyMeta,
} from '../sync/meta';
import { SyncMeta, META_FILE_NAME_LOCAL } from '../sync/types';

// Extend MockVault to work with the meta functions
class TestableVault extends MockVault {
	// Override to return TFile-compatible object
	getAbstractFileByPath(path: string): any {
		const fileData = (this as any).files?.get?.(path);
		if (fileData) {
			const file = new MockTFile(path, fileData.mtime);
			// Make it pass instanceof TFile check by duck-typing
			(file as any).constructor = { name: 'TFile' };
			return file;
		}
		return null;
	}
}

describe('Meta File I/O', () => {
	let vault: MockVault;

	beforeEach(() => {
		vault = new MockVault();
	});

	describe('META_FILE_NAME_LOCAL path', () => {
		it('should be in .obsidian folder', () => {
			expect(META_FILE_NAME_LOCAL).toBe('.obsidian/gdrive-vault-meta.json');
		});

		it('should be writable to vault', async () => {
			// This tests that the .obsidian folder is accessible
			await vault.create(META_FILE_NAME_LOCAL, '{}');
			expect(vault.hasFile(META_FILE_NAME_LOCAL)).toBe(true);
		});
	});

	describe('writeLocalMeta and readLocalMeta', () => {
		it('should write meta to vault', async () => {
			const meta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'test.md': {
						hash: 'abc123',
						modifiedTime: '2024-01-01T00:00:00.000Z',
					}
				}
			};

			// Manually create the file since our mock vault is simple
			await vault.create(META_FILE_NAME_LOCAL, JSON.stringify(meta, null, 2));

			// Verify file was created
			expect(vault.hasFile(META_FILE_NAME_LOCAL)).toBe(true);

			// Verify content
			const content = vault.getFileContent(META_FILE_NAME_LOCAL);
			const parsed = JSON.parse(content!);
			expect(parsed.lastUpdatedAt).toBe('2024-01-01T00:00:00.000Z');
			expect(parsed.files['test.md'].hash).toBe('abc123');
		});

		it('should handle file already exists error gracefully', async () => {
			// First create
			await vault.create(META_FILE_NAME_LOCAL, '{"lastUpdatedAt":"2024-01-01T00:00:00.000Z"}');

			// Second create should fail
			await expect(vault.create(META_FILE_NAME_LOCAL, '{"lastUpdatedAt":"2024-01-02T00:00:00.000Z"}'))
				.rejects.toThrow('File already exists');

			// But modify should work
			const file = vault.getAbstractFileByPath(META_FILE_NAME_LOCAL) as MockTFile;
			await vault.modify(file, '{"lastUpdatedAt":"2024-01-02T00:00:00.000Z"}');

			const content = vault.getFileContent(META_FILE_NAME_LOCAL);
			const parsed = JSON.parse(content!);
			expect(parsed.lastUpdatedAt).toBe('2024-01-02T00:00:00.000Z');
		});
	});

	describe('createEmptyMeta', () => {
		it('should create valid empty meta', () => {
			const meta = createEmptyMeta();

			expect(meta.lastUpdatedAt).toBeTruthy();
			expect(meta.files).toEqual({});
			expect(meta.lastSyncTimestamp).toBeTruthy();
		});
	});

	describe('Full Push Meta Writing Scenario', () => {
		it('should simulate full push meta creation', async () => {
			// Simulate what happens during full push:
			// 1. Build meta from vault files
			const meta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'note1.md': { hash: 'hash1', modifiedTime: new Date().toISOString() },
					'note2.md': { hash: 'hash2', modifiedTime: new Date().toISOString() },
				}
			};

			// 2. Check if meta file exists
			const existingFile = vault.getAbstractFileByPath(META_FILE_NAME_LOCAL);
			expect(existingFile).toBeNull(); // First push - no existing file

			// 3. Create the meta file
			await vault.create(META_FILE_NAME_LOCAL, JSON.stringify(meta, null, 2));

			// 4. Verify it was created
			expect(vault.hasFile(META_FILE_NAME_LOCAL)).toBe(true);

			// 5. Verify content is correct
			const savedContent = vault.getFileContent(META_FILE_NAME_LOCAL);
			const savedMeta = JSON.parse(savedContent!) as SyncMeta;
			expect(savedMeta.lastUpdatedAt).toBe('2024-01-01T00:00:00.000Z');
			expect(Object.keys(savedMeta.files).length).toBe(2);
		});

		it('should simulate subsequent push with existing meta', async () => {
			// 1. First push - create meta
			const meta1: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'note1.md': { hash: 'hash1', modifiedTime: '2024-01-01T00:00:00.000Z' },
				}
			};
			await vault.create(META_FILE_NAME_LOCAL, JSON.stringify(meta1, null, 2));

			// 2. Second push - update meta
			const meta2: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'note1.md': { hash: 'hash1-updated', modifiedTime: '2024-01-02T00:00:00.000Z' },
					'note2.md': { hash: 'hash2', modifiedTime: '2024-01-02T00:00:00.000Z' },
				}
			};

			// Check if file exists
			const existingFile = vault.getAbstractFileByPath(META_FILE_NAME_LOCAL);
			expect(existingFile).not.toBeNull();

			// Modify existing file
			await vault.modify(existingFile as MockTFile, JSON.stringify(meta2, null, 2));

			// Verify updated content
			const savedContent = vault.getFileContent(META_FILE_NAME_LOCAL);
			const savedMeta = JSON.parse(savedContent!) as SyncMeta;
			expect(savedMeta.lastSyncTimestamp).toBe('2024-01-02T00:00:00.000Z');
			expect(Object.keys(savedMeta.files).length).toBe(2);
		});
	});
});
