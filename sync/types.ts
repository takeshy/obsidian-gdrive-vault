/**
 * Type definitions for the manual sync system
 */

/** Metadata for a single file */
export interface FileMetadata {
	hash: string;
	modifiedTime: string;
}

/** Meta file structure stored both locally and on GDrive */
export interface SyncMeta {
	lastUpdatedAt: string;
	lastSyncTimestamp: string;
	files: Record<string, FileMetadata>;
}

/** Conflict information for a single file */
export interface ConflictInfo {
	path: string;
	localModifiedTime: string;
	remoteModifiedTime: string;
	localHash: string;
	remoteHash: string;
	/** True if remote file was deleted (A | - | B conflict) */
	remoteDeleted?: boolean;
}

/** User's resolution choice for a conflict */
export type ConflictResolution = 'local' | 'remote';

/** Default conflict folder name */
export const DEFAULT_CONFLICT_FOLDER = 'sync_conflicts';

/** Resolution decisions for multiple conflicts */
export interface ConflictResolutions {
	[path: string]: ConflictResolution;
}

/** Result of sync comparison */
export interface SyncDiff {
	/** Files that exist locally but not on remote */
	toUpload: string[];
	/** Files that exist on remote but not locally */
	toDownload: string[];
	/** Files that exist on both but have different content */
	conflicts: ConflictInfo[];
	/** Files that were deleted locally but exist on remote */
	deletedLocally: string[];
	/** Files that were deleted remotely but exist locally */
	deletedRemotely: string[];
}

/** GDrive file info from API */
export interface DriveFileInfo {
	id: string;
	name: string;
	modifiedTime: string;
	mimeType?: string;
}

/** Plugin settings interface */
export interface DriveSettings {
	refreshToken: string;
	accessToken: string;
	accessTokenExpiryTime: string;
	refreshAccessTokenURL: string;
	fetchRefreshTokenURL: string;
	validToken: boolean;
	vaultId: string;
	vaultInit: boolean;
	filesList: DriveFileInfo[];
	rootFolderId: string;
	excludePatterns: string[];
	conflictFolder: string;
}

/** Constants for file paths */
export const META_FILE_NAME_LOCAL = '.obsidian/gdrive-vault-meta.json';
export const META_FILE_NAME_REMOTE = '_gdrive-vault-meta.json';
