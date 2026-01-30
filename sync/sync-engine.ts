/**
 * Core sync engine for manual synchronization
 */

import { App, Notice, TFile, TFolder, Vault } from 'obsidian';
import {
	SyncMeta,
	SyncDiff,
	ConflictInfo,
	ConflictResolutions,
	DriveFileInfo,
	DriveSettings,
	META_FILE_NAME_LOCAL,
	META_FILE_NAME_REMOTE,
	TEMP_SYNC_PREFIX,
} from './types';
import { calculateHash } from './hash';
import {
	readLocalMeta,
	writeLocalMeta,
	readRemoteMeta,
	writeRemoteMeta,
	buildMetaFromVault,
	buildFileMetadata,
	shouldExclude,
	createEmptyMeta,
	generateBackupFilename,
	generateConflictFilename,
	generateUntrackedFilename,
} from './meta';
import {
	getFilesList,
	getFile,
	uploadFile,
	modifyFile,
	deleteFile,
	renameFile,
} from '../actions';
import {
	ConflictDialog,
	ConflictInfoWithContent,
	ConfirmFullSyncDialog,
	PullRequiredDialog,
	SyncProgressDialog,
	ModifiedFilesNoticeDialog,
	ModifiedDeleteInfo,
	SyncCompleteDialog,
	UpdatedFileInfo,
} from './dialogs';
import { t } from './i18n';

/** Default concurrency for parallel operations */
const DEFAULT_CONCURRENCY = 5;

/**
 * Process items in parallel with a concurrency limit
 */
async function parallelProcess<T, R>(
	items: T[],
	processor: (item: T, index: number) => Promise<R>,
	concurrency: number = DEFAULT_CONCURRENCY
): Promise<R[]> {
	const results: R[] = [];
	let currentIndex = 0;

	async function processNext(): Promise<void> {
		while (currentIndex < items.length) {
			const index = currentIndex++;
			const item = items[index];
			results[index] = await processor(item, index);
		}
	}

	const workers = Array(Math.min(concurrency, items.length))
		.fill(null)
		.map(() => processNext());

	await Promise.all(workers);
	return results;
}

export class SyncEngine {
	private app: App;
	private vault: Vault;
	private settings: DriveSettings;
	private getSettings: () => DriveSettings;
	private saveSettings: () => Promise<void>;
	private ensureValidToken: () => Promise<boolean>;

	constructor(
		app: App,
		getSettings: () => DriveSettings,
		saveSettings: () => Promise<void>,
		ensureValidToken: () => Promise<boolean>
	) {
		this.app = app;
		this.vault = app.vault;
		this.getSettings = getSettings;
		this.saveSettings = saveSettings;
		this.ensureValidToken = ensureValidToken;
		this.settings = getSettings();
	}

	private refreshSettings() {
		this.settings = this.getSettings();
	}

	/**
	 * Refresh files list from GDrive
	 */
	async refreshFilesList(): Promise<DriveFileInfo[]> {
		// Ensure token is valid before API call
		const tokenValid = await this.ensureValidToken();
		if (!tokenValid) {
			throw new Error('Failed to refresh access token');
		}
		this.refreshSettings();
		const filesList = await getFilesList(
			this.settings.accessToken,
			this.settings.vaultId
		);
		// Update settings with new list
		(this.settings as any).filesList = filesList;
		await this.saveSettings();
		return filesList;
	}

	/**
	 * Compare local and remote states to find differences
	 */
	async computeDiff(
		localMeta: SyncMeta | null,
		remoteMeta: SyncMeta | null,
		filesList: DriveFileInfo[]
	): Promise<SyncDiff> {
		this.refreshSettings();
		const diff: SyncDiff = {
			toUpload: [],
			toDownload: [],
			conflicts: [],
			deletedLocally: [],
			deletedRemotely: [],
		};

		// Get current local files
		const localFiles = this.vault.getFiles();
		const localFilePaths = new Set(
			localFiles
				.filter(f => !shouldExclude(f.path, this.settings.excludePatterns))
				.filter(f => f.path !== META_FILE_NAME_LOCAL)
				.map(f => f.path)
		);

		// Get remote files (excluding meta file)
		const remoteFilePaths = new Set(
			filesList
				.filter(f => f.name !== META_FILE_NAME_REMOTE)
				.filter(f => !shouldExclude(f.name, this.settings.excludePatterns))
				.map(f => f.name)
		);

		// Build current local meta for comparison
		const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);

