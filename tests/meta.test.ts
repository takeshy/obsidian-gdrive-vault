import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault, MockTFile } from './mocks/obsidian';
import {
	shouldExclude,
	matchGlob,
	generateBackupFilename,
	generateConflictFilename,
	createEmptyMeta,
} from '../sync/meta';
import { META_FILE_NAME_LOCAL } from '../sync/types';

describe('matchGlob', () => {
	it('should match exact file names', () => {
		expect(matchGlob('test.md', 'test.md')).toBe(true);
		expect(matchGlob('test.md', 'other.md')).toBe(false);
	});

	it('should match with * wildcard', () => {
		expect(matchGlob('test.md', '*.md')).toBe(true);
		expect(matchGlob('test.txt', '*.md')).toBe(false);
		// Note: Our simple glob implementation treats * as matching any chars
		// This is fine for exclude patterns since we mainly use ** and prefix matching
	});

	it('should match with ** wildcard', () => {
		expect(matchGlob('notes/test.md', '**/*.md')).toBe(true);
		expect(matchGlob('notes/sub/test.md', '**/*.md')).toBe(true);
		// ** matches anything including path separators
	});

	it('should match .obsidian folder pattern', () => {
		expect(matchGlob('.obsidian/config.json', '.obsidian/**')).toBe(true);
		expect(matchGlob('.obsidian/plugins/test/main.js', '.obsidian/**')).toBe(true);
		expect(matchGlob('notes/.obsidian/test', '.obsidian/**')).toBe(false);
	});

	it('should match dot files pattern', () => {
		expect(matchGlob('.gitignore', '.**')).toBe(true);
		expect(matchGlob('.hidden', '.**')).toBe(true);
		expect(matchGlob('visible.txt', '.**')).toBe(false);
	});

	it('should match dot folder contents', () => {
		expect(matchGlob('.git/config', '.*/**')).toBe(true);
		expect(matchGlob('.hidden/file.txt', '.*/**')).toBe(true);
		expect(matchGlob('visible/file.txt', '.*/**')).toBe(false);
	});
});

describe('shouldExclude', () => {
	const defaultPatterns = ['.obsidian/**', '.**', '.*/**'];

	it('should exclude .obsidian folder', () => {
		expect(shouldExclude('.obsidian/config.json', defaultPatterns)).toBe(true);
		expect(shouldExclude('.obsidian/plugins/test.js', defaultPatterns)).toBe(true);
	});

	it('should exclude dot files', () => {
		expect(shouldExclude('.gitignore', defaultPatterns)).toBe(true);
		expect(shouldExclude('.DS_Store', defaultPatterns)).toBe(true);
	});

	it('should exclude dot folder contents', () => {
		expect(shouldExclude('.git/config', defaultPatterns)).toBe(true);
		expect(shouldExclude('.hidden/secret.txt', defaultPatterns)).toBe(true);
	});

	it('should not exclude regular files', () => {
		expect(shouldExclude('notes/test.md', defaultPatterns)).toBe(false);
		expect(shouldExclude('README.md', defaultPatterns)).toBe(false);
		expect(shouldExclude('folder/subfolder/file.txt', defaultPatterns)).toBe(false);
	});

	it('should handle empty patterns', () => {
		expect(shouldExclude('anything.md', [])).toBe(false);
	});
});

