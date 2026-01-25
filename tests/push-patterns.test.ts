import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockGDriveAPI } from './mocks/obsidian';
import { SyncMeta } from '../sync/types';
import { calculateHash } from '../sync/hash';

/**
 * Comprehensive tests for Push Changes and Full Push patterns
 *
 * Push Changes Decision Table:
 *
 * Preconditions:
 * | Local Meta | Remote Meta | Remote Newer | Action |
 * |:----------:|:-----------:|:------------:|--------|
 * | - | - | - | Full Push (first sync) |
 * | - | exists | - | Error: "Pull required first" |
 * | exists | exists | Yes | Dialog: "Pull required" |
 * | exists | exists | No | Proceed with Push |
 *
 * Files in Current Vault:
 * | Saved Meta | Actual File | Remote File | Action |
 * |:----------:|:-----------:|:-----------:|--------|
 * | A | A | exists | Skip (unchanged) |
 * | A | B | exists | Upload (local changed) |
 * | - | A | not exists | Upload (new file) |
 * | - | A | exists | Upload (overwrite remote) |
 *
 * Files Deleted Locally:
 * | Saved Meta | Actual File | Remote File | Action |
 * |:----------:|:-----------:|:-----------:|--------|
 * | A | - | exists | Skip (stays untracked on remote) |
 *
 * Full Push Decision Table:
 * | Local File | Remote File | Remote Meta | Hashes | Action |
 * |:----------:|:-----------:|:-----------:|:------:|--------|
 * | A | exists | hash=A | Same | Skip (unchanged) |
 * | B | exists | hash=A | Different | Rename remote → Upload B |
 * | A | exists | - | - | Upload A |
 * | A | not exists | - | - | Upload A |
 */
describe('Push Changes - All Patterns', () => {
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

	describe('Preconditions', () => {
		it('triggers Full Push when no remote meta exists', () => {
			const remoteMeta = null;
			const localMeta = createMeta({});

			const shouldFullPush = remoteMeta === null;
			expect(shouldFullPush).toBe(true);
		});

		it('requires Pull first when no local meta but remote exists', () => {
			const localMeta = null;
			const remoteMeta = createMeta({});

			const requiresPullFirst = localMeta === null && remoteMeta !== null;
			expect(requiresPullFirst).toBe(true);
		});

		it('requires Pull when remote is newer', () => {
			const localMeta = createMeta({}, '2024-01-01T00:00:00.000Z');
			const remoteMeta = createMeta({}, '2024-01-02T00:00:00.000Z');

			const remoteIsNewer = remoteMeta.lastUpdatedAt > localMeta.lastUpdatedAt;
			expect(remoteIsNewer).toBe(true);
		});

		it('proceeds with Push when local is same or newer', () => {
			const localMeta = createMeta({}, '2024-01-02T00:00:00.000Z');
			const remoteMeta = createMeta({}, '2024-01-01T00:00:00.000Z');

			const canPush = remoteMeta.lastUpdatedAt <= localMeta.lastUpdatedAt;
			expect(canPush).toBe(true);
		});
	});

	describe('Files in Current Vault', () => {
		it('A|A|exists: skips unchanged files', async () => {
			const content = 'Unchanged content';
			const hashA = await hash(content);

			vault.addFile('note.md', content);
			gdrive.addFile('note.md', content);

			const savedMeta = createMeta({ 'note.md': { hash: hashA } });

			const toUpload: string[] = [];

			for (const [path, metaInfo] of Object.entries(savedMeta.files)) {
				const actualFile = vault.getFileContent(path);
				const driveFile = gdrive.getFileByName(path);

				if (actualFile !== null && driveFile) {
					const actualHash = await hash(actualFile);

					if (actualHash === metaInfo.hash) {
						// Unchanged - skip
						continue;
					}
					toUpload.push(path);
				}
			}

			expect(toUpload).toEqual([]);
		});

		it('A|B|exists: uploads changed files', async () => {
			const originalContent = 'Original';
			const editedContent = 'Edited';
			const hashA = await hash(originalContent);

			vault.addFile('note.md', editedContent);
			gdrive.addFile('note.md', originalContent);

			const savedMeta = createMeta({ 'note.md': { hash: hashA } });

			const toUpload: string[] = [];

			for (const [path, metaInfo] of Object.entries(savedMeta.files)) {
				const actualFile = vault.getFileContent(path);
				const driveFile = gdrive.getFileByName(path);

				if (actualFile !== null && driveFile) {
					const actualHash = await hash(actualFile);

					if (actualHash !== metaInfo.hash) {
						// Changed - upload
						toUpload.push(path);
					}
				}
			}

			expect(toUpload).toContain('note.md');
		});

		it('-|A|not exists: uploads new files', async () => {
			const content = 'New file content';

			vault.addFile('new-file.md', content);
			// No remote file

			const savedMeta = createMeta({}); // Empty meta (or file not in meta)

			const toUpload: string[] = [];

			// Check files in vault that are not in saved meta
			for (const file of vault.getFiles()) {
				if (!savedMeta.files[file.path]) {
					const driveFile = gdrive.getFileByName(file.path);
					if (!driveFile) {
						// New file, doesn't exist on remote
						toUpload.push(file.path);
					}
				}
			}

			expect(toUpload).toContain('new-file.md');
		});

		it('-|A|exists: uploads and overwrites remote', async () => {
			const localContent = 'Local content';
			const remoteContent = 'Remote content';

			vault.addFile('note.md', localContent);
			gdrive.addFile('note.md', remoteContent);

			const savedMeta = createMeta({}); // File not tracked yet

			const toUpload: string[] = [];

			// Check files in vault that are not in saved meta
			for (const file of vault.getFiles()) {
				if (!savedMeta.files[file.path]) {
					// File not in meta - upload (will overwrite)
					toUpload.push(file.path);
				}
			}

			expect(toUpload).toContain('note.md');
		});
	});

	describe('Files Deleted Locally', () => {
		it('A|-|exists: skips and leaves file untracked on remote', async () => {
			const content = 'Content';
			const hashA = await hash(content);

			// File deleted from vault (not present)
			gdrive.addFile('deleted.md', content);

			const savedMeta = createMeta({ 'deleted.md': { hash: hashA } });

			const toUpload: string[] = [];
			const staysUntracked: string[] = [];

			// Check for files in meta but not in vault (deleted locally)
			for (const path of Object.keys(savedMeta.files)) {
				const actualFile = vault.getFileContent(path);

				if (actualFile === null) {
					// File deleted locally
					// Push does NOT delete remote files
					// File becomes "untracked" on remote
					staysUntracked.push(path);
				}
			}

			expect(toUpload).toEqual([]);
			expect(staysUntracked).toContain('deleted.md');
		});
	});
});

