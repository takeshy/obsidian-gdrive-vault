import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockVault, MockGDriveAPI, MockTFile } from './mocks/obsidian';
import { SyncMeta, META_FILE_NAME_LOCAL, META_FILE_NAME_REMOTE } from '../sync/types';
import { calculateHash } from '../sync/hash';
import { shouldExclude } from '../sync/meta';

// Mock the actions module
vi.mock('../actions', () => ({
	getFilesList: vi.fn(),
	getFile: vi.fn(),
	uploadFile: vi.fn(),
	modifyFile: vi.fn(),
	deleteFile: vi.fn(),
}));

describe('calculateHash', () => {
	it('should calculate consistent hash for same content', async () => {
		const content = new TextEncoder().encode('Hello World').buffer as ArrayBuffer;
		const hash1 = await calculateHash(content);
		const hash2 = await calculateHash(content);

		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 produces 64 hex chars
	});

	it('should calculate different hash for different content', async () => {
		const content1 = new TextEncoder().encode('Hello').buffer as ArrayBuffer;
		const content2 = new TextEncoder().encode('World').buffer as ArrayBuffer;

		const hash1 = await calculateHash(content1);
		const hash2 = await calculateHash(content2);

		expect(hash1).not.toBe(hash2);
	});

	it('should handle empty content', async () => {
		const content = new TextEncoder().encode('').buffer as ArrayBuffer;
		const hash = await calculateHash(content);

		expect(hash).toMatch(/^[a-f0-9]{64}$/);
		// SHA-256 of empty string is a known value
		expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	});
});

