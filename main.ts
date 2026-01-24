import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	setIcon,
	Setting,
	FileSystemAdapter,
	TFolder,
} from "obsidian";

import axios from "axios";
import {
	deleteFile,
	getFoldersList,
	getFilesList,
	getVaultId,
	uploadFolder,
} from "./actions";
import { DriveSettings, DEFAULT_CONFLICT_FOLDER, META_FILE_NAME_REMOTE } from "./sync/types";
import { SyncEngine } from "./sync/sync-engine";
import { dialogStyles, ConfirmDialog, DeleteExcludedFilesDialog } from "./sync/dialogs";
import { t } from "./sync/i18n";
import { readLocalMeta, shouldExclude, readRemoteMeta, writeRemoteMeta } from "./sync/meta";
import { OAUTH_CONFIG } from "./config";

const ERROR_LOG_FILE_NAME = "error-log-gdrive-plugin.md";
const VERBOSE_LOG_FILE_NAME = "verbose-log-gdrive-plugin.md";

const getAccessToken = async (
	refreshToken: string,
	refreshAccessTokenURL: string,
	showError: boolean = false
) => {
	var response;
	await axios
		.post(refreshAccessTokenURL, {
			refreshToken,
		})
		.then((res) => {
			response = res.data;
		})
		.catch((err) => {
			if ((err.code = "ERR_NETWORK") && showError) {
				new Notice("Oops! Network error :(");
				new Notice("Or maybe no refresh token provided?", 5000);
				response = "network_error";
			} else {
				response = "error";
			}
		});
	return response;
};

const DEFAULT_SETTINGS: DriveSettings = {
	refreshToken: "",
	accessToken: "",
	accessTokenExpiryTime: "",
	refreshAccessTokenURL: OAUTH_CONFIG.refreshAccessTokenURL,
	fetchRefreshTokenURL: OAUTH_CONFIG.fetchRefreshTokenURL,
	validToken: false,
	vaultId: "",
	filesList: [],
	vaultInit: false,
	rootFolderId: "",
	errorLoggingToFile: false,
	verboseLoggingToFile: false,
	excludePatterns: [".obsidian/**", ".**", ".*/**", `${DEFAULT_CONFLICT_FOLDER}/**`],
	conflictFolder: DEFAULT_CONFLICT_FOLDER,
};

export default class DriveSyncPlugin extends Plugin {
	settings: DriveSettings;
	syncEngine: SyncEngine | null = null;
	statusBarItem = this.addStatusBarItem().createEl("span", "sync_icon_still");
	connectedToInternet: boolean = false;
	verboseLoggingForTheFirstTimeInThisSession: boolean = true;
	errorLoggingForTheFirstTimeInThisSession: boolean = true;
	adapter: FileSystemAdapter;
	layoutReady: boolean = false;
	styleEl: HTMLStyleElement | null = null;

	writeToErrorLogFile = async (log: Error) => {
		if (!this.app.workspace.layoutReady || !this.layoutReady) {
			return;
		}
		if (!this.settings.errorLoggingToFile) {
			return;
		}
		const { vault } = this.app;
		let errorLogFile = vault.getAbstractFileByPath(ERROR_LOG_FILE_NAME);
		console.log(log.stack, "logging");

		let content: string;

		try {
			if (errorLogFile) {
				content = !this.errorLoggingForTheFirstTimeInThisSession
					? await vault.read(errorLogFile as any)
					: "";
				await vault.modify(
					errorLogFile as any,
					`${content}\n\n${new Date().toString()}-${log.name}-${log.message}-${log.stack}`
				);
				this.errorLoggingForTheFirstTimeInThisSession = false;
			} else {
				try {
					await vault.create(
						ERROR_LOG_FILE_NAME,
						`${new Date().toString()}-${log.name}-${log.message}-${log.stack}`
					);
				} catch (err) {
					console.log("CAUGHT: ERROR for ERROR LOGS: Probably during startup");
				}
			}
		} catch (err) {
			console.log(err);
		}
	};

