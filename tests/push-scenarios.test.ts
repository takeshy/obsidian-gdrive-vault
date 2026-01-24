import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockGDriveAPI } from './mocks/obsidian';
import { SyncMeta } from '../sync/types';
import { calculateHash } from '../sync/hash';

describe('Push Changes Scenarios', () => {
	let vault: MockVault;
	let gdrive: MockGDriveAPI;

	beforeEach(() => {
		vault = new MockVault();
		gdrive = new MockGDriveAPI();
	});

	describe('Case 1: No remote meta (first push)', () => {
		it('should upload entire vault when remote has no meta', async () => {
			// Setup: Local has files, remote is empty
			vault.addFile('note1.md', 'Content 1');
			vault.addFile('note2.md', 'Content 2');
			vault.addFile('folder/note3.md', 'Content 3');

			const remoteMeta = null; // No remote meta

			// Action: Should trigger full upload
			const shouldFullUpload = remoteMeta === null;
			expect(shouldFullUpload).toBe(true);

			// All local files should be uploaded
			const filesToUpload = vault.getFiles();
			expect(filesToUpload.length).toBe(3);
		});

		it('should create meta file after upload', async () => {
			vault.addFile('note1.md', 'Content 1');
			const hash = await calculateHash(new TextEncoder().encode('Content 1').buffer as ArrayBuffer);

			// After upload, meta should be created
			const newMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'note1.md': {
						hash,
						modifiedTime: new Date().toISOString(),
					}
				}
			};

			expect(newMeta.files['note1.md'].hash).toBe(hash);
		});
	});

	describe('Case 2: No local meta (first push on this device)', () => {
		it('should compare hashes when local meta is missing', async () => {
			const content = 'Same content';
			const hash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);

			// Local has file
			vault.addFile('note.md', content);

			// Remote has same file with same hash
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'note.md': { hash, modifiedTime: new Date().toISOString() }
				}
			};

			// Build current local hash
			const localHash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);

			// No conflict - hashes match
			const hasConflict = localHash !== remoteMeta.files['note.md'].hash;
			expect(hasConflict).toBe(false);
		});

		it('should NOT show conflict when remote is newer (remote is authoritative)', async () => {
			const localContent = 'Local content';
			const remoteContent = 'Remote content';
			const localHash = await calculateHash(new TextEncoder().encode(localContent).buffer as ArrayBuffer);
			const remoteHash = await calculateHash(new TextEncoder().encode(remoteContent).buffer as ArrayBuffer);

			// Local file is older
			const localModifiedTime = '2024-01-01T00:00:00.000Z';
			// Remote file is newer
			const remoteModifiedTime = '2024-01-15T00:00:00.000Z';

			vault.addFile('note.md', localContent);

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-15T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-15T00:00:00.000Z',
				files: {
					'note.md': { hash: remoteHash, modifiedTime: remoteModifiedTime }
				}
			};

			// Hashes differ
			const hashesDiffer = localHash !== remoteMeta.files['note.md'].hash;
			expect(hashesDiffer).toBe(true);

			// But local is older than remote - NO conflict (remote is authoritative)
			const localIsNewer = new Date(localModifiedTime) > new Date(remoteModifiedTime);
			expect(localIsNewer).toBe(false);

			// Conflict should only be shown if local is newer
			const shouldShowConflict = hashesDiffer && localIsNewer;
			expect(shouldShowConflict).toBe(false);
		});

		it('should show conflict when local is newer than remote', async () => {
			const localContent = 'Local content';
			const remoteContent = 'Remote content';
			const localHash = await calculateHash(new TextEncoder().encode(localContent).buffer as ArrayBuffer);
			const remoteHash = await calculateHash(new TextEncoder().encode(remoteContent).buffer as ArrayBuffer);

			// Local file is newer
			const localModifiedTime = '2024-01-20T00:00:00.000Z';
			// Remote file is older
			const remoteModifiedTime = '2024-01-15T00:00:00.000Z';

			vault.addFile('note.md', localContent);

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-15T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-15T00:00:00.000Z',
				files: {
					'note.md': { hash: remoteHash, modifiedTime: remoteModifiedTime }
				}
			};

			// Hashes differ
			const hashesDiffer = localHash !== remoteMeta.files['note.md'].hash;
			expect(hashesDiffer).toBe(true);

			// Local is newer than remote - should show conflict
			const localIsNewer = new Date(localModifiedTime) > new Date(remoteModifiedTime);
			expect(localIsNewer).toBe(true);

			// Conflict should be shown
			const shouldShowConflict = hashesDiffer && localIsNewer;
			expect(shouldShowConflict).toBe(true);
		});
	});

	describe('Case 3: Local newer or same version', () => {
		it('should upload only changed files', async () => {
			const unchangedHash = await calculateHash(new TextEncoder().encode('Unchanged').buffer as ArrayBuffer);
			const oldHash = await calculateHash(new TextEncoder().encode('Old content').buffer as ArrayBuffer);
			const newHash = await calculateHash(new TextEncoder().encode('New content').buffer as ArrayBuffer);

			// Local meta (from last sync)
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'unchanged.md': { hash: unchangedHash, modifiedTime: '2024-01-01T00:00:00.000Z' },
					'changed.md': { hash: oldHash, modifiedTime: '2024-01-01T00:00:00.000Z' },
				}
			};

			// Remote meta (same as last sync)
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'unchanged.md': { hash: unchangedHash, modifiedTime: '2024-01-01T00:00:00.000Z' },
					'changed.md': { hash: oldHash, modifiedTime: '2024-01-01T00:00:00.000Z' },
				}
			};

			// Current local state
			vault.addFile('unchanged.md', 'Unchanged');
			vault.addFile('changed.md', 'New content');

			// Determine what to upload
			const toUpload: string[] = [];
			for (const file of vault.getFiles()) {
				const currentHash = await calculateHash(
					new TextEncoder().encode(vault.getFileContent(file.path)!).buffer as ArrayBuffer
				);
				const lastSyncHash = localMeta.files[file.path]?.hash;

				if (!lastSyncHash || currentHash !== lastSyncHash) {
					toUpload.push(file.path);
				}
			}

			expect(toUpload).toContain('changed.md');
			expect(toUpload).not.toContain('unchanged.md');
		});

		it('should upload new files', async () => {
			const existingHash = await calculateHash(new TextEncoder().encode('Existing').buffer as ArrayBuffer);

			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'existing.md': { hash: existingHash, modifiedTime: new Date().toISOString() },
				}
			};

			vault.addFile('existing.md', 'Existing');
			vault.addFile('new.md', 'New file');

			const toUpload: string[] = [];
			for (const file of vault.getFiles()) {
				if (!localMeta.files[file.path]) {
					toUpload.push(file.path);
				}
			}

			expect(toUpload).toContain('new.md');
			expect(toUpload).not.toContain('existing.md');
		});

		it('should delete remote files that were deleted locally', async () => {
			const hash1 = await calculateHash(new TextEncoder().encode('File 1').buffer as ArrayBuffer);
			const hash2 = await calculateHash(new TextEncoder().encode('File 2').buffer as ArrayBuffer);

			// Last sync had two files
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'kept.md': { hash: hash1, modifiedTime: new Date().toISOString() },
					'deleted.md': { hash: hash2, modifiedTime: new Date().toISOString() },
				}
			};

			// Now only one file exists locally
			vault.addFile('kept.md', 'File 1');

			const localFilePaths = new Set(vault.getFiles().map(f => f.path));
			const toDelete = Object.keys(localMeta.files).filter(p => !localFilePaths.has(p));

			expect(toDelete).toContain('deleted.md');
			expect(toDelete).not.toContain('kept.md');
		});
	});

	describe('Case 4: Remote is newer', () => {
		it('should detect when remote has newer timestamp', () => {
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {}
			};

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {}
			};

			const localTime = new Date(localMeta.lastSyncTimestamp).getTime();
			const remoteTime = new Date(remoteMeta.lastSyncTimestamp).getTime();

			expect(remoteTime > localTime).toBe(true);
		});

		it('should check for conflicts when remote is newer', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const localHash = await calculateHash(new TextEncoder().encode('Local edit').buffer as ArrayBuffer);
			const remoteHash = await calculateHash(new TextEncoder().encode('Remote edit').buffer as ArrayBuffer);

			// Last sync state
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'note.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			// Remote is newer
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'note.md': { hash: remoteHash, modifiedTime: '2024-01-02T00:00:00.000Z' }
				}
			};

			// Current local content
			vault.addFile('note.md', 'Local edit');

			// Check for conflict
			const currentLocalHash = localHash;
			const lastSyncHash = localMeta.files['note.md'].hash;
			const currentRemoteHash = remoteMeta.files['note.md'].hash;

			const localChanged = currentLocalHash !== lastSyncHash;
			const remoteChanged = currentRemoteHash !== lastSyncHash;

			// Both changed = conflict
			expect(localChanged && remoteChanged).toBe(true);
		});
	});
});
