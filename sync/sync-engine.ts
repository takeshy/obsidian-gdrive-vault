/**
 * Core sync engine for manual synchronization
 */

import { App, Notice, TFile, Vault } from 'obsidian';
import {
	SyncMeta,
	SyncDiff,
	ConflictInfo,
	ConflictResolutions,
	DriveFileInfo,
	DriveSettings,
	META_FILE_NAME_LOCAL,
	META_FILE_NAME_REMOTE,
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
	SyncProgressDialog,
	ModifiedFilesNoticeDialog,
	ModifiedDeleteInfo,
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

	constructor(
		app: App,
		getSettings: () => DriveSettings,
		saveSettings: () => Promise<void>
	) {
		this.app = app;
		this.vault = app.vault;
		this.getSettings = getSettings;
		this.saveSettings = saveSettings;
		this.settings = getSettings();
	}

	private refreshSettings() {
		this.settings = this.getSettings();
	}

	/**
	 * Refresh files list from GDrive
	 */
	async refreshFilesList(): Promise<DriveFileInfo[]> {
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

			// Case: No local meta - need to compare by hash and show conflicts
			if (!localMeta) {
				const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);

				// Find conflicts by comparing hashes
				const conflicts: ConflictInfoWithContent[] = [];
				for (const [path, localInfo] of Object.entries(currentLocalMeta.files)) {
					const remoteInfo = remoteMeta.files[path];
					if (remoteInfo && localInfo.hash !== remoteInfo.hash) {
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

				if (conflicts.length > 0) {
					// Show conflict dialog
					new ConflictDialog(
						this.app,
						conflicts,
						async (resolutions) => {
							await this.handleConflictsAndPush(resolutions, currentLocalMeta, remoteMeta, filesList);
						},
						() => {
							new Notice(t('pushCancelled'));
						},
						this.settings.conflictFolder
					).open();
					return;
				}

				// No conflicts - just push
				await this.performPush(currentLocalMeta, remoteMeta, filesList, {});
				return;
			}

			// Both metas exist - compute diff
			const diff = await this.computeDiff(localMeta, remoteMeta, filesList);

			if (remoteMeta.lastUpdatedAt > localMeta.lastUpdatedAt && diff.conflicts.length > 0) {
				// Remote is newer and has conflicts - load content for markdown files
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
			const toDelete: string[] = [];

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

			// Determine what to delete on remote
			if (remoteMeta) {
				for (const path of Object.keys(remoteMeta.files)) {
					if (!localMeta.files[path] && !shouldExclude(path, this.settings.excludePatterns)) {
						toDelete.push(path);
					}
				}
			}

			const total = toUpload.length + toDelete.length;
			progress.setTotal(total);

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
				}

				completed++;
				progress.setProgress(completed, `Uploading: ${path}`);
			});

			// Delete remote files in parallel
			await parallelProcess(toDelete, async (path) => {
				const driveFile = filesList.find(f => f.name === path);
				if (driveFile) {
					await deleteFile(this.settings.accessToken, driveFile.id);
				}

				completed++;
				progress.setProgress(completed, `Deleting: ${path}`);
			});

			// Update meta files only if there were changes
			const hasChanges = toUpload.length > 0 || toDelete.length > 0;

			if (hasChanges) {
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

			progress.complete(`Pushed ${toUpload.length} files, deleted ${toDelete.length} files.`);

			setTimeout(() => {
				progress.close();
				new Notice(t('pushComplete'));
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

			// Case: No local meta - download with conflict check
			if (!localMeta) {
				const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);

				// Find conflicts
				const conflicts: ConflictInfoWithContent[] = [];
				for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
					const localInfo = currentLocalMeta.files[path];
					if (localInfo && localInfo.hash !== remoteInfo.hash) {
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

				if (conflicts.length > 0) {
					new ConflictDialog(
						this.app,
						conflicts,
						async (resolutions) => {
							await this.performPull(remoteMeta, filesList, resolutions);
						},
						() => {
							new Notice(t('pullCancelled'));
						},
						this.settings.conflictFolder
					).open();
					return;
				}

				// No conflicts - just pull
				await this.performPull(remoteMeta, filesList, {});
				return;
			}

			// Both metas exist - compute diff
			const diff = await this.computeDiff(localMeta, remoteMeta, filesList);

			// Check for conflicts
			if (diff.conflicts.length > 0) {
				// Load content for markdown files
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
						await this.performPull(remoteMeta, filesList, resolutions);
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

			await this.performPull(remoteMeta, filesList, {});

		} catch (err) {
			console.error('Pull failed:', err);
			new Notice(t('pullFailed'));
		}
	}

	private async performPull(
		remoteMeta: SyncMeta,
		filesList: DriveFileInfo[],
		resolutions: ConflictResolutions
	): Promise<void> {
		this.refreshSettings();
		const localMeta = await readLocalMeta(this.vault);
		const currentLocalMeta = await buildMetaFromVault(this.vault, this.settings.excludePatterns);

		const progress = new SyncProgressDialog(this.app, 'Pulling Changes...');
		progress.open();

		try {
			const toDownload: string[] = [];
			const toDelete: string[] = [];

			// Determine what to download
			for (const [path, remoteInfo] of Object.entries(remoteMeta.files)) {
				if (shouldExclude(path, this.settings.excludePatterns)) continue;

				const localInfo = currentLocalMeta.files[path];
				const resolution = resolutions[path];

				if (!localInfo) {
					// New remote file
					toDownload.push(path);
				} else if (localInfo.hash !== remoteInfo.hash) {
					// Changed file
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
						// Default or 'remote': save local to conflict folder, then download
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

			// Determine what to delete locally (was in remote meta but no longer)
			const modifiedDeletes: ModifiedDeleteInfo[] = [];
			if (localMeta) {
				const lastUpdatedTime = new Date(localMeta.lastUpdatedAt).getTime();
				for (const path of Object.keys(localMeta.files)) {
					if (!remoteMeta.files[path] && !shouldExclude(path, this.settings.excludePatterns)) {
						const file = this.vault.getAbstractFileByPath(path);
						if (file instanceof TFile) {
							// Check if file was modified after lastUpdatedAt
							if (file.stat.mtime > lastUpdatedTime) {
								modifiedDeletes.push({
									path,
									modifiedTime: new Date(file.stat.mtime).toISOString(),
								});
							}
							toDelete.push(path);
						}
					}
				}
			}

			// If there are modified files to delete, show notice dialog first
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
				}

				completed++;
				progress.setProgress(completed, `Downloading: ${path}`);
			});

			// Save modified files to conflict folder before deleting
			for (const info of modifiedDeletes) {
				const file = this.vault.getAbstractFileByPath(info.path);
				if (file instanceof TFile) {
					const buffer = await this.vault.readBinary(file);
					const conflictPath = generateConflictFilename(info.path, this.settings.conflictFolder);
					await this.createFileWithPath(conflictPath, buffer);
				}
			}

			// Delete local files (sequential to avoid conflicts)
			for (const path of toDelete) {
				const file = this.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await this.vault.trash(file, false);
				}

				completed++;
				progress.setProgress(completed, `Deleting: ${path}`);
			}

			// Update local meta to match remote
			const newLocalMeta = { ...remoteMeta };
			newLocalMeta.lastSyncTimestamp = new Date().toISOString();

			// Rebuild file hashes for downloaded files
			for (const path of toDownload) {
				const metadata = await buildFileMetadata(this.vault, path);
				if (metadata) {
					newLocalMeta.files[path] = metadata;
				}
			}

			await writeLocalMeta(this.vault, newLocalMeta);

			progress.complete(`Downloaded ${toDownload.length} files, deleted ${toDelete.length} files.`);

			setTimeout(() => {
				progress.close();
				new Notice(t('pullComplete'));
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
						f.path !== META_FILE_NAME_LOCAL
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

				// Upload files in parallel, skipping files with matching hash
				await parallelProcess(files, async (file) => {
					const buffer = await this.vault.readBinary(file);
					const driveFile = filesList.find(f => f.name === file.path);

					// Check if remote has the same hash - skip if identical
					if (driveFile && remoteMeta?.files[file.path]) {
						const localHash = await calculateHash(buffer);
						const remoteHash = remoteMeta.files[file.path].hash;

						if (localHash === remoteHash) {
							skipped++;
							completed++;
							progress.setProgress(completed, `Skipped (same): ${file.path}`);
							return;
						}
					}

					if (driveFile) {
						await modifyFile(this.settings.accessToken, driveFile.id, buffer);
					} else {
						await uploadFile(
							this.settings.accessToken,
							file.path,
							buffer,
							this.settings.vaultId
						);
					}

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

				const uploaded = files.length - skipped;
				progress.complete(`Uploaded ${uploaded} files, skipped ${skipped} unchanged.`);

				setTimeout(() => {
					progress.close();
					new Notice(t('fullPushComplete'));
				}, 1500);

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

					// Download files in parallel, skipping files with matching hash
					await parallelProcess(remoteFiles, async (driveFile) => {
						// Check if local file exists and has the same hash
						const localFile = this.vault.getAbstractFileByPath(driveFile.name);
						if (localFile instanceof TFile && remoteMeta.files[driveFile.name]) {
							const localBuffer = await this.vault.readBinary(localFile);
							const localHash = await calculateHash(localBuffer);
							const remoteHash = remoteMeta.files[driveFile.name].hash;

							if (localHash === remoteHash) {
								skipped++;
								completed++;
								progress.setProgress(completed, `Skipped (same): ${driveFile.name}`);
								return;
							}
						}

						const [, buffer] = await getFile(this.settings.accessToken, driveFile.id);
						await this.createFileWithPath(driveFile.name, buffer);

						completed++;
						progress.setProgress(completed, `Downloaded: ${driveFile.name}`);
					});

					// Update local meta
					const newLocalMeta = { ...remoteMeta };
					newLocalMeta.lastSyncTimestamp = new Date().toISOString();
					await writeLocalMeta(this.vault, newLocalMeta);

					const downloaded = remoteFiles.length - skipped;
					progress.complete(`Downloaded ${downloaded} files, skipped ${skipped} unchanged.`);

					setTimeout(() => {
						progress.close();
						new Notice(t('fullPullComplete'));
					}, 1500);

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
}