	writeToVerboseLogFile = async (log: string) => {
		if (!this.app.workspace.layoutReady || !this.layoutReady) {
			return;
		}
		if (!this.settings.verboseLoggingToFile) {
			return;
		}
		const { vault } = this.app;
		let verboseLogFile = vault.getAbstractFileByPath(VERBOSE_LOG_FILE_NAME);
		console.log(log);

		let content: string;

		try {
			if (verboseLogFile) {
				content = !this.verboseLoggingForTheFirstTimeInThisSession
					? await vault.read(verboseLogFile as any)
					: "";
				await vault.modify(verboseLogFile as any, `${content}\n\n${log}`);
				this.verboseLoggingForTheFirstTimeInThisSession = false;
			} else {
				try {
					await vault.create(VERBOSE_LOG_FILE_NAME, `${log}`);
				} catch (err) {
					console.log("CAUGHT: ERROR for VERBOSE LOGS: Probably during startup");
				}
			}
		} catch (err) {
			console.log(err);
		}
	};

	cleanInstall = async () => {
		try {
			await this.writeToVerboseLogFile("LOG: Entering cleanInstall");
			if (!this.settings.rootFolderId) {
				await this.writeToErrorLogFile(new Error("ERROR: Root folder does not exist"));
				new Notice("ERROR: Root folder does not exist. Please reload the plug-in.");
				new Notice("If this error persists, please check if there is a folder named 'obsidian' in your Google Drive.");
				return;
			}
			new Notice("Creating vault in Google Drive...");
			var res = await uploadFolder(
				this.settings.accessToken,
				this.app.vault.getName(),
				this.settings.rootFolderId
			);
			this.settings.vaultId = res;
			new Notice("Vault created!");

			// Use sync engine to push all files
			if (this.syncEngine) {
				await this.syncEngine.pushAll(true);
			}

			new Notice("Please reload the plug-in.", 5000);
		} catch (err) {
			new Notice("ERROR: Unable to initialize Vault in Google Drive");
			await this.writeToErrorLogFile(err);
		}
		await this.writeToVerboseLogFile("LOG: Exited cleanInstall");
	};