		// Compare files
		for (const path of localFilePaths) {
			if (!remoteFilePaths.has(path)) {
				// File exists locally but not remotely
				if (remoteMeta && remoteMeta.files[path]) {
					// Was tracked before - deleted remotely
					diff.deletedRemotely.push(path);
				} else {
					// New local file
					diff.toUpload.push(path);
				}
			} else {
				// File exists both locally and remotely
				const localFileInfo = currentLocalMeta.files[path];
				const remoteFileInfo = remoteMeta?.files[path];
				const localMetaInfo = localMeta?.files[path];

				if (!localFileInfo) continue;

				// Check if file changed
				if (remoteFileInfo) {
					const localChanged = !localMetaInfo || localFileInfo.hash !== localMetaInfo.hash;
					const remoteChanged = localMetaInfo && remoteFileInfo.hash !== localMetaInfo.hash;

					if (localChanged && remoteChanged) {
						// Both changed - conflict
						diff.conflicts.push({
							path,
							localModifiedTime: localFileInfo.modifiedTime,
							remoteModifiedTime: remoteFileInfo.modifiedTime,
							localHash: localFileInfo.hash,
							remoteHash: remoteFileInfo.hash,
						});
					} else if (localChanged) {
						// Only local changed
						diff.toUpload.push(path);
					} else if (remoteChanged) {
						// Only remote changed
						diff.toDownload.push(path);
					}
				} else {
					// Remote file exists but not in meta - new remote file
					// but we also have it locally - check hashes
					const driveFile = filesList.find(f => f.name === path);
					if (driveFile) {
						// Download and compare
						diff.toDownload.push(path);
					}
				}
			}
		}

		// Check for files that exist remotely but not locally
		for (const path of remoteFilePaths) {
			if (!localFilePaths.has(path)) {
				if (localMeta && localMeta.files[path]) {
					// Was tracked before - deleted locally
					diff.deletedLocally.push(path);
				} else {
					// New remote file
					diff.toDownload.push(path);
				}
			}
		}

