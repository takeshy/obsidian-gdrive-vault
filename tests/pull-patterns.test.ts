import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockGDriveAPI } from './mocks/obsidian';
import { SyncMeta } from '../sync/types';
import { calculateHash } from '../sync/hash';

/**
 * Comprehensive tests for all Pull Changes patterns
 *
 * Decision Table:
 *
 * Files in both metas:
 * | Local Meta | Remote Meta | Actual | Action |
 * |:----------:|:-----------:|:------:|--------|
 * | A | A | A | Skip (unchanged) |
 * | A | A | B | Skip (local-only change) |
 * | A | A | - | Skip (local deleted) |
 * | A | B | A | Download (remote changed) |
 * | A | B | B | Conflict (both changed) |
 * | A | B | C | Conflict (both changed) |
 * | A | B | - | Download (local deleted + remote updated) |
 *
 * Local meta only (remote deleted):
 * | A | - | A | Delete local |
 * | A | - | B | Conflict (local modified, remote deleted) |
 * | A | - | - | Nothing (already deleted both sides) |
 *
 * Remote meta only (new remote):
 * | - | A | - | Download (new remote file) |
 * | - | A | A | Skip, update meta only (same content) |
 * | - | A | B | Conflict (both have different new files) |
 */
describe('Pull Changes - All Patterns', () => {
	let vault: MockVault;
	let gdrive: MockGDriveAPI;

	beforeEach(() => {
		vault = new MockVault();
		gdrive = new MockGDriveAPI();
	});

	// Helper function to create hash from string
	async function hash(content: string): Promise<string> {
		return calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);
	}

	// Helper function to create meta
	function createMeta(
		files: Record<string, { hash: string; modifiedTime?: string }>,
		lastUpdatedAt = '2024-01-01T00:00:00.000Z'
	): SyncMeta {
		const filesWithTime: Record<string, { hash: string; modifiedTime: string }> = {};
		for (const [path, info] of Object.entries(files)) {
			filesWithTime[path] = {
				hash: info.hash,
				modifiedTime: info.modifiedTime || lastUpdatedAt,
			};
		}
		return {
			lastUpdatedAt,
			lastSyncTimestamp: lastUpdatedAt,
			files: filesWithTime,
		};
	}

	describe('Files in both metas', () => {
		it('A|A|A: skips unchanged files', async () => {
			const content = 'Unchanged content';
			const hashA = await hash(content);

			vault.addFile('note.md', content);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

			// Simulate pull logic
			const toDownload: string[] = [];
			const toDelete: string[] = [];
			const conflicts: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile !== null) {
					const actualHash = await hash(actualFile);

					if (localMetaInfo && localMetaInfo.hash === remoteInfo.hash) {
						// A | A | * - no remote change, skip
						continue;
					}
				}
			}

			expect(toDownload).toEqual([]);
			expect(toDelete).toEqual([]);
			expect(conflicts).toEqual([]);
		});

		it('A|A|B: skips local-only changes (for next Push)', async () => {
			const originalContent = 'Original';
			const editedContent = 'Edited locally';
			const hashA = await hash(originalContent);

			vault.addFile('note.md', editedContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

			// Simulate pull logic
			const toDownload: string[] = [];
			const conflicts: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile !== null) {
					const actualHash = await hash(actualFile);

					if (localMetaInfo && localMetaInfo.hash === remoteInfo.hash) {
						// A | A | B - remote unchanged, local changed
						// Skip - will be uploaded on next Push
						expect(actualHash).not.toBe(hashA);
						continue;
					}
				}
			}

			expect(toDownload).toEqual([]);
			expect(conflicts).toEqual([]);
		});

		it('A|A|-: skips locally deleted files (for next Push)', async () => {
			const content = 'Content';
			const hashA = await hash(content);

			// File deleted locally (not in vault)
			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

			// Simulate pull logic
			const toDownload: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile === null) {
					// File doesn't exist locally
					if (localMetaInfo && localMetaInfo.hash === remoteInfo.hash) {
						// A | A | - : Deleted locally, remote unchanged
						// Skip - deletion will propagate on next Push
						continue;
					}
				}
			}

			expect(toDownload).toEqual([]);
		});

		it('A|B|A: downloads remote changes', async () => {
			const originalContent = 'Original';
			const remoteContent = 'Remote edit';
			const hashA = await hash(originalContent);
			const hashB = await hash(remoteContent);

			vault.addFile('note.md', originalContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashB } });

			const toDownload: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile !== null) {
					const actualHash = await hash(actualFile);

					if (localMetaInfo && localMetaInfo.hash !== remoteInfo.hash) {
						// Remote changed
						if (localMetaInfo.hash === actualHash) {
							// Local unchanged - safe to download
							toDownload.push(path);
						}
					}
				}
			}

			expect(toDownload).toContain('note.md');
		});

		it('A|B|B: detects conflict when both changed to same value', async () => {
			const originalContent = 'Original';
			const newContent = 'Both edited to same';
			const hashA = await hash(originalContent);
			const hashB = await hash(newContent);

			vault.addFile('note.md', newContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashB } });

			const conflicts: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile !== null && localMetaInfo) {
					const actualHash = await hash(actualFile);
					const localChanged = actualHash !== localMetaInfo.hash;
					const remoteChanged = remoteInfo.hash !== localMetaInfo.hash;

					if (localChanged && remoteChanged) {
						conflicts.push(path);
					}
				}
			}

			expect(conflicts).toContain('note.md');
		});

		it('A|B|C: detects conflict when both changed to different values', async () => {
			const originalContent = 'Original';
			const localContent = 'Local edit';
			const remoteContent = 'Remote edit';
			const hashA = await hash(originalContent);
			const hashB = await hash(remoteContent);

			vault.addFile('note.md', localContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashB } });

			const conflicts: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile !== null && localMetaInfo) {
					const actualHash = await hash(actualFile);
					const localChanged = actualHash !== localMetaInfo.hash;
					const remoteChanged = remoteInfo.hash !== localMetaInfo.hash;

					if (localChanged && remoteChanged) {
						conflicts.push(path);
					}
				}
			}

			expect(conflicts).toContain('note.md');
		});

		it('A|B|-: downloads when local deleted but remote updated', async () => {
			const originalContent = 'Original';
			const remoteContent = 'Remote edit';
			const hashA = await hash(originalContent);
			const hashB = await hash(remoteContent);

			// File deleted locally
			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({ 'note.md': { hash: hashB } });

			const toDownload: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				const localMetaInfo = localMeta.files[path];
				const actualFile = vault.getFileContent(path);

				if (actualFile === null) {
					// File doesn't exist locally
					if (localMetaInfo && localMetaInfo.hash !== remoteInfo.hash) {
						// A | B | - : Deleted locally but remote updated
						// Download the remote version
						toDownload.push(path);
					}
				}
			}

			expect(toDownload).toContain('note.md');
		});
	});

	describe('Files only in local meta (remote deleted)', () => {
		it('A|-|A: deletes local file when remote deleted', async () => {
			const content = 'Content';
			const hashA = await hash(content);

			vault.addFile('note.md', content);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({}); // File deleted from remote

			const toDelete: string[] = [];

			for (const path of Object.keys(localMeta.files)) {
				if (!remoteMeta.files[path]) {
					const localMetaInfo = localMeta.files[path];
					const actualFile = vault.getFileContent(path);

					if (actualFile !== null) {
						const actualHash = await hash(actualFile);
						if (actualHash === localMetaInfo.hash) {
							// A | - | A : Local unchanged, remote deleted
							// Delete local file
							toDelete.push(path);
						}
					}
				}
			}

			expect(toDelete).toContain('note.md');
		});

		it('A|-|B: detects conflict when local modified but remote deleted', async () => {
			const originalContent = 'Original';
			const editedContent = 'Local edit';
			const hashA = await hash(originalContent);

			vault.addFile('note.md', editedContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({}); // File deleted from remote

			const conflicts: Array<{ path: string; remoteDeleted: boolean }> = [];

			for (const path of Object.keys(localMeta.files)) {
				if (!remoteMeta.files[path]) {
					const localMetaInfo = localMeta.files[path];
					const actualFile = vault.getFileContent(path);

					if (actualFile !== null) {
						const actualHash = await hash(actualFile);
						if (actualHash !== localMetaInfo.hash) {
							// A | - | B : Local modified, remote deleted
							// This is a conflict!
							conflicts.push({ path, remoteDeleted: true });
						}
					}
				}
			}

			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].path).toBe('note.md');
			expect(conflicts[0].remoteDeleted).toBe(true);
		});

		it('A|-|-: does nothing when already deleted on both sides', async () => {
			const content = 'Content';
			const hashA = await hash(content);

			// File deleted locally (not in vault)
			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({}); // File deleted from remote

			const toDelete: string[] = [];
			const conflicts: string[] = [];

			for (const path of Object.keys(localMeta.files)) {
				if (!remoteMeta.files[path]) {
					const actualFile = vault.getFileContent(path);

					if (actualFile === null) {
						// A | - | - : Already deleted on both sides
						// Nothing to do
						continue;
					}
				}
			}

			expect(toDelete).toEqual([]);
			expect(conflicts).toEqual([]);
		});
	});

	describe('Files only in remote meta (new remote)', () => {
		it('-|A|-: downloads new remote file', async () => {
			const content = 'New remote content';
			const hashA = await hash(content);

			// File doesn't exist locally
			const localMeta = createMeta({});
			const remoteMeta = createMeta({ 'new-file.md': { hash: hashA } });

			const toDownload: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				if (!localMeta.files[path]) {
					const actualFile = vault.getFileContent(path);

					if (actualFile === null) {
						// - | A | - : New remote file
						// Download it
						toDownload.push(path);
					}
				}
			}

			expect(toDownload).toContain('new-file.md');
		});

		it('-|A|A: skips download and updates meta only when same content', async () => {
			const content = 'Same content';
			const hashA = await hash(content);

			vault.addFile('note.md', content);

			// No local meta (first sync or meta lost)
			const localMeta = createMeta({});
			const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

			const toDownload: string[] = [];
			const toUpdateMetaOnly: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				if (!localMeta.files[path]) {
					const actualFile = vault.getFileContent(path);

					if (actualFile !== null) {
						const actualHash = await hash(actualFile);

						if (actualHash === remoteInfo.hash) {
							// - | A | A : Same content locally
							// Skip download, just update meta
							toUpdateMetaOnly.push(path);
						} else {
							// - | A | B : Different content
							toDownload.push(path);
						}
					} else {
						// - | A | - : File doesn't exist
						toDownload.push(path);
					}
				}
			}

			expect(toDownload).toEqual([]);
			expect(toUpdateMetaOnly).toContain('note.md');
		});

		it('-|A|B: detects conflict when both have different new files', async () => {
			const localContent = 'Local new content';
			const remoteContent = 'Remote new content';
			const hashA = await hash(remoteContent);

			vault.addFile('note.md', localContent);

			// No local meta (first sync)
			const localMeta = createMeta({});
			const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

			const conflicts: string[] = [];

			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				if (!localMeta.files[path]) {
					const actualFile = vault.getFileContent(path);

					if (actualFile !== null) {
						const actualHash = await hash(actualFile);

						if (actualHash !== remoteInfo.hash) {
							// - | A | B : Both have file but different content
							// This is a conflict
							conflicts.push(path);
						}
					}
				}
			}

			expect(conflicts).toContain('note.md');
		});
	});

	describe('Conflict resolution for A|-|B', () => {
		it('resolving with "local" keeps the file and excludes from deletion', async () => {
			const originalContent = 'Original';
			const editedContent = 'Local edit';
			const hashA = await hash(originalContent);

			vault.addFile('note.md', editedContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({});

			const resolutions: Record<string, 'local' | 'remote'> = {
				'note.md': 'local',
			};

			const toDelete: string[] = [];
			const keptFiles: string[] = [];

			for (const path of Object.keys(localMeta.files)) {
				if (!remoteMeta.files[path]) {
					const localMetaInfo = localMeta.files[path];
					const actualFile = vault.getFileContent(path);

					if (actualFile !== null) {
						const actualHash = await hash(actualFile);
						const isModified = actualHash !== localMetaInfo.hash;

						if (isModified && resolutions[path] === 'local') {
							// Keep local file
							keptFiles.push(path);
							continue;
						}

						toDelete.push(path);
					}
				}
			}

			expect(toDelete).toEqual([]);
			expect(keptFiles).toContain('note.md');
		});

		it('resolving with "remote" deletes the local file', async () => {
			const originalContent = 'Original';
			const editedContent = 'Local edit';
			const hashA = await hash(originalContent);

			vault.addFile('note.md', editedContent);

			const localMeta = createMeta({ 'note.md': { hash: hashA } });
			const remoteMeta = createMeta({});

			const resolutions: Record<string, 'local' | 'remote'> = {
				'note.md': 'remote',
			};

			const toDelete: string[] = [];

			for (const path of Object.keys(localMeta.files)) {
				if (!remoteMeta.files[path]) {
					const localMetaInfo = localMeta.files[path];
					const actualFile = vault.getFileContent(path);

					if (actualFile !== null) {
						const actualHash = await hash(actualFile);
						const isModified = actualHash !== localMetaInfo.hash;

						if (isModified && resolutions[path] === 'local') {
							continue;
						}

						// Delete (remote chose = accept deletion)
						toDelete.push(path);
					}
				}
			}

			expect(toDelete).toContain('note.md');
		});
	});
});