	initFunction = async () => {
		this.adapter = this.app.vault.adapter as FileSystemAdapter;
		this.layoutReady = true;
		await this.loadSettings();

		await this.writeToVerboseLogFile("LOG: getAccessToken");
		var res: any = await getAccessToken(
			this.settings.refreshToken,
			this.settings.refreshAccessTokenURL,
			true
		);

		var count = 0;
		while (res == "error") {
			new Notice("ERROR: Couldn't fetch accessToken. Trying again in 5 secs, please wait...");
			await this.writeToErrorLogFile(new Error("ERROR: Couldn't fetch accessToken. Trying again in 5 secs."));
			await this.writeToVerboseLogFile("LOG: failed to fetch accessToken");

			if (!this.settings.refreshToken) {
				await this.writeToVerboseLogFile("LOG: no refreshToken");
				break;
			}

			console.log("Trying to get accessToken again after 5secs...");
			let resolvePromise: Function;
			let promise = new Promise((resolve) => {
				resolvePromise = resolve;
			});
			setTimeout(() => {
				resolvePromise();
			}, 5000);
			await promise;

			await this.writeToVerboseLogFile("LOG: trying to fetch accessToken again");
			res = await getAccessToken(
				this.settings.refreshToken,
				this.settings.refreshAccessTokenURL
			);
			count++;

			if (count == 6) {
				this.settings.accessToken = "";
				this.settings.validToken = false;
				new Notice("FATAL ERROR: Connection timeout, couldn't fetch accessToken :(");
				new Notice("Check your internet connection and restart the plugin...");
				this.connectedToInternet = false;
				break;
			}
		}

		if (res == "network_error" && this.settings.vaultId) {
			this.connectedToInternet = false;
			new Notice("No internet connection detected.");
			await this.writeToVerboseLogFile("NO CONNECTION: Offline mode");
		}

		try {
			if (res != "error" && res != "network_error") {
				this.connectedToInternet = true;
				await this.writeToVerboseLogFile("LOG: received accessToken");
				this.settings.accessToken = res.access_token;
				this.settings.accessTokenExpiryTime = res.expiry_date;
				this.settings.validToken = true;

				var folders = await getFoldersList(this.settings.accessToken);
				var reqFolder = folders.filter((folder: any) => folder.name == "obsidian");

				if (reqFolder.length) {
					await this.writeToVerboseLogFile("LOG: rootFolder available");
					this.settings.rootFolderId = reqFolder[0].id;
				} else {
					await this.writeToVerboseLogFile("LOG: rootFolder unavailable, uploading");
					new Notice("Initializing required files");
					this.settings.rootFolderId = await uploadFolder(
						this.settings.accessToken,
						"obsidian"
					);
				}
				this.saveSettings();
			}
		} catch (err) {
			await this.writeToVerboseLogFile("FATAL ERROR: Could not fetch rootFolder");
			await this.writeToErrorLogFile(err);
			new Notice("FATAL ERROR: Could not fetch rootFolder");
			await this.writeToVerboseLogFile("LOG: adding settings UI");
			this.addSettingTab(new SyncSettingsTab(this.app, this));
			return;
		}

		if (this.settings.validToken) {
			try {
				await this.writeToVerboseLogFile("LOG: getting vault id");
				this.settings.vaultId = await getVaultId(
					this.settings.accessToken,
					this.app.vault.getName(),
					this.settings.rootFolderId
				);
			} catch (err) {
				await this.writeToErrorLogFile(err);
				if (this.connectedToInternet && !this.settings.vaultId) {
					new Notice("FATAL ERROR: Couldn't get VaultID from Google Drive :(");
					await this.writeToVerboseLogFile("FATAL ERROR: Couldn't get VaultID from Google Drive :(");
				}
				new Notice("Check internet connection and restart plugin.");
				await this.writeToVerboseLogFile("LOG: adding settings UI");
				this.addSettingTab(new SyncSettingsTab(this.app, this));
				return;
			}

			if (this.settings.vaultId == "NOT FOUND") {
				await this.writeToVerboseLogFile("LOG: vault not found");
				this.settings.vaultInit = false;
				new Notice(`Oops! No vaults named ${this.app.vault.getName()} found in Google Drive`);
				new Notice("Try initializing vault in Google Drive from plug-in settings :)", 5000);
			} else {
				this.settings.vaultInit = true;

				// Initialize sync engine
				this.syncEngine = new SyncEngine(
					this.app,
					() => this.settings,
					() => this.saveSettings()
				);
			}
		} else {
			new Notice("ERROR: Invalid token");
			this.writeToErrorLogFile(new Error("ERROR: Invalid token"));
		}

		await this.writeToVerboseLogFile("LOG: adding settings UI");
		this.addSettingTab(new SyncSettingsTab(this.app, this));
	};

	async onload() {
		// Add custom styles for dialogs
		this.styleEl = document.createElement('style');
		this.styleEl.textContent = dialogStyles;
		document.head.appendChild(this.styleEl);

		this.app.workspace.onLayoutReady(this.initFunction);

		// Button 1: Push Changes (Local -> GDrive)
		this.addRibbonIcon("upload-cloud", "Push Changes to GDrive", async () => {
			if (!this.connectedToInternet) {
				new Notice("ERROR: No internet connection!");
				return;
			}
			if (!this.syncEngine) {
				new Notice("Sync engine not initialized. Please reload the plugin.");
				return;
			}

			this.statusBarItem.classList.replace("sync_icon_still", "sync_icon");
			setIcon(this.statusBarItem, "sync");

			try {
				await this.syncEngine.pushChanges();
			} finally {
				this.statusBarItem.classList.replace("sync_icon", "sync_icon_still");
				setIcon(this.statusBarItem, "checkmark");
			}
		});

		// Button 2: Pull Changes (GDrive -> Local)
		this.addRibbonIcon("download-cloud", "Pull Changes from GDrive", async () => {
			if (!this.connectedToInternet) {
				new Notice("ERROR: No internet connection!");
				return;
			}
			if (!this.syncEngine) {
				new Notice("Sync engine not initialized. Please reload the plugin.");
				return;
			}

			this.statusBarItem.classList.replace("sync_icon_still", "sync_icon");
			setIcon(this.statusBarItem, "sync");

			try {
				await this.syncEngine.pullChanges();
			} finally {
				this.statusBarItem.classList.replace("sync_icon", "sync_icon_still");
				setIcon(this.statusBarItem, "checkmark");
			}
		});

		// Commands for sync operations
		this.addCommand({
			id: "push-changes",
			name: "Push changes to Google Drive",
			callback: async () => {
				if (!this.connectedToInternet) {
					new Notice("ERROR: No internet connection!");
					return;
				}
				if (this.syncEngine) {
					await this.syncEngine.pushChanges();
				}
			},
		});

		this.addCommand({
			id: "pull-changes",
			name: "Pull changes from Google Drive",
			callback: async () => {
				if (!this.connectedToInternet) {
					new Notice("ERROR: No internet connection!");
					return;
				}
				if (this.syncEngine) {
					await this.syncEngine.pullChanges();
				}
			},
		});

		this.addCommand({
			id: "full-push",
			name: "Full push to Google Drive",
			callback: async () => {
				if (!this.connectedToInternet) {
					new Notice("ERROR: No internet connection!");
					return;
				}
				if (this.syncEngine) {
					await this.syncEngine.pushAll();
				}
			},
		});

		this.addCommand({
			id: "full-pull",
			name: "Full pull from Google Drive",
			callback: async () => {
				if (!this.connectedToInternet) {
					new Notice("ERROR: No internet connection!");
					return;
				}
				if (this.syncEngine) {
					await this.syncEngine.pullAll();
				}
			},
		});
	}