		return diff;
	}

	/**
	 * Push local changes to GDrive (Button 1: Update/Push)
	 */
	async pushChanges(): Promise<void> {
		this.refreshSettings();
		new Notice(t('checkingChanges'));

		try {
			const filesList = await this.refreshFilesList();
			const localMeta = await readLocalMeta(this.vault);
			const remoteMeta = await readRemoteMeta(
				this.settings.accessToken,
				this.settings.vaultId,
				filesList
			);

			// Case: No remote meta - full upload
			if (!remoteMeta) {
				new Notice(t('noRemoteData'));
				await this.pushAll(true);
				return;
			}

			// Case: No local meta but remote exists - require Pull first
			if (!localMeta) {
				new Notice(t('pullRequiredBeforePush'));
				return;
			}

			// Both metas exist - check if remote is newer
			if (remoteMeta.lastUpdatedAt > localMeta.lastUpdatedAt) {
				// Remote is newer - require Pull first
				new PullRequiredDialog(
					this.app,
					async () => {
						await this.pullChanges();
					},
					() => {
						new Notice(t('pushCancelled'));
					}
				).open();
				return;
			}

			// Compute diff for push
			const diff = await this.computeDiff(localMeta, remoteMeta, filesList);

			if (diff.conflicts.length > 0) {
				// Has conflicts - load content for markdown files
				const conflictsWithContent: ConflictInfoWithContent[] = await Promise.all(
					diff.conflicts.map(async (conflict) => {
						const result: ConflictInfoWithContent = { ...conflict };
						if (conflict.path.endsWith('.md')) {
							result.localContent = await this.readFileAsText(conflict.path);
							const driveFile = filesList.find(f => f.name === conflict.path);
							if (driveFile) {
								result.remoteContent = await this.downloadFileAsText(driveFile.id);
							}
						}
						return result;
					})
				);

				new ConflictDialog(
					this.app,
					conflictsWithContent,
					async (resolutions) => {
						const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);
						await this.handleConflictsAndPush(resolutions, currentLocalMeta, remoteMeta, filesList);
					},
					() => {
						new Notice(t('pushCancelled'));
					},
					this.settings.conflictFolder
				).open();
				return;
			}

			// Perform push
			const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);
			await this.performPush(currentLocalMeta, remoteMeta, filesList, {});

		} catch (err) {
			console.error('Push failed:', err);
			new Notice(t('pushFailed'));
		}
	}

	private async handleConflictsAndPush(
		resolutions: ConflictResolutions,
		localMeta: SyncMeta,
		remoteMeta: SyncMeta,
		filesList: DriveFileInfo[]
	): Promise<void> {
		// Handle conflict resolutions
		for (const [path, resolution] of Object.entries(resolutions)) {
			if (resolution === 'remote') {
				// User chose remote: save local to conflict folder, then download remote
				const file = this.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const buffer = await this.vault.readBinary(file);
					const conflictPath = generateConflictFilename(path, this.settings.conflictFolder);
					await this.createFileWithPath(conflictPath, buffer);
				}

				// Download remote version
				const driveFile = filesList.find(f => f.name === path);
				if (driveFile) {
					const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
					const file = this.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						await this.vault.modifyBinary(file, buffer);
					}
				}
			} else {
				// User chose local: save remote to conflict folder
				const driveFile = filesList.find(f => f.name === path);
				if (driveFile) {
					const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
					const conflictPath = generateConflictFilename(path, this.settings.conflictFolder);
					await this.createFileWithPath(conflictPath, buffer);
				}
			}
		}

		// Rebuild local meta after handling conflicts
		const updatedLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);
		await this.performPush(updatedLocalMeta, remoteMeta, filesList, resolutions);
	}

	private async performPush(
		localMeta: SyncMeta,
		remoteMeta: SyncMeta | null,
		filesList: DriveFileInfo[],
		resolutions: ConflictResolutions
	): Promise<void> {
		this.refreshSettings();
		const progress = new SyncProgressDialog(this.app, 'Pushing Changes...');
		progress.open();

		try {
			const toUpload: string[] = [];
			const updatedFiles: UpdatedFileInfo[] = [];

			// Determine what to upload
			for (const [path, localInfo] of Object.entries(localMeta.files)) {
				const remoteInfo = remoteMeta?.files[path];
				const driveFile = filesList.find(f => f.name === path);

				if (!driveFile) {
					// New file
					toUpload.push(path);
				} else if (!remoteInfo || localInfo.hash !== remoteInfo.hash) {
					// Changed file (skip if resolution was 'remote')
					if (resolutions[path] !== 'remote') {
						toUpload.push(path);
					}
				}
			}

			progress.setTotal(toUpload.length);

			let completed = 0;

			// Upload files in parallel
			await parallelProcess(toUpload, async (path) => {
				const file = this.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const buffer = await this.vault.readBinary(file);
					const driveFile = filesList.find(f => f.name === path);

					if (driveFile) {
						await modifyFile(this.settings.accessToken, driveFile.id, buffer);
					} else {
						await uploadFile(
							this.settings.accessToken,
							path,
							buffer,
							this.settings.vaultId
						);
					}

					updatedFiles.push({
						path,
						modifiedTime: new Date(file.stat.mtime).toISOString(),
					});
				}

				completed++;
				progress.setProgress(completed, `Uploading: ${path}`);
			});

			// Update meta files only if there were changes
			if (toUpload.length > 0) {
				const now = new Date().toISOString();
				localMeta.lastSyncTimestamp = now;
				localMeta.lastUpdatedAt = now;

				await writeLocalMeta(this.vault, localMeta);

				const newFilesList = await this.refreshFilesList();
				await writeRemoteMeta(
					this.settings.accessToken,
					this.settings.vaultId,
					localMeta,
					newFilesList
				);
			}

			progress.complete(`Pushed ${toUpload.length} files.`);

			setTimeout(() => {
				progress.close();
				new SyncCompleteDialog(
					this.app,
					t('uploadComplete'),
					`${t('updatedFiles')}: ${updatedFiles.length}`,
					updatedFiles
				).open();
			}, 1500);

		} catch (err) {
			progress.close();
			throw err;
		}
	}

	/**
	 * Pull remote changes to local (Button 2: Download/Pull)
	 */
	async pullChanges(): Promise<void> {
		this.refreshSettings();
		new Notice(t('checkingChanges'));

		try {
			const filesList = await this.refreshFilesList();
			const localMeta = await readLocalMeta(this.vault);
			const remoteMeta = await readRemoteMeta(
				this.settings.accessToken,
				this.settings.vaultId,
				filesList
			);

			// Case: No remote meta - nothing to pull
			if (!remoteMeta) {
				new Notice(t('noRemoteDataPull'));
				return;
			}

			// Case: No local meta - remote is authoritative, but check if local is newer
			if (!localMeta) {
				const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);

				// Find conflicts only when local file is newer than remote
				const conflicts: ConflictInfoWithContent[] = [];
				for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
					const localInfo = currentLocalMeta.files[path];
					if (localInfo && localInfo.hash !== remoteInfo.hash) {
						// Only conflict if local is newer than remote
						if (new Date(localInfo.modifiedTime) > new Date(remoteInfo.modifiedTime)) {
							const conflict: ConflictInfoWithContent = {
								path,
								localModifiedTime: localInfo.modifiedTime,
								remoteModifiedTime: remoteInfo.modifiedTime,
								localHash: localInfo.hash,
								remoteHash: remoteInfo.hash,
							};

							// Load content for markdown files (for diff display)
							if (path.endsWith('.md')) {
								conflict.localContent = await this.readFileAsText(path);
								const driveFile = filesList.find(f => f.name === path);
								if (driveFile) {
									conflict.remoteContent = await this.downloadFileAsText(driveFile.id);
								}
							}

							conflicts.push(conflict);
						}
					}
				}

				if (conflicts.length > 0) {
					new ConflictDialog(
						this.app,
						conflicts,
						async (resolutions) => {
							await this.performPull(remoteMeta, filesList, resolutions, currentLocalMeta);
						},
						() => {
							new Notice(t('pullCancelled'));
						},
						this.settings.conflictFolder
					).open();
					return;
				}

				// No conflicts - just pull
				await this.performPull(remoteMeta, filesList, {}, currentLocalMeta);
				return;
			}

			// Both metas exist - compute diff
			const diff = await this.computeDiff(localMeta, remoteMeta, filesList);

			// Check for A | - | B conflicts (local modified, remote deleted)
			const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);
			const remoteDeletedConflicts: ConflictInfoWithContent[] = [];

			for (const [path, localMetaInfo] of Object.entries(localMeta.files)) {
				if (shouldExclude(path, this.settings.excludePatterns)) continue;
				if (remoteMeta.files[path]) continue; // File exists in remote meta

				// File is in local meta but not in remote meta (remote deleted)
				const actualLocalInfo = currentLocalMeta.files[path];
				if (actualLocalInfo && actualLocalInfo.hash !== localMetaInfo.hash) {
					// A | - | B: Local was modified after last sync, but remote deleted
					const conflict: ConflictInfoWithContent = {
						path,
						localModifiedTime: actualLocalInfo.modifiedTime,
						remoteModifiedTime: localMeta.lastUpdatedAt, // Use last sync time as deletion time
						localHash: actualLocalInfo.hash,
						remoteHash: '',
						remoteDeleted: true,
					};

					// Load content for markdown files (only local, remote was deleted)
					if (path.endsWith('.md')) {
						conflict.localContent = await this.readFileAsText(path);
					}

					remoteDeletedConflicts.push(conflict);
				}
			}

			// Combine all conflicts
			const allConflicts: ConflictInfoWithContent[] = [...remoteDeletedConflicts];

			// Add regular conflicts from diff (load content for markdown files)
			if (diff.conflicts.length > 0) {
				const regularConflicts = await Promise.all(
					diff.conflicts.map(async (conflict) => {
						const result: ConflictInfoWithContent = { ...conflict };
						if (conflict.path.endsWith('.md')) {
							result.localContent = await this.readFileAsText(conflict.path);
							const driveFile = filesList.find(f => f.name === conflict.path);
							if (driveFile) {
								result.remoteContent = await this.downloadFileAsText(driveFile.id);
							}
						}
						return result;
					})
				);
				allConflicts.push(...regularConflicts);
			}

			// Check for conflicts
			if (allConflicts.length > 0) {
				new ConflictDialog(
					this.app,
					allConflicts,
					async (resolutions) => {
						await this.performPull(remoteMeta, filesList, resolutions, currentLocalMeta);
					},
					() => {
						new Notice(t('pullCancelled'));
					},
					this.settings.conflictFolder
				).open();
				return;
			}

			// Check if local is same or newer - nothing to pull
			if (localMeta.lastUpdatedAt >= remoteMeta.lastUpdatedAt && diff.toDownload.length === 0) {
				new Notice(t('alreadyUpToDate'));
				return;
			}

			await this.performPull(remoteMeta, filesList, {}, currentLocalMeta);

		} catch (err) {
			console.error('Pull failed:', err);
			new Notice(t('pullFailed'));
		}
	}

	private async performPull(
		remoteMeta: SyncMeta,
		filesList: DriveFileInfo[],
		resolutions: ConflictResolutions,
		currentLocalMeta?: SyncMeta
	): Promise<void> {
		this.refreshSettings();
		const localMeta = await readLocalMeta(this.vault);
		// Use provided currentLocalMeta or build it (for backward compatibility)
		const actualLocalMeta = currentLocalMeta || await buildMetaFromVault(this.vault, this.settings.excludePatterns);

		const progress = new SyncProgressDialog(this.app, 'Pulling Changes...');
		progress.open();

		try {
			const toDownload: string[] = [];
			const toDelete: string[] = [];
			const updatedFiles: UpdatedFileInfo[] = [];

			// Determine what to download
			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				if (shouldExclude(path, this.settings.excludePatterns)) continue;

				const localMetaInfo = localMeta?.files[path];
				const actualLocalInfo = actualLocalMeta.files[path];
				const resolution = resolutions[path];

				if (!actualLocalInfo) {
					if (!localMetaInfo) {
						// New remote file (doesn't exist locally and wasn't tracked before)
						toDownload.push(path);
					} else if (localMetaInfo.hash !== remoteInfo.hash) {
						// File was deleted locally but remote has newer version - download
						toDownload.push(path);
					}
					// else: File was deleted locally and remote unchanged - skip
					// The deletion will propagate to remote on next Push
				} else if (!localMetaInfo) {
					// File exists locally but not in local meta (new local file)
					// Check if it conflicts with remote
					if (actualLocalInfo.hash !== remoteInfo.hash) {
						// Local file differs from remote - conflict
						if (resolution === 'local') {
							// Keep local: save remote to conflict folder
							const driveFile = filesList.find(f => f.name === path);
							if (driveFile) {
								const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
								const conflictPath = generateConflictFilename(path, this.settings.conflictFolder);
								await this.createFileWithPath(conflictPath, buffer);
							}
							continue;
						} else {
							// Keep remote: save local to conflict folder, then download
							const file = this.vault.getAbstractFileByPath(path);
							if (file instanceof TFile) {
								const buffer = await this.vault.readBinary(file);
								const conflictPath = generateConflictFilename(path, this.settings.conflictFolder);
								await this.createFileWithPath(conflictPath, buffer);
							}
							toDownload.push(path);
						}
					}
					// If hashes match, skip (same content)
				} else if (localMetaInfo.hash !== remoteInfo.hash) {
					// Remote changed since last sync
					if (localMetaInfo.hash === actualLocalInfo.hash) {
						// Local file unchanged - safe to overwrite
						toDownload.push(path);
					} else {
						// Local file also changed - conflict
						if (resolution === 'local') {
							// Keep local: save remote to conflict folder
							const driveFile = filesList.find(f => f.name === path);
							if (driveFile) {
								const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
								const conflictPath = generateConflictFilename(path, this.settings.conflictFolder);
								await this.createFileWithPath(conflictPath, buffer);
							}
							continue;
						} else {
							// Keep remote: save local to conflict folder, then download
							const file = this.vault.getAbstractFileByPath(path);
							if (file instanceof TFile) {
								const buffer = await this.vault.readBinary(file);
								const conflictPath = generateConflictFilename(path, this.settings.conflictFolder);
								await this.createFileWithPath(conflictPath, buffer);
							}
							toDownload.push(path);
						}
					}
				}
				// If localMeta.hash == remoteMeta.hash, skip (no remote changes)
			}

			// Determine what to delete locally (was in local meta but not in remote meta)
			const modifiedDeletes: ModifiedDeleteInfo[] = [];
			const keptLocalFiles: string[] = []; // Files kept due to A | - | B conflict resolution
			if (localMeta) {
				for (const path of Object.keys(localMeta.files)) {
					if (!remoteMeta.files[path] && !shouldExclude(path, this.settings.excludePatterns)) {
						const file = this.vault.getAbstractFileByPath(path);
						if (file instanceof TFile) {
							// Check for A | - | B conflict resolution
							const resolution = resolutions[path];

							// Check if file was modified after last sync (using hash comparison for consistency)
							const actualInfo = actualLocalMeta.files[path];
							const localMetaInfo = localMeta.files[path];
							const isModified = actualInfo && localMetaInfo && actualInfo.hash !== localMetaInfo.hash;

							if (isModified && resolution === 'local') {
								// User chose to keep local - don't delete, will be uploaded on next Push
								keptLocalFiles.push(path);
								continue;
							}

							if (isModified && resolution !== 'remote') {
								// Modified but no resolution yet (shouldn't happen if conflict was detected)
								// Save to backup folder just in case
								modifiedDeletes.push({
									path,
									modifiedTime: actualInfo?.modifiedTime || new Date(file.stat.mtime).toISOString(),
								});
							}

							// If resolution is 'remote' or file wasn't modified, delete it
							toDelete.push(path);
						}
					}
				}
			}

			// If there are modified files to delete without resolution, show notice dialog first
			if (modifiedDeletes.length > 0) {
				progress.close();
				await new Promise<void>((resolve) => {
					new ModifiedFilesNoticeDialog(
						this.app,
						modifiedDeletes,
						resolve,
						this.settings.conflictFolder
					).open();
				});
				// Reopen progress dialog
				progress.open();
			}

			const total = toDownload.length + toDelete.length;
			progress.setTotal(total);

			let completed = 0;

			// Download files in parallel
			await parallelProcess(toDownload, async (path) => {
				const driveFile = filesList.find(f => f.name === path);
				if (driveFile) {
					const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
					await this.createFileWithPath(path, buffer);

					// Track downloaded file with remote modification time
					const remoteInfo = remoteMeta.files[path];
					updatedFiles.push({
						path,
						modifiedTime: remoteInfo?.modifiedTime || new Date().toISOString(),
					});
				}

				completed++;
				progress.setProgress(completed, `Downloading: ${path}`);
			});

			// Save modified files to conflict folder before deleting
			// Track successful backups to ensure we don't delete without backup
			const successfulBackups = new Set<string>();
			for (const info of modifiedDeletes) {
				const file = this.vault.getAbstractFileByPath(info.path);
				if (file instanceof TFile) {
					const buffer = await this.vault.readBinary(file);
					const conflictPath = generateConflictFilename(info.path, this.settings.conflictFolder);
					try {
						await this.createFileWithPath(conflictPath, buffer);
						successfulBackups.add(info.path);
					} catch (err) {
						console.error(`Failed to backup file before deletion: ${info.path}`, err);
						// Don't add to successfulBackups - file won't be deleted
					}
				}
			}

			// Delete local files (sequential to avoid conflicts)
			const actuallyDeleted: string[] = [];
			for (const path of toDelete) {
				// Skip deletion if backup was required but failed
				const needsBackup = modifiedDeletes.some(d => d.path === path);
				if (needsBackup && !successfulBackups.has(path)) {
					console.warn(`Skipping deletion of ${path}: backup failed`);
					continue;
				}

				const file = this.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await this.vault.trash(file, false);
					actuallyDeleted.push(path);
				}

				completed++;
				progress.setProgress(completed, `Deleting: ${path}`);
			}

			// Delete empty parent directories after file deletions
			if (actuallyDeleted.length > 0) {
				await this.deleteEmptyParentDirectories(actuallyDeleted);
			}

			// Update local meta to match remote
			const newLocalMeta = { ...remoteMeta };
			newLocalMeta.files = { ...remoteMeta.files };
			newLocalMeta.lastSyncTimestamp = new Date().toISOString();

			// Rebuild file hashes for downloaded files
			for (const path of toDownload) {
				const metadata = await buildFileMetadata(this.vault, path);
				if (metadata) {
					newLocalMeta.files[path] = metadata;
				}
			}

			// Add back files that user chose to keep (A | - | B conflict with 'local' resolution)
			for (const path of keptLocalFiles) {
				const metadata = await buildFileMetadata(this.vault, path);
				if (metadata) {
					newLocalMeta.files[path] = metadata;
				}
			}

			await writeLocalMeta(this.vault, newLocalMeta);

			progress.complete(`Downloaded ${toDownload.length} files, deleted ${toDelete.length} files.`);

			setTimeout(() => {
				progress.close();
				new SyncCompleteDialog(
					this.app,
					t('downloadComplete'),
					`${t('updatedFiles')}: ${updatedFiles.length}`,
					updatedFiles
				).open();
			}, 1500);

		} catch (err) {
			progress.close();
			throw err;
		}
	}

	/**
	 * Push entire vault to GDrive (Button 3: Full Push)
	 */
	async pushAll(skipConfirmation = false): Promise<void> {
		this.refreshSettings();

		const doPush = async () => {
			const progress = new SyncProgressDialog(this.app, 'Full Push...');
			progress.open();

			try {
				const meta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);
				const files = this.vault.getFiles().filter(
					f => !shouldExclude(f.path, this.settings.excludePatterns) &&
						f.path !== META_FILE_NAME_LOCAL &&
						f.path !== META_FILE_NAME_REMOTE
				);

				progress.setTotal(files.length);

				// Get current file list and remote meta for version
				const filesList = await this.refreshFilesList();
				const remoteMeta = await readRemoteMeta(
					this.settings.accessToken,
					this.settings.vaultId,
					filesList
				);

				let completed = 0;
				let skipped = 0;
				const updatedFiles: UpdatedFileInfo[] = [];

				// Upload files in parallel, skipping files with matching hash
				// If hash differs, rename remote file to make it untracked before uploading
				await parallelProcess(files, async (file) => {
					const buffer = await this.vault.readBinary(file);
					const driveFile = filesList.find(f => f.name === file.path);

					if (driveFile && remoteMeta?.files[file.path]) {
						const localHash = await calculateHash(buffer);
						const remoteHash = remoteMeta.files[file.path].hash;

						if (localHash === remoteHash) {
							// Same hash - skip upload
							skipped++;
							completed++;
							progress.setProgress(completed, `Skipped (same): ${file.path}`);
							return;
						}

						// Different hash - rename remote file to make it untracked
						const untrackedName = generateUntrackedFilename(file.path);
						await renameFile(this.settings.accessToken, driveFile.id, untrackedName);
					}

					// Upload new file (always create new since we renamed the old one)
					await uploadFile(
						this.settings.accessToken,
						file.path,
						buffer,
						this.settings.vaultId
					);

					updatedFiles.push({
						path: file.path,
						modifiedTime: new Date(file.stat.mtime).toISOString(),
					});

					completed++;
					progress.setProgress(completed, `Uploaded: ${file.path}`);
				});

				// Update meta files - always update timestamp for full push
				const now = new Date().toISOString();
				meta.lastSyncTimestamp = now;
				meta.lastUpdatedAt = now;

				await writeLocalMeta(this.vault, meta);

				const newFilesList = await this.refreshFilesList();
				await writeRemoteMeta(
					this.settings.accessToken,
					this.settings.vaultId,
					meta,
					newFilesList
				);

				progress.close();

				// Show completion dialog with file list
				const uploaded = files.length - skipped;
				new SyncCompleteDialog(
					this.app,
					t('uploadComplete'),
					`${uploaded} ${t('updatedFiles').toLowerCase()}`,
					updatedFiles,
					skipped
				).open();

			} catch (err) {
				progress.close();
				console.error('Full push failed:', err);
				new Notice(t('fullPushFailed'));
			}
		};

		if (skipConfirmation) {
			await doPush();
		} else {
			new ConfirmFullSyncDialog(
				this.app,
				'Full Push to Google Drive',
				'This will upload all local files to Google Drive, overwriting any existing remote versions. Continue?',
				'Push All',
				doPush,
				() => new Notice(t('fullPushCancelled'))
			).open();
		}
	}

	/**
	 * Pull entire vault from GDrive (Button 4: Full Pull)
	 */
	async pullAll(): Promise<void> {
		this.refreshSettings();

		new ConfirmFullSyncDialog(
			this.app,
			'Full Pull from Google Drive',
			'This will download all files from Google Drive, overwriting any existing local versions. Continue?',
			'Pull All',
			async () => {
				const progress = new SyncProgressDialog(this.app, 'Full Pull...');
				progress.open();

				try {
					const filesList = await this.refreshFilesList();
					const remoteMeta = await readRemoteMeta(
						this.settings.accessToken,
						this.settings.vaultId,
						filesList
					);

					if (!remoteMeta) {
						progress.close();
						new Notice(t('noRemoteDataPull'));
						return;
					}

					const remoteFiles = filesList.filter(
						f => f.name !== META_FILE_NAME_REMOTE &&
							!shouldExclude(f.name, this.settings.excludePatterns)
					);

					progress.setTotal(remoteFiles.length);

					let completed = 0;
					let skipped = 0;
					const updatedFiles: UpdatedFileInfo[] = [];

					// Download files in parallel, skipping files with matching hash
					// If hash differs, save local to conflict folder before downloading
					await parallelProcess(remoteFiles, async (driveFile) => {
						// Check if local file exists
						const localFile = this.vault.getAbstractFileByPath(driveFile.name);
						if (localFile instanceof TFile && remoteMeta.files[driveFile.name]) {
							const localBuffer = await this.vault.readBinary(localFile);
							const localHash = await calculateHash(localBuffer);
							const remoteHash = remoteMeta.files[driveFile.name].hash;

							if (localHash === remoteHash) {
								// Same hash - skip download
								skipped++;
								completed++;
								progress.setProgress(completed, `Skipped (same): ${driveFile.name}`);
								return;
							}

							// Different hash - save local to conflict folder before overwriting
							const conflictPath = generateConflictFilename(driveFile.name, this.settings.conflictFolder);
							await this.createFileWithPath(conflictPath, localBuffer);
						}

						const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
						await this.createFileWithPath(driveFile.name, buffer);

						// Use remote meta's modified time or drive file's modified time
						const modifiedTime = remoteMeta.files[driveFile.name]?.modifiedTime || driveFile.modifiedTime;
						updatedFiles.push({
							path: driveFile.name,
							modifiedTime,
						});

						completed++;
						progress.setProgress(completed, `Downloaded: ${driveFile.name}`);
					});

					// Update local meta
					const newLocalMeta = { ...remoteMeta };
					newLocalMeta.lastSyncTimestamp = new Date().toISOString();
					await writeLocalMeta(this.vault, newLocalMeta);

					progress.close();

					// Show completion dialog with file list
					const downloaded = remoteFiles.length - skipped;
					new SyncCompleteDialog(
						this.app,
						t('downloadComplete'),
						`${downloaded} ${t('updatedFiles').toLowerCase()}`,
						updatedFiles,
						skipped
					).open();

				} catch (err) {
					progress.close();
					console.error('Full pull failed:', err);
					new Notice(t('fullPullFailed'));
				}
			},
			() => new Notice(t('fullPullCancelled'))
		).open();
	}

	/**
	 * Create or update a file at the given path, creating folders as needed
	 */
	private async createFileWithPath(path: string, content: ArrayBuffer): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			await this.vault.modifyBinary(file, content);
		} else {
			// Create parent folders if needed
			const parts = path.split('/');
			if (parts.length > 1) {
				const folderPath = parts.slice(0, -1).join('/');
				try {
					await this.vault.createFolder(folderPath);
				} catch (err) {
					// Folder might already exist
					if (!err.message?.includes('exist')) {
						throw err;
					}
				}
			}
			try {
				await this.vault.createBinary(path, content);
			} catch (err: any) {
				// File might have been created by another parallel operation
				if (err?.message?.includes('exist')) {
					const existingFile = this.vault.getAbstractFileByPath(path);
					if (existingFile instanceof TFile) {
						await this.vault.modifyBinary(existingFile, content);
					} else {
						// Fallback to adapter if TFile not found
						await this.vault.adapter.writeBinary(path, content);
					}
				} else {
					throw err;
				}
			}
		}
	}

	/**
	 * Read a local file as text
	 */
	private async readFileAsText(path: string): Promise<string | undefined> {
		try {
			const file = this.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return await this.vault.read(file);
			}
		} catch (err) {
			console.error(`Failed to read file as text: ${path}`, err);
		}
		return undefined;
	}

	/**
	 * Download a file from Google Drive as text
	 */
	private async downloadFileAsText(fileId: string): Promise<string | undefined> {
		try {
			const [, buffer] = await getFile(this.settings.accessToken, fileId);
			const decoder = new TextDecoder();
			return decoder.decode(buffer);
		} catch (err) {
			console.error(`Failed to download file as text: ${fileId}`, err);
		}
		return undefined;
	}

	/**
	 * Get untracked files (files on Google Drive not tracked in meta)
	 */
	async getUntrackedFiles(): Promise<DriveFileInfo[]> {
		this.refreshSettings();
		const filesList = await this.refreshFilesList();
		const remoteMeta = await readRemoteMeta(
			this.settings.accessToken,
			this.settings.vaultId,
			filesList
		);

		const untrackedFiles: DriveFileInfo[] = [];

		for (const driveFile of filesList) {
			// Skip meta file
			if (driveFile.name === META_FILE_NAME_REMOTE) {
				continue;
			}

			// Check if file is tracked in remoteMeta
			if (!remoteMeta?.files[driveFile.name]) {
				untrackedFiles.push(driveFile);
			}
		}

		return untrackedFiles;
	}

	/**
	 * Delete untracked files from Google Drive
	 */
	async deleteUntrackedFiles(fileIds: string[]): Promise<number> {
		this.refreshSettings();
		let deleted = 0;

		for (const fileId of fileIds) {
			try {
				await deleteFile(this.settings.accessToken, fileId);
				deleted++;
			} catch (err) {
				console.error(`Failed to delete untracked file: ${fileId}`, err);
			}
		}

		return deleted;
	}

	/**
	 * Restore untracked files from Google Drive to local vault
	 */
	async restoreUntrackedFiles(files: DriveFileInfo[]): Promise<number> {
		this.refreshSettings();
		let restored = 0;

		const filesList = await this.refreshFilesList();
		const localMeta = await readLocalMeta(this.vault) || createEmptyMeta();
		const remoteMeta = await readRemoteMeta(
			this.settings.accessToken,
			this.settings.vaultId,
			filesList
		) || createEmptyMeta();

		for (const driveFile of files) {
			try {
				// Download file from Google Drive
				const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);

				// Create local file
				await this.createFileWithPath(driveFile.name, buffer);

				// Build metadata for the restored file
				const metadata = await buildFileMetadata(this.vault, driveFile.name);
				if (metadata) {
					// Add to both local and remote meta
					localMeta.files[driveFile.name] = metadata;
					remoteMeta.files[driveFile.name] = metadata;
				}

				restored++;
			} catch (err) {
				console.error(`Failed to restore untracked file: ${driveFile.name}`, err);
			}
		}

		// Update meta files if any files were restored
		if (restored > 0) {
			const now = new Date().toISOString();
			localMeta.lastSyncTimestamp = now;
			localMeta.lastUpdatedAt = now;
			remoteMeta.lastSyncTimestamp = now;
			remoteMeta.lastUpdatedAt = now;

			await writeLocalMeta(this.vault, localMeta);

			const newFilesList = await this.refreshFilesList();
			await writeRemoteMeta(
				this.settings.accessToken,
				this.settings.vaultId,
				remoteMeta,
				newFilesList
			);
		}

		return restored;
	}

	/**
	 * Upload a file to temporary storage (no meta update)
	 */
	async tempUpload(filePath: string): Promise<void> {
		this.refreshSettings();

		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const buffer = await this.vault.readBinary(file);
		const tempFileName = TEMP_SYNC_PREFIX + filePath;

		// Check if temp file already exists
		const filesList = await this.refreshFilesList();
		const existingFile = filesList.find(f => f.name === tempFileName);

		if (existingFile) {
			// Update existing temp file
			await modifyFile(this.settings.accessToken, existingFile.id, buffer);
		} else {
			// Upload new temp file
			await uploadFile(
				this.settings.accessToken,
				tempFileName,
				buffer,
				this.settings.vaultId
			);
		}
	}

	/**
	 * Download a file from temporary storage (no meta update)
	 */
	async tempDownload(filePath: string): Promise<void> {
		this.refreshSettings();

		const tempFileName = TEMP_SYNC_PREFIX + filePath;
		const filesList = await this.refreshFilesList();
		const driveFile = filesList.find(f => f.name === tempFileName);

		if (!driveFile) {
			throw new Error(`Temp file not found: ${tempFileName}`);
		}

		const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
		await this.createFileWithPath(filePath, buffer);
	}

	/**
	 * Get list of temporary files on Google Drive
	 */
	async getTempFiles(): Promise<DriveFileInfo[]> {
		this.refreshSettings();
		const filesList = await this.refreshFilesList();

		return filesList.filter(f => f.name.startsWith(TEMP_SYNC_PREFIX));
	}

	/**
	 * Delete selected temporary files from Google Drive
	 */
	async deleteTempFiles(fileIds: string[]): Promise<number> {
		this.refreshSettings();
		// Ensure token is valid before API calls
		const tokenValid = await this.ensureValidToken();
		if (!tokenValid) {
			throw new Error('Failed to refresh access token');
		}
		let deleted = 0;

		for (const fileId of fileIds) {
			try {
				await deleteFile(this.settings.accessToken, fileId);
				deleted++;
			} catch (err) {
				console.error(`Failed to delete temp file: ${fileId}`, err);
			}
		}

		return deleted;
	}

	/**
	 * Download selected temporary files to local vault
	 */
	async downloadTempFiles(fileIds: string[]): Promise<number> {
		this.refreshSettings();
		const filesList = await this.refreshFilesList();
		let downloaded = 0;

		for (const fileId of fileIds) {
			try {
				const driveFile = filesList.find(f => f.id === fileId);
				if (!driveFile) continue;

				// Remove __TEMP__/ prefix to get original path
				const originalPath = driveFile.name.replace(TEMP_SYNC_PREFIX, '');

				const [, buffer] = await getFile(this.settings.accessToken, fileId);
				await this.createFileWithPath(originalPath, buffer);
				downloaded++;
			} catch (err) {
				console.error(`Failed to download temp file: ${fileId}`, err);
			}
		}

		return downloaded;
	}

	/**
	 * Delete empty parent directories after files are deleted.
	 * Traverses up the directory tree and removes empty folders.
	 */
	private async deleteEmptyParentDirectories(deletedPaths: string[]): Promise<void> {
		// Collect all unique parent directories from deleted files
		const parentDirs = new Set<string>();
		for (const path of deletedPaths) {
			const parts = path.split('/');
			// Remove the filename, keep only directory parts
			parts.pop();
			// Add all parent directories (from deepest to root)
			while (parts.length > 0) {
				parentDirs.add(parts.join('/'));
				parts.pop();
			}
		}

		// Sort by depth (deepest first) to delete from bottom up
		const sortedDirs = Array.from(parentDirs).sort((a, b) => {
			const depthA = a.split('/').length;
			const depthB = b.split('/').length;
			return depthB - depthA;
		});

		// Delete empty directories
		for (const dirPath of sortedDirs) {
			const folder = this.vault.getAbstractFileByPath(dirPath);
			if (folder instanceof TFolder && folder.children.length === 0) {
				try {
					await this.vault.trash(folder, false);
				} catch (err) {
					console.warn(`Failed to delete empty directory: ${dirPath}`, err);
				}
			}
		}
	}
}
