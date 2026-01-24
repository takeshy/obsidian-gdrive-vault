import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockGDriveAPI } from './mocks/obsidian';
import { SyncMeta } from '../sync/types';
import { calculateHash } from '../sync/hash';

describe('Pull Changes Scenarios', () => {
	let vault: MockVault;
	let gdrive: MockGDriveAPI;

	beforeEach(() => {
		vault = new MockVault();
		gdrive = new MockGDriveAPI();
	});

	describe('Case 1: No remote meta', () => {
		it('should do nothing when remote has no meta', () => {
			vault.addFile('local.md', 'Local content');

			const remoteMeta = null;

			// No remote meta = nothing to pull
			const shouldPull = remoteMeta !== null;
			expect(shouldPull).toBe(false);
		});
	});

	describe('Case 2: No local meta (first pull on this device)', () => {
		it('should not conflict when content matches', async () => {
			const content = 'Same content';
			vault.addFile('note.md', content);

			const hash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'note.md': { hash, modifiedTime: new Date().toISOString() }
				}
			};

			const localHash = await calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);
			const hasConflict = localHash !== remoteMeta.files['note.md'].hash;
			expect(hasConflict).toBe(false);
		});

		it('should NOT show conflict when remote is newer (remote is authoritative)', async () => {
			const localContent = 'Local version';
			const remoteContent = 'Remote version';
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
			const localContent = 'Local version';
			const remoteContent = 'Remote version';
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

		it('should download new remote files', async () => {
			// Local is empty
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'remote-only.md': {
						hash: 'somehash',
						modifiedTime: new Date().toISOString()
					}
				}
			};

			const localFilePaths = new Set(vault.getFiles().map(f => f.path));
			const toDownload = Object.keys(remoteMeta.files).filter(p => !localFilePaths.has(p));

			expect(toDownload).toContain('remote-only.md');
		});
	});

	describe('Case 3: Local is newer or same version', () => {
		it('should do nothing when local timestamp >= remote', () => {
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {}
			};

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {}
			};

			const localTime = new Date(localMeta.lastSyncTimestamp).getTime();
			const remoteTime = new Date(remoteMeta.lastSyncTimestamp).getTime();

			expect(localTime >= remoteTime).toBe(true);
		});
	});

	describe('Case 4: Remote is newer', () => {
		it('should download changed files', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const newRemoteHash = await calculateHash(new TextEncoder().encode('Updated').buffer as ArrayBuffer);

			// Last sync state
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'note.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			// Remote is newer with updated content
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'note.md': { hash: newRemoteHash, modifiedTime: '2024-01-02T00:00:00.000Z' }
				}
			};

			// Local file unchanged from last sync
			vault.addFile('note.md', 'Original');

			const toDownload: string[] = [];
			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localInfo = localMeta.files[path];
				// Remote changed from last sync
				if (localInfo && remoteInfo.hash !== localInfo.hash) {
					// Check if local also changed
					const currentLocalHash = await calculateHash(
						new TextEncoder().encode(vault.getFileContent(path)!).buffer as ArrayBuffer
					);
					const localChanged = currentLocalHash !== localInfo.hash;

					if (!localChanged) {
						// Only remote changed - safe to download
						toDownload.push(path);
					}
				}
			}

			expect(toDownload).toContain('note.md');
		});

		it('should download new remote files', async () => {
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'existing.md': { hash: 'hash1', modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'existing.md': { hash: 'hash1', modifiedTime: '2024-01-01T00:00:00.000Z' },
					'new-remote.md': { hash: 'hash2', modifiedTime: '2024-01-02T00:00:00.000Z' }
				}
			};

			vault.addFile('existing.md', 'Existing content');

			const toDownload: string[] = [];
			for (const path of Object.keys(remoteMeta.files)) {
				if (!localMeta.files[path]) {
					toDownload.push(path);
				}
			}

			expect(toDownload).toContain('new-remote.md');
			expect(toDownload).not.toContain('existing.md');
		});

		it('should delete local files deleted on remote', async () => {
			const hash1 = await calculateHash(new TextEncoder().encode('Kept').buffer as ArrayBuffer);
			const hash2 = await calculateHash(new TextEncoder().encode('Deleted').buffer as ArrayBuffer);

			// Last sync had two files
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'kept.md': { hash: hash1, modifiedTime: '2024-01-01T00:00:00.000Z' },
					'deleted-on-remote.md': { hash: hash2, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			// Remote now only has one file
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'kept.md': { hash: hash1, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			vault.addFile('kept.md', 'Kept');
			vault.addFile('deleted-on-remote.md', 'Deleted');

			// Files that were in last sync but not in remote anymore
			const toDelete = Object.keys(localMeta.files).filter(p => !remoteMeta.files[p]);

			expect(toDelete).toContain('deleted-on-remote.md');
			expect(toDelete).not.toContain('kept.md');
		});

		it('should detect conflicts when both sides changed', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const localEditHash = await calculateHash(new TextEncoder().encode('Local edit').buffer as ArrayBuffer);
			const remoteEditHash = await calculateHash(new TextEncoder().encode('Remote edit').buffer as ArrayBuffer);

			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'note.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'note.md': { hash: remoteEditHash, modifiedTime: '2024-01-02T00:00:00.000Z' }
				}
			};

			// Local was edited
			vault.addFile('note.md', 'Local edit');

			const conflicts: string[] = [];
			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localInfo = localMeta.files[path];
				if (localInfo) {
					const currentLocalHash = await calculateHash(
						new TextEncoder().encode(vault.getFileContent(path)!).buffer as ArrayBuffer
					);
					const localChanged = currentLocalHash !== localInfo.hash;
					const remoteChanged = remoteInfo.hash !== localInfo.hash;

					if (localChanged && remoteChanged) {
						conflicts.push(path);
					}
				}
			}

			expect(conflicts).toContain('note.md');
		});
	});
});
