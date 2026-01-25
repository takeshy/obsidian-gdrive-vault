/**
 * Meta file management for sync tracking
 */

import { Vault, TFile } from 'obsidian';
import {
	SyncMeta,
	FileMetadata,
	META_FILE_NAME_LOCAL,
	META_FILE_NAME_REMOTE,
	DriveFileInfo,
} from './types';
import { calculateHash } from './hash';
import {
	getFilesList,
	getFile,
	uploadFile,
	modifyFile,
} from '../actions';

/**
 * Create an empty meta file structure
 */
export function createEmptyMeta(): SyncMeta {
	const now = new Date().toISOString();
	return {
		lastUpdatedAt: now,
		lastSyncTimestamp: now,
		files: {},
	};
}

/**
 * Read local meta file
 */
export async function readLocalMeta(vault: Vault): Promise<SyncMeta | null> {
	try {
		const file = vault.getAbstractFileByPath(META_FILE_NAME_LOCAL);
		if (file instanceof TFile) {
			const content = await vault.read(file);
			return JSON.parse(content) as SyncMeta;
		}

		// Fallback: try reading directly from adapter (file index might not be updated yet)
		const exists = await vault.adapter.exists(META_FILE_NAME_LOCAL);
		if (exists) {
			const content = await vault.adapter.read(META_FILE_NAME_LOCAL);
			return JSON.parse(content) as SyncMeta;
		}

		return null;
	} catch (err) {
		console.error('Failed to read local meta file:', err);
		return null;
	}
}

/**
 * Write local meta file
 * Uses adapter.write directly to avoid Obsidian file index timing issues
 */
export async function writeLocalMeta(vault: Vault, meta: SyncMeta): Promise<void> {
	const content = JSON.stringify(meta, null, 2);
	await vault.adapter.write(META_FILE_NAME_LOCAL, content);
}

/**
 * Find remote meta file ID from files list
 */
export function findRemoteMetaFileId(filesList: DriveFileInfo[]): string | null {
	const metaFile = filesList.find(f => f.name === META_FILE_NAME_REMOTE);
	return metaFile ? metaFile.id : null;
}

/**
 * Read remote meta file from GDrive
 */
export async function readRemoteMeta(
	accessToken: string,
	vaultId: string,
	filesList: DriveFileInfo[]
): Promise<SyncMeta | null> {
	try {
		const metaFileId = findRemoteMetaFileId(filesList);
		if (!metaFileId) {
			return null;
		}

		const [, buffer] = await getFile(accessToken, metaFileId);
		const decoder = new TextDecoder();
		const content = decoder.decode(buffer);
		return JSON.parse(content) as SyncMeta;
	} catch (err) {
		console.error('Failed to read remote meta file:', err);
		return null;
	}
}

/**
 * Write remote meta file to GDrive
 */
export async function writeRemoteMeta(
	accessToken: string,
	vaultId: string,
	meta: SyncMeta,
	filesList: DriveFileInfo[]
): Promise<string> {
	const content = JSON.stringify(meta, null, 2);
	const encoder = new TextEncoder();
	const buffer = encoder.encode(content).buffer as ArrayBuffer;

	const metaFileId = findRemoteMetaFileId(filesList);

	if (metaFileId) {
		await modifyFile(accessToken, metaFileId, buffer);
		return metaFileId;
	} else {
		const newId = await uploadFile(accessToken, META_FILE_NAME_REMOTE, buffer, vaultId);
		return newId;
	}
}

/**
 * Build file metadata from local file
 */
export async function buildFileMetadata(
	vault: Vault,
	filePath: string
): Promise<FileMetadata | null> {
	try {
		const file = vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		const buffer = await vault.readBinary(file);
		const hash = await calculateHash(buffer);

		return {
			hash,
			modifiedTime: new Date(file.stat.mtime).toISOString(),
		};
	} catch (err) {
		console.error(`Failed to build metadata for ${filePath}:`, err);
		return null;
	}
}