	onunload() {
		if (this.styleEl) {
			this.styleEl.remove();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		let needsSave = false;

		// Migration: convert old blacklistPaths to excludePatterns
		if ((this.settings as any).blacklistPaths && !this.settings.excludePatterns?.length) {
			const oldPaths = (this.settings as any).blacklistPaths as string[];
			if (oldPaths.length > 0) {
				this.settings.excludePatterns = oldPaths.map(p => `**/${p}/**`);
			}
			delete (this.settings as any).blacklistPaths;
			needsSave = true;
		}

		// Migration: ensure conflictFolder is set
		if (!this.settings.conflictFolder) {
			this.settings.conflictFolder = DEFAULT_CONFLICT_FOLDER;
			needsSave = true;
		}

		// Migration: ensure conflict folder is in exclude patterns
		const conflictPattern = `${this.settings.conflictFolder}/**`;
		if (!this.settings.excludePatterns.includes(conflictPattern)) {
			this.settings.excludePatterns.push(conflictPattern);
			needsSave = true;
		}

		if (needsSave) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SyncSettingsTab extends PluginSettingTab {
	plugin: DriveSyncPlugin;

	constructor(app: App, plugin: DriveSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h1", {
			text: "GDrive Vault",
			cls: "main",
		});

		const sync = containerEl.createEl("div", {
			cls: "container-gdrive-plugin",
		});

		if (this.plugin.settings.validToken) {
			const sync_text = sync.createEl("div", {
				text: "Logged in",
				cls: "sync_text",
			});
			const sync_icons = sync.createDiv({ cls: "sync_icon_still" });
			setIcon(sync_icons, "checkmark");
		} else {
			const sync_link = sync.createEl("a", {
				text: "Open this link to log in",
				cls: "sync_text",
			});
			sync_link.href = this.plugin.settings.fetchRefreshTokenURL;
		}

		new Setting(containerEl)
			.setName("Enable Error logging")
			.setDesc("Error logs will appear in a .md file")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.errorLoggingToFile);
				toggle.onChange((val) => {
					this.plugin.settings.errorLoggingToFile = val;
					this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Enable Verbose logging")
			.setDesc("Verbose logs will appear in a .md file")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.verboseLoggingToFile);
				toggle.onChange((val) => {
					this.plugin.settings.verboseLoggingToFile = val;
					this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Set refresh token")
			.setDesc("Enter the refresh token you got from the link provided")
			.addText((text) =>
				text
					.setPlaceholder("Enter token")
					.setValue(this.plugin.settings.refreshToken)
					.onChange(async (value) => {
						this.plugin.settings.refreshToken = value;
					})
			)
			.addButton((button) =>
				button.setIcon("checkmark").onClick(async () => {
					await this.plugin.saveSettings();

					sync.innerHTML = "";
					const sync_text = sync.createEl("div", {
						text: "Checking...",
						cls: "sync_text",
					});
					const sync_icons = sync.createDiv({ cls: "sync_icon" });
					setIcon(sync_icons, "sync");

					var res: any = await getAccessToken(
						this.plugin.settings.refreshToken,
						this.plugin.settings.refreshAccessTokenURL
					);

					if (res != "error") {
						this.plugin.settings.accessToken = res.access_token;
						this.plugin.settings.validToken = true;
						new Notice("Logged in successfully");
						sync.innerHTML = "";
						const sync_text = sync.createEl("div", {
							text: "Logged in",
							cls: "sync_text",
						});
						const sync_icons = sync.createDiv({
							cls: "sync_icon_still",
						});
						setIcon(sync_icons, "checkmark");
						new Notice("Please reload the plug-in", 5000);
					} else {
						this.plugin.settings.accessToken = "";
						this.plugin.settings.validToken = false;
						new Notice("Log in failed");
						sync.innerHTML = "";
						const sync_link = sync.createEl("a", {
							text: "Open this link to log in",
							cls: "sync_text",
						});
						sync_link.href = this.plugin.settings.fetchRefreshTokenURL;
					}
					this.plugin.saveSettings();
				})
			);

		if (!this.plugin.settings.validToken) return;

		if (!this.plugin.settings.vaultInit) {
			new Setting(containerEl)
				.setName("Initialize vault")
				.setDesc("Create vault and sync all files to Google Drive.")
				.addButton((button) => {
					button.setButtonText("Proceed");
					button.onClick(async () => await this.plugin.cleanInstall());
				});

			new Setting(containerEl)
				.setName("Create Root Folder Forcefully")
				.setDesc("Experimental: Use this only if you get an error related to root folder.")
				.addButton((button) => {
					button.setButtonText("Proceed");
					button.onClick(async () => {
						this.plugin.settings.rootFolderId = await uploadFolder(
							this.plugin.settings.accessToken,
							"obsidian"
						);
						new Notice("Root folder created, please reload the plugin.");
						this.plugin.saveSettings();
					});
				});
			return;
		}

		new Setting(containerEl)
			.setName("Exclude patterns")
			.setDesc(
				"Glob patterns for files/folders to exclude from sync. One pattern per line. Examples: .obsidian/**, *.tmp, drafts/**"
			)
			.addTextArea((textArea) => {
				textArea
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange((value) => {
						this.plugin.settings.excludePatterns = value
							.split("\n")
							.map(p => p.trim())
							.filter(p => p.length > 0);
						this.plugin.saveSettings();
					});
				textArea.inputEl.rows = 5;
				textArea.inputEl.cols = 40;
			});

		containerEl.createEl("h3", { text: t("syncStatusTitle") });

		// Display last updated at
		const lastUpdatedSetting = new Setting(containerEl)
			.setName(t("lastUpdatedAt"))
			.setDesc(t("lastUpdatedAtDesc"));

		// Load and display the last updated at value
		readLocalMeta(this.plugin.app.vault).then((meta) => {
			const dateStr = meta?.lastUpdatedAt
				? new Date(meta.lastUpdatedAt).toLocaleString()
				: t("notSynced");
			lastUpdatedSetting.setDesc(`${t("lastUpdatedAtDesc")}: ${dateStr}`);
		});

		containerEl.createEl("h3", { text: "Conflict Resolution" });

		new Setting(containerEl)
			.setName(t("conflictFolderName"))
			.setDesc(t("conflictFolderDesc"))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.conflictFolder)
					.onChange(async (value) => {
						// Update exclude pattern with new folder name
						const oldPattern = `${this.plugin.settings.conflictFolder}/**`;
						const newPattern = `${value}/**`;
						const patterns = this.plugin.settings.excludePatterns;
						const idx = patterns.indexOf(oldPattern);
						if (idx >= 0) {
							patterns[idx] = newPattern;
						} else if (!patterns.includes(newPattern)) {
							patterns.push(newPattern);
						}
						this.plugin.settings.conflictFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("clearConflicts"))
			.setDesc(t("clearConflictsDesc"))
			.addButton((button) => {
				button.setButtonText(t("clearAll"));
				button.setWarning();
				button.onClick(async () => {
					const folder = this.plugin.app.vault.getAbstractFileByPath(
						this.plugin.settings.conflictFolder
					);
					if (folder instanceof TFolder) {
						const count = folder.children.length;
						if (count > 0) {
							new ConfirmDialog(
								this.app,
								t("confirmDelete", { count: count.toString() }),
								async () => {
									const children = [...folder.children];
									for (const file of children) {
										await this.plugin.app.vault.delete(file, true);
									}
									new Notice(t("deleted", { count: count.toString() }));
								}
							).open();
						} else {
							new Notice(t("noConflicts"));
						}
					} else {
						new Notice(t("folderNotExist"));
					}
				});
			});

		// Remote excluded files management section
		containerEl.createEl("h3", { text: t("remoteExcludedFilesTitle") });

		const excludedFilesContainer = containerEl.createDiv({ cls: "excluded-files-container" });
		excludedFilesContainer.createEl("p", {
			text: t("remoteExcludedFilesDesc"),
			cls: "setting-item-description"
		});

		const excludedFilesList = excludedFilesContainer.createDiv({ cls: "excluded-files-list" });
		const loadingEl = excludedFilesList.createEl("p", { text: t("loading") });

		// Load excluded files asynchronously
		this.loadExcludedFiles(excludedFilesList, loadingEl);

		containerEl.createEl("h3", { text: "Full Sync Operations" });

		new Setting(containerEl)
			.setName("Full Push")
			.setDesc("Upload entire vault to Google Drive (overwrites remote)")
			.addButton((button) => {
				button.setButtonText("Full Push");
				button.setWarning();
				button.onClick(async () => {
					if (this.plugin.syncEngine) {
						await this.plugin.syncEngine.pushAll();
					}
				});
			});

		new Setting(containerEl)
			.setName("Full Pull")
			.setDesc("Download entire vault from Google Drive (overwrites local)")
			.addButton((button) => {
				button.setButtonText("Full Pull");
				button.setWarning();
				button.onClick(async () => {
					if (this.plugin.syncEngine) {
						await this.plugin.syncEngine.pullAll();
					}
				});
			});
	}

	/**
	 * Load and display remote files that match exclude patterns
	 */
	private async loadExcludedFiles(container: HTMLElement, loadingEl: HTMLElement): Promise<void> {
		try {
			const filesList = await getFilesList(
				this.plugin.settings.accessToken,
				this.plugin.settings.vaultId
			);

			// Filter files that match exclude patterns (excluding meta file)
			const excludedFiles = filesList.filter(f =>
				f.name !== META_FILE_NAME_REMOTE &&
				shouldExclude(f.name, this.plugin.settings.excludePatterns)
			);

			loadingEl.remove();

			if (excludedFiles.length === 0) {
				container.createEl("p", {
					text: t("noExcludedFiles"),
					cls: "setting-item-description"
				});
				return;
			}

			// Group files by directory patterns
			const dirPatterns = this.plugin.settings.excludePatterns.filter(p => p.endsWith("**"));
			const filePatterns = this.plugin.settings.excludePatterns.filter(p => !p.endsWith("**"));

			// Extract directory prefixes from patterns (e.g., ".obsidian/**" -> ".obsidian/")
			const dirPrefixes: Map<string, { pattern: string; files: typeof excludedFiles }> = new Map();

			for (const pattern of dirPatterns) {
				// Convert pattern to prefix: ".obsidian/**" -> ".obsidian/"
				const prefix = pattern.replace(/\*\*$/, "").replace(/\/$/, "") + "/";
				// Handle patterns like ".**" -> "." (dot files/folders at root)
				const normalizedPrefix = prefix === "./" ? "." : prefix;
				dirPrefixes.set(normalizedPrefix, { pattern, files: [] });
			}

			// Categorize excluded files
			const individualFiles: typeof excludedFiles = [];

			for (const file of excludedFiles) {
				let matchedDir = false;

				for (const [prefix, data] of dirPrefixes) {
					if (prefix === "." && file.name.startsWith(".")) {
						// Special case for dot files/folders
						data.files.push(file);
						matchedDir = true;
						break;
					} else if (file.name.startsWith(prefix) || file.name === prefix.slice(0, -1)) {
						data.files.push(file);
						matchedDir = true;
						break;
					}
				}

				if (!matchedDir) {
					// Check if it matches a file pattern
					for (const pattern of filePatterns) {
						if (shouldExclude(file.name, [pattern])) {
							individualFiles.push(file);
							break;
						}
					}
				}
			}

			// Display directories
			for (const [prefix, data] of dirPrefixes) {
				if (data.files.length === 0) continue;

				const dirName = prefix === "." ? t("dotFilesAndFolders") : prefix.slice(0, -1);
				const setting = new Setting(container)
					.setName(dirName)
					.setDesc(t("filesMatching", { count: data.files.length.toString(), pattern: data.pattern }));

				setting.addButton((button) => {
					button.setButtonText(t("deleteFromRemote"));
					button.setWarning();
					button.onClick(() => {
						const fileNames = data.files.map(f => f.name);
						new DeleteExcludedFilesDialog(
							this.app,
							t("deleteExcludedTitle", { name: dirName }),
							fileNames,
							async () => {
								button.setDisabled(true);
								button.setButtonText(t("deleting"));

								try {
									for (const file of data.files) {
										await deleteFile(this.plugin.settings.accessToken, file.id);
									}

									// Update remote meta to remove deleted files
									const newFilesList = await getFilesList(
										this.plugin.settings.accessToken,
										this.plugin.settings.vaultId
									);
									const remoteMeta = await readRemoteMeta(
										this.plugin.settings.accessToken,
										this.plugin.settings.vaultId,
										newFilesList
									);
									if (remoteMeta) {
										for (const file of data.files) {
											delete remoteMeta.files[file.name];
										}
										await writeRemoteMeta(
											this.plugin.settings.accessToken,
											this.plugin.settings.vaultId,
											remoteMeta,
											newFilesList
										);
									}

									new Notice(t("deletedFiles", { count: data.files.length.toString() }));
									setting.settingEl.remove();
								} catch (err) {
									console.error("Failed to delete files:", err);
									new Notice(t("deleteFailed"));
									button.setDisabled(false);
									button.setButtonText(t("deleteFromRemote"));
								}
							},
							() => {
								// Cancel - do nothing
							}
						).open();
					});
				});
			}

			// Display individual files
			for (const file of individualFiles) {
				const setting = new Setting(container)
					.setName(file.name)
					.setDesc(t("individualFile"));

				setting.addButton((button) => {
					button.setButtonText(t("deleteFromRemote"));
					button.setWarning();
					button.onClick(() => {
						new DeleteExcludedFilesDialog(
							this.app,
							t("deleteFileTitle"),
							[file.name],
							async () => {
								button.setDisabled(true);
								button.setButtonText(t("deleting"));

								try {
									await deleteFile(this.plugin.settings.accessToken, file.id);

									// Update remote meta
									const newFilesList = await getFilesList(
										this.plugin.settings.accessToken,
										this.plugin.settings.vaultId
									);
									const remoteMeta = await readRemoteMeta(
										this.plugin.settings.accessToken,
										this.plugin.settings.vaultId,
										newFilesList
									);
									if (remoteMeta) {
										delete remoteMeta.files[file.name];
										await writeRemoteMeta(
											this.plugin.settings.accessToken,
											this.plugin.settings.vaultId,
											remoteMeta,
											newFilesList
										);
									}

									new Notice(t("deletedFile", { name: file.name }));
									setting.settingEl.remove();
								} catch (err) {
									console.error("Failed to delete file:", err);
									new Notice(t("deleteFailed"));
									button.setDisabled(false);
									button.setButtonText(t("deleteFromRemote"));
								}
							},
							() => {
								// Cancel - do nothing
							}
						).open();
					});
				});
			}

		} catch (err) {
			console.error("Failed to load excluded files:", err);
			loadingEl.textContent = t("loadFailed");
		}
	}
}