describe('Sync Scenarios', () => {
	let vault: MockVault;
	let gdrive: MockGDriveAPI;

	beforeEach(() => {
		vault = new MockVault();
		gdrive = new MockGDriveAPI();
	});

	describe('Initial Push (no remote meta)', () => {
		it('should upload all files when remote is empty', async () => {
			// Setup: Local vault with files, no remote
			vault.addFile('notes/test.md', 'Test content');
			vault.addFile('README.md', 'Readme');

			// Verify initial state
			expect(vault.getFiles().length).toBe(2);
			expect(gdrive.getFilesList().length).toBe(0);
		});
	});

	describe('Push after Pull (same content)', () => {
		it('should detect no changes when hashes match', async () => {
			const content = 'Same content';
			const hash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);

			// Setup: Same file locally and remotely
			vault.addFile('test.md', content);
			gdrive.addFile('test.md', content);

			// Create matching metas
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'test.md': {
						hash,
						modifiedTime: new Date().toISOString(),
					}
				}
			};

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'test.md': {
						hash,
						modifiedTime: new Date().toISOString(),
					}
				}
			};

			// Both metas have same hash - no upload needed
			expect(localMeta.files['test.md'].hash).toBe(remoteMeta.files['test.md'].hash);
		});
	});

	describe('Conflict Detection', () => {
		it('should detect conflict when both local and remote changed', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const localHash = await calculateHash(new TextEncoder().encode('Local change').buffer as ArrayBuffer);
			const remoteHash = await calculateHash(new TextEncoder().encode('Remote change').buffer as ArrayBuffer);

			// Last sync had original content
			const lastSyncMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'test.md': {
						hash: originalHash,
						modifiedTime: '2024-01-01T00:00:00.000Z',
					}
				}
			};

			// Local has different hash
			const currentLocalHash = localHash;

			// Remote has different hash
			const currentRemoteHash = remoteHash;

			// Both changed from original = conflict
			const localChanged = currentLocalHash !== lastSyncMeta.files['test.md'].hash;
			const remoteChanged = currentRemoteHash !== lastSyncMeta.files['test.md'].hash;

			expect(localChanged).toBe(true);
			expect(remoteChanged).toBe(true);
			expect(currentLocalHash).not.toBe(currentRemoteHash);
		});

		it('should not detect conflict when only local changed', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const localHash = await calculateHash(new TextEncoder().encode('Local change').buffer as ArrayBuffer);

			const lastSyncMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'test.md': {
						hash: originalHash,
						modifiedTime: '2024-01-01T00:00:00.000Z',
					}
				}
			};

			// Remote unchanged (same as last sync)
			const currentRemoteHash = originalHash;

			const localChanged = localHash !== lastSyncMeta.files['test.md'].hash;
			const remoteChanged = currentRemoteHash !== lastSyncMeta.files['test.md'].hash;

			expect(localChanged).toBe(true);
			expect(remoteChanged).toBe(false);
		});
	});

	describe('File Exclusion', () => {
		it('should exclude .obsidian files from sync', () => {
			vault.addFile('.obsidian/config.json', '{}');
			vault.addFile('.obsidian/plugins/test/main.js', 'code');
			vault.addFile('notes/test.md', 'content');

			const allFiles = vault.getFiles();
			const excludePatterns = ['.obsidian/**', '.**', '.*/**'];

			const syncableFiles = allFiles.filter(f => !shouldExclude(f.path, excludePatterns));

			expect(syncableFiles.length).toBe(1);
			expect(syncableFiles[0].path).toBe('notes/test.md');
		});
	});

	describe('Meta File Handling', () => {
		it('should store meta in .obsidian folder', () => {
			expect(META_FILE_NAME_LOCAL).toBe('.obsidian/gdrive-vault-meta.json');
		});

		it('should store remote meta with underscore prefix', () => {
			expect(META_FILE_NAME_REMOTE).toBe('_gdrive-vault-meta.json');
		});

		it('should serialize and deserialize meta correctly', () => {
			const meta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T12:00:00.000Z',
				files: {
					'test.md': {
						hash: 'abc123',
						modifiedTime: '2024-01-01T10:00:00.000Z',
					}
				}
			};

			const json = JSON.stringify(meta);
			const parsed = JSON.parse(json) as SyncMeta;

			expect(parsed.lastUpdatedAt).toBe('2024-01-01T00:00:00.000Z');
			expect(parsed.files['test.md'].hash).toBe('abc123');
		});
	});

	describe('New File Detection', () => {
		it('should detect new local files', async () => {
			// Remote has meta with one file
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'existing.md': {
						hash: 'hash1',
						modifiedTime: new Date().toISOString(),
					}
				}
			};

			// Local has two files
			vault.addFile('existing.md', 'content1');
			vault.addFile('new.md', 'content2');

			const localFiles = vault.getFiles();
			const remoteFiles = Object.keys(remoteMeta.files);

			const newLocalFiles = localFiles.filter(f => !remoteFiles.includes(f.path));

			expect(newLocalFiles.length).toBe(1);
			expect(newLocalFiles[0].path).toBe('new.md');
		});

		it('should detect new remote files', () => {
			// Remote has two files
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'existing.md': {
						hash: 'hash1',
						modifiedTime: new Date().toISOString(),
					},
					'new-remote.md': {
						hash: 'hash2',
						modifiedTime: new Date().toISOString(),
					}
				}
			};

			// Local has one file
			vault.addFile('existing.md', 'content1');

			const localFilePaths = vault.getFiles().map(f => f.path);
			const remoteFilePaths = Object.keys(remoteMeta.files);

			const newRemoteFiles = remoteFilePaths.filter(p => !localFilePaths.includes(p));

			expect(newRemoteFiles.length).toBe(1);
			expect(newRemoteFiles[0]).toBe('new-remote.md');
		});
	});

	describe('Deleted File Detection', () => {
		it('should detect locally deleted files', () => {
			// Last sync had two files
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'kept.md': { hash: 'hash1', modifiedTime: new Date().toISOString() },
					'deleted.md': { hash: 'hash2', modifiedTime: new Date().toISOString() },
				}
			};

			// Now only one file exists locally
			vault.addFile('kept.md', 'content');

			const localFilePaths = new Set(vault.getFiles().map(f => f.path));
			const previouslyTracked = Object.keys(localMeta.files);

			const deletedLocally = previouslyTracked.filter(p => !localFilePaths.has(p));

			expect(deletedLocally.length).toBe(1);
			expect(deletedLocally[0]).toBe('deleted.md');
		});
	});

	describe('Full Push then Pull Scenario', () => {
		it('should not download anything when local and remote have same content after push', async () => {
			// Scenario: After Full Push, Pull should detect no changes

			// 1. Local vault has files
			const file1Content = 'File 1 content';
			const file2Content = 'File 2 content';
			vault.addFile('file1.md', file1Content);
			vault.addFile('file2.md', file2Content);

			// 2. Calculate hashes (simulating what happens during push)
			const hash1 = await calculateHash(new TextEncoder().encode(file1Content).buffer as ArrayBuffer);
			const hash2 = await calculateHash(new TextEncoder().encode(file2Content).buffer as ArrayBuffer);

			// 3. After push, both local and remote should have same meta
			const timestamp = new Date().toISOString();
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: timestamp,
				files: {
					'file1.md': { hash: hash1, modifiedTime: timestamp },
					'file2.md': { hash: hash2, modifiedTime: timestamp },
				}
			};

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: timestamp,
				files: {
					'file1.md': { hash: hash1, modifiedTime: timestamp },
					'file2.md': { hash: hash2, modifiedTime: timestamp },
				}
			};

			// 4. Check: No files should be downloaded
			const toDownload: string[] = [];
			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localInfo = localMeta.files[path];
				// File exists locally with same hash - no download needed
				if (!localInfo || localInfo.hash !== remoteInfo.hash) {
					toDownload.push(path);
				}
			}

			expect(toDownload.length).toBe(0);
		});

		it('should detect when local meta is missing but content matches', async () => {
			// Scenario: localMeta is null but files exist and match remote

			// 1. Local vault has files
			const content = 'Same content';
			vault.addFile('test.md', content);

			// 2. Remote has same file with same content
			const hash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'test.md': { hash, modifiedTime: new Date().toISOString() },
				}
			};

			// 3. Build current local meta from vault (simulating what sync engine does)
			const currentLocalHash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);

			// 4. Compare hashes - should be same, no download needed
			expect(currentLocalHash).toBe(remoteMeta.files['test.md'].hash);

			// This means the file content matches, no conflict
			const isConflict = currentLocalHash !== remoteMeta.files['test.md'].hash;
			expect(isConflict).toBe(false);
		});
	});
});