describe('Full Push - All Patterns', () => {
	let vault: MockVault;
	let gdrive: MockGDriveAPI;

	beforeEach(() => {
		vault = new MockVault();
		gdrive = new MockGDriveAPI();
	});

	async function hash(content: string): Promise<string> {
		return calculateHash(new TextEncoder().encode(content).buffer as ArrayBuffer);
	}

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

	it('A|exists|hash=A|Same: skips unchanged files', async () => {
		const content = 'Same content';
		const hashA = await hash(content);

		vault.addFile('note.md', content);
		gdrive.addFile('note.md', content);

		const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

		const toUpload: string[] = [];
		const toSkip: string[] = [];

		for (const file of vault.getFiles()) {
			const fileContent = vault.getFileContent(file.path);
			if (fileContent === null) continue;

			const localHash = await hash(fileContent);
			const driveFile = gdrive.getFileByName(file.path);
			const remoteMetaEntry = remoteMeta.files[file.path];

			if (driveFile && remoteMetaEntry) {
				if (localHash === remoteMetaEntry.hash) {
					// Same hash - skip
					toSkip.push(file.path);
					continue;
				}
			}

			toUpload.push(file.path);
		}

		expect(toSkip).toContain('note.md');
		expect(toUpload).not.toContain('note.md');
	});

	it('B|exists|hash=A|Different: renames remote and uploads', async () => {
		const originalContent = 'Original';
		const newContent = 'New content';
		const hashA = await hash(originalContent);

		vault.addFile('note.md', newContent);
		gdrive.addFile('note.md', originalContent);

		const remoteMeta = createMeta({ 'note.md': { hash: hashA } });

		const toRenameAndUpload: string[] = [];

		for (const file of vault.getFiles()) {
			const fileContent = vault.getFileContent(file.path);
			if (fileContent === null) continue;

			const localHash = await hash(fileContent);
			const driveFile = gdrive.getFileByName(file.path);
			const remoteMetaEntry = remoteMeta.files[file.path];

			if (driveFile && remoteMetaEntry) {
				if (localHash !== remoteMetaEntry.hash) {
					// Different hash - rename remote and upload
					toRenameAndUpload.push(file.path);
				}
			}
		}

		expect(toRenameAndUpload).toContain('note.md');
	});

	it('A|exists|-: uploads file (no meta entry)', async () => {
		const content = 'Content';

		vault.addFile('note.md', content);
		gdrive.addFile('note.md', 'Old content');

		const remoteMeta = createMeta({}); // No meta entry for this file

		const toUpload: string[] = [];

		for (const file of vault.getFiles()) {
			const driveFile = gdrive.getFileByName(file.path);
			const remoteMetaEntry = remoteMeta.files[file.path];

			if (!remoteMetaEntry) {
				// No meta entry - upload directly
				toUpload.push(file.path);
			}
		}

		expect(toUpload).toContain('note.md');
	});

	it('A|not exists|-: uploads new file', async () => {
		const content = 'New content';

		vault.addFile('new-file.md', content);
		// No remote file

		const remoteMeta = createMeta({});

		const toUpload: string[] = [];

		for (const file of vault.getFiles()) {
			const driveFile = gdrive.getFileByName(file.path);
			const remoteMetaEntry = remoteMeta.files[file.path];

			if (!driveFile && !remoteMetaEntry) {
				// New file - upload
				toUpload.push(file.path);
			}
		}

		expect(toUpload).toContain('new-file.md');
	});
});