describe('generateBackupFilename', () => {
	it('should add backup suffix with timestamp', () => {
		const result = generateBackupFilename('test.md');
		expect(result).toMatch(/^test_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
	});

	it('should handle files without extension', () => {
		const result = generateBackupFilename('README');
		expect(result).toMatch(/^README_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
	});

	it('should handle files with path', () => {
		const result = generateBackupFilename('notes/daily/2024-01-01.md');
		expect(result).toMatch(/^notes\/daily\/2024-01-01_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
	});

	it('should handle files with multiple dots', () => {
		const result = generateBackupFilename('file.test.md');
		expect(result).toMatch(/^file\.test_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
	});
});

describe('generateConflictFilename', () => {
	it('should place file in conflict folder with timestamp', () => {
		const result = generateConflictFilename('test.md', 'sync_conflicts');
		expect(result).toMatch(/^sync_conflicts\/test_\d{8}_\d{6}\.md$/);
	});

	it('should handle files without extension', () => {
		const result = generateConflictFilename('README', 'sync_conflicts');
		expect(result).toMatch(/^sync_conflicts\/README_\d{8}_\d{6}$/);
	});

	it('should extract only filename from path', () => {
		const result = generateConflictFilename('notes/daily/2024-01-01.md', 'sync_conflicts');
		// Should only use the filename, not the full path
		expect(result).toMatch(/^sync_conflicts\/2024-01-01_\d{8}_\d{6}\.md$/);
	});

	it('should handle custom conflict folder name', () => {
		const result = generateConflictFilename('test.md', 'my_conflicts');
		expect(result).toMatch(/^my_conflicts\/test_\d{8}_\d{6}\.md$/);
	});

	it('should handle files with multiple dots', () => {
		const result = generateConflictFilename('file.test.md', 'sync_conflicts');
		expect(result).toMatch(/^sync_conflicts\/file\.test_\d{8}_\d{6}\.md$/);
	});

	it('should produce unique filenames for same file', async () => {
		const result1 = generateConflictFilename('test.md', 'sync_conflicts');
		// Wait a second to ensure different timestamp
		await new Promise(resolve => setTimeout(resolve, 1100));
		const result2 = generateConflictFilename('test.md', 'sync_conflicts');
		expect(result1).not.toBe(result2);
	});
});

describe('createEmptyMeta', () => {
	it('should create meta with valid lastUpdatedAt', () => {
		const before = new Date().toISOString();
		const meta = createEmptyMeta();
		const after = new Date().toISOString();
		expect(meta.lastUpdatedAt >= before).toBe(true);
		expect(meta.lastUpdatedAt <= after).toBe(true);
	});

	it('should create meta with empty files object', () => {
		const meta = createEmptyMeta();
		expect(meta.files).toEqual({});
	});

	it('should create meta with valid timestamp', () => {
		const before = new Date().toISOString();
		const meta = createEmptyMeta();
		const after = new Date().toISOString();

		expect(meta.lastSyncTimestamp >= before).toBe(true);
		expect(meta.lastSyncTimestamp <= after).toBe(true);
	});
});

describe('MockVault', () => {
	let vault: MockVault;

	beforeEach(() => {
		vault = new MockVault();
	});

	it('should add and read files', async () => {
		vault.addFile('test.md', 'Hello World');

		const file = vault.getAbstractFileByPath('test.md');
		expect(file).not.toBeNull();
		expect(file!.path).toBe('test.md');

		const content = await vault.read(file as MockTFile);
		expect(content).toBe('Hello World');
	});

	it('should create new files', async () => {
		await vault.create('new.md', 'New content');

		expect(vault.hasFile('new.md')).toBe(true);
		expect(vault.getFileContent('new.md')).toBe('New content');
	});

	it('should throw when creating existing file', async () => {
		vault.addFile('existing.md', 'content');

		await expect(vault.create('existing.md', 'new content'))
			.rejects.toThrow('File already exists');
	});

	it('should modify existing files', async () => {
		vault.addFile('test.md', 'Original');
		const file = vault.getAbstractFileByPath('test.md') as MockTFile;

		await vault.modify(file, 'Modified');

		expect(vault.getFileContent('test.md')).toBe('Modified');
	});

	it('should get all files', () => {
		vault.addFile('file1.md', 'content1');
		vault.addFile('file2.md', 'content2');
		vault.addFile('folder/file3.md', 'content3');

		const files = vault.getFiles();
		expect(files.length).toBe(3);
		expect(files.map(f => f.path).sort()).toEqual(['file1.md', 'file2.md', 'folder/file3.md']);
	});

	it('should delete files via trash', async () => {
		vault.addFile('test.md', 'content');
		const file = vault.getAbstractFileByPath('test.md') as MockTFile;

		await vault.trash(file, false);

		expect(vault.hasFile('test.md')).toBe(false);
	});
});