/**
 * Build complete meta from all vault files
 */
export async function buildMetaFromVault(
	vault: Vault,
	excludePatterns: string[]
): Promise<SyncMeta> {
	const meta = createEmptyMeta();
	const files = vault.getFiles();

	for (const file of files) {
		// Skip meta files
		if (file.path === META_FILE_NAME_LOCAL || file.path === META_FILE_NAME_REMOTE) {
			continue;
		}
		if (shouldExclude(file.path, excludePatterns)) {
			continue;
		}

		const metadata = await buildFileMetadata(vault, file.path);
		if (metadata) {
			meta.files[file.path] = metadata;
		}
	}

	return meta;
}

/**
 * Check if a file path matches any exclude pattern (glob-like)
 */
export function shouldExclude(filePath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (matchGlob(filePath, pattern)) {
			return true;
		}
	}
	return false;
}

/**
 * Simple glob matching (supports * and **)
 */
export function matchGlob(path: string, pattern: string): boolean {
	// Normalize pattern
	const normalizedPattern = pattern.trim();

	if (!normalizedPattern) {
		return false;
	}

	// Convert glob pattern to regex
	let regexPattern = normalizedPattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
		.replace(/\*\*/g, '{{GLOBSTAR}}')      // Temporarily replace **
		.replace(/\*/g, '[^/]*')               // * matches anything except /
		.replace(/\?/g, '[^/]')                // ? matches single char except /
		.replace(/{{GLOBSTAR}}/g, '.*');       // ** matches anything including /

	// Handle patterns that should match from start or contain path
	if (!normalizedPattern.startsWith('*')) {
		regexPattern = '^' + regexPattern;
	}

	// Make pattern match the entire path or a prefix
	const regex = new RegExp(regexPattern);
	return regex.test(path);
}

/**
 * Generate backup filename with timestamp
 */
export function generateBackupFilename(originalPath: string): string {
	const now = new Date();
	const timestamp = now.toISOString()
		.replace(/[:.]/g, '-')
		.replace('T', '_')
		.slice(0, 19);

	const lastDot = originalPath.lastIndexOf('.');
	if (lastDot === -1) {
		return `${originalPath}_backup_${timestamp}`;
	}

	const name = originalPath.slice(0, lastDot);
	const ext = originalPath.slice(lastDot);
	return `${name}_backup_${timestamp}${ext}`;
}

/**
 * Generate conflict filename in the conflict folder
 * Format: {conflictFolder}/{filename}_{YYYYMMDD_HHMMSS}.{ext}
 */
export function generateConflictFilename(originalPath: string, conflictFolder: string): string {
	const timestamp = new Date().toISOString()
		.replace(/[-:]/g, '')
		.replace('T', '_')
		.slice(0, 15); // YYYYMMDD_HHMMSS

	// Get filename from path
	const fileName = originalPath.split('/').pop() || originalPath;
	const lastDot = fileName.lastIndexOf('.');

	if (lastDot === -1) {
		return `${conflictFolder}/${fileName}_${timestamp}`;
	}

	const name = fileName.slice(0, lastDot);
	const ext = fileName.slice(lastDot);
	return `${conflictFolder}/${name}_${timestamp}${ext}`;
}

/**
 * Generate an untracked filename by adding timestamp suffix
 * Used for renaming remote files before overwriting in Full Push
 * e.g., "notes/daily.md" → "notes/daily_20240124_103000.md"
 */
export function generateUntrackedFilename(originalPath: string): string {
	const timestamp = new Date().toISOString()
		.replace(/[-:]/g, '')
		.replace('T', '_')
		.slice(0, 15); // YYYYMMDD_HHMMSS

	const lastDot = originalPath.lastIndexOf('.');

	if (lastDot === -1) {
		return `${originalPath}_${timestamp}`;
	}

	const name = originalPath.slice(0, lastDot);
	const ext = originalPath.slice(lastDot);
	return `${name}_${timestamp}${ext}`;
}
