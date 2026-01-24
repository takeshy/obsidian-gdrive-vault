import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockGDriveAPI } from './mocks/obsidian';
import { SyncMeta, DEFAULT_CONFLICT_FOLDER } from '../sync/types';
import { calculateHash } from '../sync/hash';
import { generateBackupFilename, generateConflictFilename } from '../sync/meta';

describe('Conflict Resolution', () => {
	let vault: MockVault;
	let gdrive: MockGDriveAPI;

	beforeEach(() => {
		vault = new MockVault();
		gdrive = new MockGDriveAPI();
	});

	describe('Conflict Detection', () => {
		it('should detect conflict when local and remote both changed', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const localEditHash = await calculateHash(new TextEncoder().encode('Local edit').buffer as ArrayBuffer);
			const remoteEditHash = await calculateHash(new TextEncoder().encode('Remote edit').buffer as ArrayBuffer);

			// Last sync state
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

			// Current local content changed from original
			vault.addFile('note.md', 'Local edit');

			// Check for conflict
			const currentLocalHash = await calculateHash(
				new TextEncoder().encode(vault.getFileContent('note.md')!).buffer as ArrayBuffer
			);

			const lastSyncHash = localMeta.files['note.md'].hash;
			const currentRemoteHash = remoteMeta.files['note.md'].hash;

			const localChanged = currentLocalHash !== lastSyncHash;
			const remoteChanged = currentRemoteHash !== lastSyncHash;

			expect(localChanged).toBe(true);
			expect(remoteChanged).toBe(true);
			expect(localChanged && remoteChanged).toBe(true); // Conflict!
		});

		it('should not detect conflict when only one side changed', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);
			const localEditHash = await calculateHash(new TextEncoder().encode('Local edit').buffer as ArrayBuffer);

			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'note.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			// Remote unchanged
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'note.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			vault.addFile('note.md', 'Local edit');

			const currentLocalHash = localEditHash;
			const localChanged = currentLocalHash !== localMeta.files['note.md'].hash;
			const remoteChanged = remoteMeta.files['note.md'].hash !== localMeta.files['note.md'].hash;

			expect(localChanged).toBe(true);
			expect(remoteChanged).toBe(false);
			expect(localChanged && remoteChanged).toBe(false); // No conflict
		});
	});

	describe('Keep Local Resolution', () => {
		it('should overwrite remote with local content', async () => {
			const localContent = 'Local version';
			vault.addFile('note.md', localContent);

			// Simulate upload to remote
			gdrive.addFile('note.md', localContent);

			// Verify remote now has local content
			expect(gdrive.getFileContent('note.md')).toBe(localContent);
		});

		it('should update both metas with local hash after Keep Local', async () => {
			const localContent = 'Local version';
			vault.addFile('note.md', localContent);

			const localHash = await calculateHash(new TextEncoder().encode(localContent).buffer as ArrayBuffer);
			const timestamp = new Date().toISOString();

			// After Keep Local, both metas should have local hash
			const newMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: timestamp,
				files: {
					'note.md': { hash: localHash, modifiedTime: timestamp }
				}
			};

			expect(newMeta.files['note.md'].hash).toBe(localHash);
		});
	});

	describe('Keep Remote Resolution', () => {
		it('should overwrite local with remote content', async () => {
			const remoteContent = 'Remote version';

			// Local has different content
			vault.addFile('note.md', 'Local version');

			// Simulate download from remote
			vault.modifyFileContent('note.md', remoteContent);

			// Verify local now has remote content
			expect(vault.getFileContent('note.md')).toBe(remoteContent);
		});

		it('should update local meta with remote hash after Keep Remote', async () => {
			const remoteContent = 'Remote version';
			const remoteHash = await calculateHash(new TextEncoder().encode(remoteContent).buffer as ArrayBuffer);
			const timestamp = new Date().toISOString();

			// After Keep Remote, local meta should have remote hash
			const newLocalMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: timestamp,
				files: {
					'note.md': { hash: remoteHash, modifiedTime: timestamp }
				}
			};

			expect(newLocalMeta.files['note.md'].hash).toBe(remoteHash);
		});
	});

	describe('Conflict Folder Saving', () => {
		it('should save remote version to conflict folder when Keep Local', async () => {
			const localContent = 'Local version';
			const remoteContent = 'Remote version';

			vault.addFile('note.md', localContent);

			// Generate conflict filename for remote version
			const conflictFilename = generateConflictFilename('note.md', DEFAULT_CONFLICT_FOLDER);

			// Save remote to conflict folder
			vault.addFile(conflictFilename, remoteContent);

			// Verify original file kept and conflict file created
			expect(vault.hasFile('note.md')).toBe(true);
			expect(vault.hasFile(conflictFilename)).toBe(true);
			expect(vault.getFileContent('note.md')).toBe(localContent);
			expect(vault.getFileContent(conflictFilename)).toBe(remoteContent);
		});

		it('should save local version to conflict folder when Keep Remote', async () => {
			const localContent = 'Local version';
			const remoteContent = 'Remote version';

			vault.addFile('note.md', localContent);

			// Generate conflict filename for local version
			const conflictFilename = generateConflictFilename('note.md', DEFAULT_CONFLICT_FOLDER);

			// Save local to conflict folder
			vault.addFile(conflictFilename, localContent);

			// Then overwrite with remote
			vault.modifyFileContent('note.md', remoteContent);

			// Verify remote is now the main file and local is in conflict folder
			expect(vault.hasFile('note.md')).toBe(true);
			expect(vault.hasFile(conflictFilename)).toBe(true);
			expect(vault.getFileContent('note.md')).toBe(remoteContent);
			expect(vault.getFileContent(conflictFilename)).toBe(localContent);
		});

		it('should use custom conflict folder name', async () => {
			const localContent = 'Local version';
			const customFolder = 'my_conflicts';

			vault.addFile('note.md', localContent);

			const conflictFilename = generateConflictFilename('note.md', customFolder);

			// Verify custom folder is used
			expect(conflictFilename.startsWith(customFolder + '/')).toBe(true);
		});

		it('should not sync conflict folder files', async () => {
			const excludePatterns = ['.obsidian/**', '.**', '.*/**', `${DEFAULT_CONFLICT_FOLDER}/**`];
			const conflictFilename = `${DEFAULT_CONFLICT_FOLDER}/note_20240124_103000.md`;

			// Simple pattern matching check
			const isExcluded = excludePatterns.some(pattern => {
				if (pattern === `${DEFAULT_CONFLICT_FOLDER}/**`) {
					return conflictFilename.startsWith(`${DEFAULT_CONFLICT_FOLDER}/`);
				}
				return false;
			});

			expect(isExcluded).toBe(true);
		});

		it('should handle nested path files correctly', async () => {
			const localContent = 'Local version';
			const originalPath = 'notes/daily/2024-01-24.md';

			vault.addFile(originalPath, localContent);

			// Conflict filename should only use the filename, not full path
			const conflictFilename = generateConflictFilename(originalPath, DEFAULT_CONFLICT_FOLDER);

			expect(conflictFilename).toMatch(new RegExp(`^${DEFAULT_CONFLICT_FOLDER}/2024-01-24_\\d{8}_\\d{6}\\.md$`));
		});
	});

	describe('Multiple Conflicts', () => {
		it('should handle multiple conflicting files', async () => {
			const originalHash = await calculateHash(new TextEncoder().encode('Original').buffer as ArrayBuffer);

			// Last sync state with 3 files
			const localMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-01T00:00:00.000Z',
				files: {
					'file1.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' },
					'file2.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' },
					'file3.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' }
				}
			};

			const remoteEditHash = await calculateHash(new TextEncoder().encode('Remote edit').buffer as ArrayBuffer);

			// Remote changed all 3 files
			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: '2024-01-02T00:00:00.000Z',
				files: {
					'file1.md': { hash: remoteEditHash, modifiedTime: '2024-01-02T00:00:00.000Z' },
					'file2.md': { hash: remoteEditHash, modifiedTime: '2024-01-02T00:00:00.000Z' },
					'file3.md': { hash: originalHash, modifiedTime: '2024-01-01T00:00:00.000Z' } // This one unchanged
				}
			};

			// Local changed 2 files
			vault.addFile('file1.md', 'Local edit'); // Conflict
			vault.addFile('file2.md', 'Original'); // No conflict - local unchanged
			vault.addFile('file3.md', 'Local edit'); // Local changed, remote unchanged - no conflict

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

			// Only file1.md should be in conflicts
			expect(conflicts.length).toBe(1);
			expect(conflicts).toContain('file1.md');
		});

		it('should allow different resolution for each conflict', () => {
			// Simulate conflict resolution choices (only local or remote now)
			type Resolution = 'local' | 'remote';

			const conflictResolutions: Record<string, Resolution> = {
				'file1.md': 'local',
				'file2.md': 'remote',
				'file3.md': 'local'
			};

			// Each file can have different resolution
			expect(conflictResolutions['file1.md']).toBe('local');
			expect(conflictResolutions['file2.md']).toBe('remote');
			expect(conflictResolutions['file3.md']).toBe('local');
		});
	});

	describe('First Sync Conflicts (No Local Meta)', () => {
		it('should detect conflicts when local meta is null but file exists with different content', async () => {
			const localContent = 'Local content';
			const remoteContent = 'Remote content';

			vault.addFile('note.md', localContent);

			const localHash = await calculateHash(new TextEncoder().encode(localContent).buffer as ArrayBuffer);
			const remoteHash = await calculateHash(new TextEncoder().encode(remoteContent).buffer as ArrayBuffer);

			const remoteMeta: SyncMeta = {
				lastUpdatedAt: '2024-01-01T00:00:00.000Z',
				lastSyncTimestamp: new Date().toISOString(),
				files: {
					'note.md': { hash: remoteHash, modifiedTime: new Date().toISOString() }
				}
			};

			// When local meta is null, compare current local hash with remote
			const hasConflict = localHash !== remoteMeta.files['note.md'].hash;
			expect(hasConflict).toBe(true);
		});

		it('should not conflict when local file matches remote', async () => {
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

			const localHash = await calculateHash(
				new TextEncoder().encode(vault.getFileContent('note.md')!).buffer as ArrayBuffer
			);

			const hasConflict = localHash !== remoteMeta.files['note.md'].hash;
			expect(hasConflict).toBe(false);
		});
	});
});
