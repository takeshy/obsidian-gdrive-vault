/**
 * Dialog components for sync operations
 */

import { App, Modal, Setting, ButtonComponent } from 'obsidian';
import { ConflictInfo, ConflictResolution, ConflictResolutions, DEFAULT_CONFLICT_FOLDER } from './types';
import { t } from './i18n';

/**
 * Format date for display
 */
function formatDate(isoString: string): string {
	const date = new Date(isoString);
	return date.toLocaleString();
}

/**
 * Diff line types for display
 */
export type DiffLineType = 'unchanged' | 'added' | 'removed';

export interface DiffLine {
	type: DiffLineType;
	content: string;
}

/**
 * Compute LCS (Longest Common Subsequence) for line-based diff
 */
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
	const m = oldLines.length;
	const n = newLines.length;
	const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	return dp;
}

/**
 * Compute line-based diff using LCS algorithm
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
	const oldLines = oldText.split('\n');
	const newLines = newText.split('\n');
	const dp = computeLCS(oldLines, newLines);

	const result: DiffLine[] = [];
	let i = oldLines.length;
	let j = newLines.length;

	// Backtrack to build diff
	const tempResult: DiffLine[] = [];

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			tempResult.push({ type: 'unchanged', content: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			tempResult.push({ type: 'added', content: newLines[j - 1] });
			j--;
		} else {
			tempResult.push({ type: 'removed', content: oldLines[i - 1] });
			i--;
		}
	}

	// Reverse to get correct order
	return tempResult.reverse();
}

/**
 * Extended conflict info with file contents for diff display
 */
export interface ConflictInfoWithContent extends ConflictInfo {
	localContent?: string;
	remoteContent?: string;
}

/**
 * Dialog for resolving file conflicts
 */
export class ConflictDialog extends Modal {
	private conflicts: ConflictInfoWithContent[];
	private resolutions: ConflictResolutions = {};
	private onSubmit: (resolutions: ConflictResolutions) => void;
	private onCancel: () => void;
	private conflictFolder: string;
	private diffStates: Map<string, boolean> = new Map();

	// Drag state
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private modalStartX = 0;
	private modalStartY = 0;

	// Resize state
	private isResizing = false;
	private resizeDirection = '';
	private resizeStartWidth = 0;
	private resizeStartHeight = 0;

	constructor(
		app: App,
		conflicts: ConflictInfoWithContent[],
		onSubmit: (resolutions: ConflictResolutions) => void,
		onCancel: () => void,
		conflictFolder: string = DEFAULT_CONFLICT_FOLDER
	) {
		super(app);
		this.conflicts = conflicts;
		this.onSubmit = onSubmit;
		this.onCancel = onCancel;
		this.conflictFolder = conflictFolder;

		// Initialize all resolutions to 'local' by default
		for (const conflict of conflicts) {
			this.resolutions[conflict.path] = 'local';
			this.diffStates.set(conflict.path, false);
		}
	}

	onOpen() {
		const { contentEl, modalEl } = this;

		// Add resizable class to modal
		modalEl.addClass('gdrive-sync-modal-resizable');

		// Add resize handles
		this.addResizeHandles(modalEl);

		// Create drag handle (title bar)
		const dragHandle = contentEl.createDiv({ cls: 'modal-drag-handle' });
		dragHandle.createEl('h2', { text: t('conflictTitle') });
		this.setupDragHandle(dragHandle, modalEl);
		contentEl.createEl('p', {
			text: t('conflictDescription'),
			cls: 'conflict-dialog-description',
		});

		// Notice about conflict folder
		const noticeEl = contentEl.createEl('p', {
			text: t('conflictSaveNotice', { folder: this.conflictFolder }),
			cls: 'conflict-save-notice',
		});

		const conflictContainer = contentEl.createDiv({ cls: 'conflict-list' });

		for (const conflict of this.conflicts) {
			this.renderConflictItem(conflictContainer, conflict);
		}

		// Action buttons
		const buttonContainer = contentEl.createDiv({ cls: 'conflict-dialog-buttons' });

		new Setting(buttonContainer)
			.addButton(btn =>
				btn
					.setButtonText(t('apply'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.resolutions);
					})
			)
			.addButton(btn =>
				btn
					.setButtonText(t('cancel'))
					.onClick(() => {
						this.close();
						this.onCancel();
					})
			);
	}

	private renderConflictItem(container: HTMLElement, conflict: ConflictInfoWithContent) {
		const item = container.createDiv({ cls: 'conflict-item' });

		item.createEl('div', {
			text: conflict.path,
			cls: 'conflict-path',
		});

		// Show description for remote deleted conflicts
		if (conflict.remoteDeleted) {
			item.createEl('div', {
				text: t('remoteDeletedConflictDesc'),
				cls: 'conflict-remote-deleted-desc',
			});
		}

		const times = item.createDiv({ cls: 'conflict-times' });
		times.createEl('div', {
			text: t('localTime', { time: formatDate(conflict.localModifiedTime) }),
			cls: 'conflict-time-local',
		});

		// Show "(deleted)" for remote if it was deleted
		if (conflict.remoteDeleted) {
			times.createEl('div', {
				text: `${t('keepRemote')}: ${t('remoteDeleted')}`,
				cls: 'conflict-time-remote conflict-remote-deleted',
			});
		} else {
			times.createEl('div', {
				text: t('remoteTime', { time: formatDate(conflict.remoteModifiedTime) }),
				cls: 'conflict-time-remote',
			});
		}

		// Diff toggle for markdown files (skip if remote was deleted)
		const isMarkdown = conflict.path.endsWith('.md');
		if (isMarkdown && !conflict.remoteDeleted && conflict.localContent !== undefined && conflict.remoteContent !== undefined) {
			const diffContainer = item.createDiv({ cls: 'conflict-diff-container' });

			const toggleBtn = diffContainer.createEl('span', {
				text: t('showDiff'),
				cls: 'conflict-diff-toggle',
			});

			const diffView = diffContainer.createDiv({ cls: 'conflict-diff-view' });
			diffView.style.display = 'none';

			toggleBtn.onclick = () => {
				const isVisible = this.diffStates.get(conflict.path) || false;
				this.diffStates.set(conflict.path, !isVisible);

				if (!isVisible) {
					// Show diff
					diffView.style.display = 'block';
					toggleBtn.textContent = t('hideDiff');

					// Render diff if not already rendered
					if (diffView.children.length === 0) {
						this.renderDiff(diffView, conflict.localContent!, conflict.remoteContent!);
					}
				} else {
					// Hide diff
					diffView.style.display = 'none';
					toggleBtn.textContent = t('showDiff');
				}
			};
		}

		const buttons = item.createDiv({ cls: 'conflict-buttons' });

		const createButton = (text: string, resolution: ConflictResolution) => {
			const btn = buttons.createEl('button', { text });
			btn.addClass('conflict-resolution-btn');
			if (this.resolutions[conflict.path] === resolution) {
				btn.addClass('is-active');
			}
			btn.onclick = () => {
				this.resolutions[conflict.path] = resolution;
				// Update button states
				buttons.querySelectorAll('.conflict-resolution-btn').forEach(b => {
					b.removeClass('is-active');
				});
				btn.addClass('is-active');
			};
			return btn;
		};

		createButton(t('keepLocal'), 'local');
		createButton(t('keepRemote'), 'remote');
	}

	private renderDiff(container: HTMLElement, localContent: string, remoteContent: string) {
		const diffLines = computeLineDiff(localContent, remoteContent);

		// Build side-by-side structure
		const sideBySide = container.createDiv({ cls: 'conflict-diff-side-by-side' });

		// Local side (left)
		const localSide = sideBySide.createDiv({ cls: 'conflict-diff-pane conflict-diff-local-pane' });
		const localHeader = localSide.createDiv({ cls: 'conflict-diff-pane-header' });
		localHeader.textContent = t('keepLocal');
		const localBody = localSide.createDiv({ cls: 'conflict-diff-pane-body' });

		// Remote side (right)
		const remoteSide = sideBySide.createDiv({ cls: 'conflict-diff-pane conflict-diff-remote-pane' });
		const remoteHeader = remoteSide.createDiv({ cls: 'conflict-diff-pane-header' });
		remoteHeader.textContent = t('keepRemote');
		const remoteBody = remoteSide.createDiv({ cls: 'conflict-diff-pane-body' });

		// Render lines
		for (const line of diffLines) {
			if (line.type === 'unchanged') {
				// Show on both sides
				this.addDiffLine(localBody, line.content, 'unchanged');
				this.addDiffLine(remoteBody, line.content, 'unchanged');
			} else if (line.type === 'removed') {
				// Show on local side only
				this.addDiffLine(localBody, line.content, 'removed');
				this.addDiffLine(remoteBody, '', 'placeholder');
			} else if (line.type === 'added') {
				// Show on remote side only
				this.addDiffLine(localBody, '', 'placeholder');
				this.addDiffLine(remoteBody, line.content, 'added');
			}
		}
	}

	private addDiffLine(container: HTMLElement, content: string, type: 'unchanged' | 'removed' | 'added' | 'placeholder') {
		const lineEl = container.createDiv({ cls: `conflict-diff-line conflict-diff-${type}` });
		lineEl.textContent = content || '\u00A0'; // Use non-breaking space for empty lines
	}

	private setupDragHandle(dragHandle: HTMLElement, modalEl: HTMLElement): void {
		const onMouseDown = (e: MouseEvent) => {
			this.isDragging = true;
			this.dragStartX = e.clientX;
			this.dragStartY = e.clientY;
			const rect = modalEl.getBoundingClientRect();
			this.modalStartX = rect.left;
			this.modalStartY = rect.top;

			modalEl.setCssStyles({
				position: 'fixed',
				left: `${rect.left}px`,
				top: `${rect.top}px`,
				transform: 'none',
				margin: '0',
			});

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			e.preventDefault();
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!this.isDragging) return;
			const deltaX = e.clientX - this.dragStartX;
			const deltaY = e.clientY - this.dragStartY;
			modalEl.setCssStyles({
				left: `${this.modalStartX + deltaX}px`,
				top: `${this.modalStartY + deltaY}px`,
			});
		};

		const onMouseUp = () => {
			this.isDragging = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		dragHandle.addEventListener('mousedown', onMouseDown);
	}

	private addResizeHandles(modalEl: HTMLElement): void {
		const directions = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
		for (const dir of directions) {
			const handle = document.createElement('div');
			handle.className = `gdrive-sync-resize-handle gdrive-sync-resize-${dir}`;
			handle.dataset.direction = dir;
			modalEl.appendChild(handle);
			this.setupResize(handle, modalEl, dir);
		}
	}

	private setupResize(handle: HTMLElement, modalEl: HTMLElement, direction: string): void {
		const onMouseDown = (e: MouseEvent) => {
			this.isResizing = true;
			this.resizeDirection = direction;
			this.dragStartX = e.clientX;
			this.dragStartY = e.clientY;

			const rect = modalEl.getBoundingClientRect();
			this.resizeStartWidth = rect.width;
			this.resizeStartHeight = rect.height;
			this.modalStartX = rect.left;
			this.modalStartY = rect.top;

			modalEl.setCssStyles({
				position: 'fixed',
				margin: '0',
				transform: 'none',
				left: `${rect.left}px`,
				top: `${rect.top}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
			});

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			e.preventDefault();
			e.stopPropagation();
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!this.isResizing) return;

			const deltaX = e.clientX - this.dragStartX;
			const deltaY = e.clientY - this.dragStartY;
			const dir = this.resizeDirection;

			let newWidth = this.resizeStartWidth;
			let newHeight = this.resizeStartHeight;
			let newLeft = this.modalStartX;
			let newTop = this.modalStartY;

			if (dir.includes('e')) {
				newWidth = Math.max(400, this.resizeStartWidth + deltaX);
			}
			if (dir.includes('w')) {
				newWidth = Math.max(400, this.resizeStartWidth - deltaX);
				newLeft = this.modalStartX + (this.resizeStartWidth - newWidth);
			}
			if (dir.includes('s')) {
				newHeight = Math.max(300, this.resizeStartHeight + deltaY);
			}
			if (dir.includes('n')) {
				newHeight = Math.max(300, this.resizeStartHeight - deltaY);
				newTop = this.modalStartY + (this.resizeStartHeight - newHeight);
			}

			modalEl.setCssStyles({
				width: `${newWidth}px`,
				height: `${newHeight}px`,
				left: `${newLeft}px`,
				top: `${newTop}px`,
			});
		};

		const onMouseUp = () => {
			this.isResizing = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		handle.addEventListener('mousedown', onMouseDown);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Confirmation dialog for full sync operations
 */
export class ConfirmFullSyncDialog extends Modal {
	private title: string;
	private message: string;
	private confirmText: string;
	private onConfirm: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		title: string,
		message: string,
		confirmText: string,
		onConfirm: () => void,
		onCancel: () => void
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.confirmText = confirmText;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.message });

		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText(this.confirmText)
					.setCta()
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			)
			.addButton(btn =>
				btn
					.setButtonText(t('cancel'))
					.onClick(() => {
						this.close();
						this.onCancel();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Dialog shown when remote is newer and pull is required before push
 */
export class PullRequiredDialog extends Modal {
	private onPull: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		onPull: () => void,
		onCancel: () => void
	) {
		super(app);
		this.onPull = onPull;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: t('pullRequiredTitle') });
		contentEl.createEl('p', { text: t('pullRequiredMessage') });

		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText(t('pullNow'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onPull();
					})
			)
			.addButton(btn =>
				btn
					.setButtonText(t('cancel'))
					.onClick(() => {
						this.close();
						this.onCancel();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Simple confirmation dialog
 */
export class ConfirmDialog extends Modal {
	private message: string;
	private onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('p', { text: this.message });

		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText(t('ok'))
					.setCta()
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			)
			.addButton(btn =>
				btn
					.setButtonText(t('cancel'))
					.onClick(() => {
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Information about a file to be deleted that was modified after last sync
 */
export interface ModifiedDeleteInfo {
	path: string;
	modifiedTime: string; // ISO string
}

/**
 * Dialog to notify user about modified files being saved to conflict folder
 */
export class ModifiedFilesNoticeDialog extends Modal {
	private files: ModifiedDeleteInfo[];
	private onConfirm: () => void;
	private conflictFolder: string;

	constructor(
		app: App,
		files: ModifiedDeleteInfo[],
		onConfirm: () => void,
		conflictFolder: string = DEFAULT_CONFLICT_FOLDER
	) {
		super(app);
		this.files = files;
		this.onConfirm = onConfirm;
		this.conflictFolder = conflictFolder;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: t('deleteConfirmTitle') });
		contentEl.createEl('p', { text: t('deleteConfirmDescription') });
		contentEl.createEl('p', {
			text: t('deleteConfirmNotice', { folder: this.conflictFolder }),
			cls: 'conflict-save-notice',
		});

		// File list
		const fileList = contentEl.createDiv({ cls: 'modified-files-list' });

		for (const file of this.files) {
			const fileEl = fileList.createDiv({ cls: 'modified-file-item' });
			fileEl.createEl('div', { text: file.path, cls: 'modified-file-path' });
			fileEl.createEl('div', {
				text: t('modifiedAt', { time: formatDate(file.modifiedTime) }),
				cls: 'modified-file-time',
			});
		}

		// OK button
		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText(t('ok'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Progress dialog for sync operations
 */
export class SyncProgressDialog extends Modal {
	private titleText: string;
	private progressEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private currentProgress = 0;
	private totalItems = 0;

	constructor(app: App, title: string) {
		super(app);
		this.titleText = title;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: this.titleText });

		this.statusEl = contentEl.createEl('p', {
			text: 'Initializing...',
			cls: 'sync-progress-status',
		});

		const progressContainer = contentEl.createDiv({ cls: 'sync-progress-container' });
		this.progressEl = progressContainer.createDiv({ cls: 'sync-progress-bar' });
		this.progressEl.style.width = '0%';
	}

	setTotal(total: number) {
		this.totalItems = total;
		this.updateDisplay();
	}

	setProgress(current: number, status?: string) {
		this.currentProgress = current;
		if (status && this.statusEl) {
			this.statusEl.textContent = status;
		}
		this.updateDisplay();
	}

	private updateDisplay() {
		if (!this.progressEl) return;

		const percent = this.totalItems > 0
			? Math.round((this.currentProgress / this.totalItems) * 100)
			: 0;

		this.progressEl.style.width = `${percent}%`;
	}

	complete(message: string = 'Complete!') {
		if (this.statusEl) {
			this.statusEl.textContent = message;
		}
		if (this.progressEl) {
			this.progressEl.style.width = '100%';
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Dialog for confirming deletion of excluded files
 */
export class DeleteExcludedFilesDialog extends Modal {
	private title: string;
	private files: string[];
	private onConfirm: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		title: string,
		files: string[],
		onConfirm: () => void,
		onCancel: () => void
	) {
		super(app);
		this.title = title;
		this.files = files;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', {
			text: t('deleteExcludedDesc', { count: this.files.length.toString() }),
			cls: 'delete-dialog-description',
		});
		contentEl.createEl('p', {
			text: t('localFilesUnaffected'),
			cls: 'delete-dialog-local-note',
		});

		// Scrollable file list
		const fileListContainer = contentEl.createDiv({ cls: 'delete-file-list' });
		for (const file of this.files) {
			fileListContainer.createEl('div', {
				text: file,
				cls: 'delete-file-item',
			});
		}

		contentEl.createEl('p', {
			text: t('cannotBeUndone'),
			cls: 'delete-dialog-warning',
		});

		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText(t('deleteFromRemote'))
					.setCta()
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			)
			.addButton(btn =>
				btn
					.setButtonText(t('cancel'))
					.onClick(() => {
						this.close();
						this.onCancel();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Updated file info for completion dialog
 */
export interface UpdatedFileInfo {
	path: string;
	modifiedTime: string;
}

/**
 * Dialog to show sync completion with list of updated files
 */
export class SyncCompleteDialog extends Modal {
	private title: string;
	private summary: string;
	private updatedFiles: UpdatedFileInfo[];
	private skippedCount: number;

	constructor(
		app: App,
		title: string,
		summary: string,
		updatedFiles: UpdatedFileInfo[],
		skippedCount: number = 0
	) {
		super(app);
		this.title = title;
		this.summary = summary;
		this.updatedFiles = updatedFiles;
		this.skippedCount = skippedCount;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.summary, cls: 'sync-complete-summary' });

		if (this.updatedFiles.length > 0) {
			contentEl.createEl('h4', { text: t('updatedFiles') });

			const fileList = contentEl.createDiv({ cls: 'sync-complete-file-list' });

			for (const file of this.updatedFiles) {
				const fileEl = fileList.createDiv({ cls: 'sync-complete-file-item' });
				fileEl.createEl('div', { text: file.path, cls: 'sync-complete-file-path' });
				fileEl.createEl('div', {
					text: formatDate(file.modifiedTime),
					cls: 'sync-complete-file-time',
				});
			}
		}

		if (this.skippedCount > 0) {
			contentEl.createEl('p', {
				text: t('skippedUnchanged', { count: this.skippedCount.toString() }),
				cls: 'sync-complete-skipped',
			});
		}

		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText(t('ok'))
					.setCta()
					.onClick(() => {
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Orphan file info for display
 */
export interface UntrackedFileInfo {
	id: string;
	name: string;
}

/**
 * Dialog for selecting, deleting, or restoring untracked files
 */
export class UntrackedFilesDialog extends Modal {
	private files: UntrackedFileInfo[];
	private onDelete: (fileIds: string[]) => Promise<void>;
	private onRestore: (fileIds: string[]) => Promise<void>;
	private selectedFiles: Set<string> = new Set();
	private checkboxes: Map<string, HTMLInputElement> = new Map();
	private selectAllCheckbox: HTMLInputElement | null = null;
	private deleteButtonComponent: ButtonComponent | null = null;
	private restoreButtonComponent: ButtonComponent | null = null;

	constructor(
		app: App,
		files: UntrackedFileInfo[],
		onDelete: (fileIds: string[]) => Promise<void>,
		onRestore: (fileIds: string[]) => Promise<void>
	) {
		super(app);
		this.files = files;
		this.onDelete = onDelete;
		this.onRestore = onRestore;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: t('untrackedFilesTitle') });
		contentEl.createEl('p', {
			text: t('untrackedFilesDesc'),
			cls: 'untracked-dialog-description',
		});

		if (this.files.length === 0) {
			contentEl.createEl('p', {
				text: t('noUntrackedFiles'),
				cls: 'untracked-no-files',
			});
			new Setting(contentEl)
				.addButton(btn =>
					btn
						.setButtonText(t('ok'))
						.setCta()
						.onClick(() => this.close())
				);
			return;
		}

		// Select all checkbox
		const selectAllContainer = contentEl.createDiv({ cls: 'untracked-select-all' });
		const selectAllLabel = selectAllContainer.createEl('label', { cls: 'untracked-checkbox-label' });
		this.selectAllCheckbox = selectAllLabel.createEl('input', { type: 'checkbox' });
		selectAllLabel.createSpan({ text: t('selectAll') });

		this.selectAllCheckbox.addEventListener('change', () => {
			const checked = this.selectAllCheckbox!.checked;
			for (const [fileId, checkbox] of this.checkboxes) {
				checkbox.checked = checked;
				if (checked) {
					this.selectedFiles.add(fileId);
				} else {
					this.selectedFiles.delete(fileId);
				}
			}
			this.updateButtons();
		});

		// File list with checkboxes
		const fileListContainer = contentEl.createDiv({ cls: 'untracked-file-list' });

		for (const file of this.files) {
			const fileEl = fileListContainer.createDiv({ cls: 'untracked-file-item' });
			const label = fileEl.createEl('label', { cls: 'untracked-checkbox-label' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			label.createSpan({ text: file.name, cls: 'untracked-file-name' });

			this.checkboxes.set(file.id, checkbox);

			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedFiles.add(file.id);
				} else {
					this.selectedFiles.delete(file.id);
				}
				this.updateSelectAllCheckbox();
				this.updateButtons();
			});
		}

		// Buttons
		const buttonContainer = new Setting(contentEl);

		// Restore button
		buttonContainer.addButton(btn => {
			this.restoreButtonComponent = btn;
			btn
				.setButtonText(t('restoreSelected', { count: '0' }))
				.setCta()
				.setDisabled(true)
				.onClick(async () => {
					if (this.selectedFiles.size === 0) return;

					const fileIds = Array.from(this.selectedFiles);
					this.setButtonsDisabled(true);
					btn.setButtonText(t('restoring'));

					try {
						await this.onRestore(fileIds);
						this.close();
					} catch (err) {
						console.error('Failed to restore untracked files:', err);
						btn.setButtonText(t('restoreSelected', { count: fileIds.length.toString() }));
						this.setButtonsDisabled(false);
					}
				});
		});

		// Delete button
		buttonContainer.addButton(btn => {
			this.deleteButtonComponent = btn;
			btn
				.setButtonText(t('deleteSelected', { count: '0' }))
				.setWarning()
				.setDisabled(true)
				.onClick(async () => {
					if (this.selectedFiles.size === 0) return;

					const fileIds = Array.from(this.selectedFiles);
					this.setButtonsDisabled(true);
					btn.setButtonText(t('deleting'));

					try {
						await this.onDelete(fileIds);
						this.close();
					} catch (err) {
						console.error('Failed to delete untracked files:', err);
						btn.setButtonText(t('deleteSelected', { count: fileIds.length.toString() }));
						this.setButtonsDisabled(false);
					}
				});
		});

		buttonContainer.addButton(btn =>
			btn
				.setButtonText(t('cancel'))
				.onClick(() => this.close())
		);
	}

	private updateSelectAllCheckbox() {
		if (!this.selectAllCheckbox) return;
		this.selectAllCheckbox.checked = this.selectedFiles.size === this.files.length;
		this.selectAllCheckbox.indeterminate =
			this.selectedFiles.size > 0 && this.selectedFiles.size < this.files.length;
	}

	private updateButtons() {
		const count = this.selectedFiles.size;
		if (this.deleteButtonComponent) {
			this.deleteButtonComponent.setButtonText(t('deleteSelected', { count: count.toString() }));
			this.deleteButtonComponent.setDisabled(count === 0);
		}
		if (this.restoreButtonComponent) {
			this.restoreButtonComponent.setButtonText(t('restoreSelected', { count: count.toString() }));
			this.restoreButtonComponent.setDisabled(count === 0);
		}
	}

	private setButtonsDisabled(disabled: boolean) {
		if (this.deleteButtonComponent) this.deleteButtonComponent.setDisabled(disabled);
		if (this.restoreButtonComponent) this.restoreButtonComponent.setDisabled(disabled);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Info for temp files
 */
export interface TempFileInfo {
	id: string;
	name: string;       // Full name with __TEMP__/ prefix
	displayName: string; // Name without prefix (original path)
}

/**
 * Dialog for selecting, downloading, or deleting temporary files
 */
export class TempFilesDialog extends Modal {
	private files: TempFileInfo[];
	private onDelete: (fileIds: string[]) => Promise<void>;
	private onDownload: (fileIds: string[]) => Promise<void>;
	private selectedFiles: Set<string> = new Set();
	private checkboxes: Map<string, HTMLInputElement> = new Map();
	private selectAllCheckbox: HTMLInputElement | null = null;
	private deleteButtonComponent: ButtonComponent | null = null;
	private downloadButtonComponent: ButtonComponent | null = null;

	constructor(
		app: App,
		files: TempFileInfo[],
		onDelete: (fileIds: string[]) => Promise<void>,
		onDownload: (fileIds: string[]) => Promise<void>
	) {
		super(app);
		this.files = files;
		this.onDelete = onDelete;
		this.onDownload = onDownload;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: t('tempFilesDialogTitle') });
		contentEl.createEl('p', {
			text: t('tempFilesDialogDesc'),
			cls: 'untracked-dialog-description',
		});

		if (this.files.length === 0) {
			contentEl.createEl('p', {
				text: t('noTempFiles'),
				cls: 'untracked-no-files',
			});
			new Setting(contentEl)
				.addButton(btn =>
					btn
						.setButtonText(t('ok'))
						.setCta()
						.onClick(() => this.close())
				);
			return;
		}

		// Select all checkbox
		const selectAllContainer = contentEl.createDiv({ cls: 'untracked-select-all' });
		const selectAllLabel = selectAllContainer.createEl('label', { cls: 'untracked-checkbox-label' });
		this.selectAllCheckbox = selectAllLabel.createEl('input', { type: 'checkbox' });
		selectAllLabel.createSpan({ text: t('selectAll') });

		this.selectAllCheckbox.addEventListener('change', () => {
			const checked = this.selectAllCheckbox!.checked;
			for (const [fileId, checkbox] of this.checkboxes) {
				checkbox.checked = checked;
				if (checked) {
					this.selectedFiles.add(fileId);
				} else {
					this.selectedFiles.delete(fileId);
				}
			}
			this.updateButtons();
		});

		// File list with checkboxes
		const fileListContainer = contentEl.createDiv({ cls: 'untracked-file-list' });

		for (const file of this.files) {
			const fileEl = fileListContainer.createDiv({ cls: 'untracked-file-item' });
			const label = fileEl.createEl('label', { cls: 'untracked-checkbox-label' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			label.createSpan({ text: file.displayName, cls: 'untracked-file-name' });

			this.checkboxes.set(file.id, checkbox);

			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedFiles.add(file.id);
				} else {
					this.selectedFiles.delete(file.id);
				}
				this.updateSelectAllCheckbox();
				this.updateButtons();
			});
		}

		// Buttons
		const buttonContainer = new Setting(contentEl);

		// Download button
		buttonContainer.addButton(btn => {
			this.downloadButtonComponent = btn;
			btn
				.setButtonText(t('downloadSelected', { count: '0' }))
				.setCta()
				.setDisabled(true)
				.onClick(async () => {
					if (this.selectedFiles.size === 0) return;

					const fileIds = Array.from(this.selectedFiles);
					this.setButtonsDisabled(true);
					btn.setButtonText(t('downloadingTempFiles'));

					try {
						await this.onDownload(fileIds);
						this.close();
					} catch (err) {
						console.error('Failed to download temp files:', err);
						btn.setButtonText(t('downloadSelected', { count: fileIds.length.toString() }));
						this.setButtonsDisabled(false);
					}
				});
		});

		// Delete button
		buttonContainer.addButton(btn => {
			this.deleteButtonComponent = btn;
			btn
				.setButtonText(t('deleteSelected', { count: '0' }))
				.setWarning()
				.setDisabled(true)
				.onClick(async () => {
					if (this.selectedFiles.size === 0) return;

					const fileIds = Array.from(this.selectedFiles);
					this.setButtonsDisabled(true);
					btn.setButtonText(t('deleting'));

					try {
						await this.onDelete(fileIds);
						this.close();
					} catch (err) {
						console.error('Failed to delete temp files:', err);
						btn.setButtonText(t('deleteSelected', { count: fileIds.length.toString() }));
						this.setButtonsDisabled(false);
					}
				});
		});

		buttonContainer.addButton(btn =>
			btn
				.setButtonText(t('cancel'))
				.onClick(() => this.close())
		);
	}

	private updateSelectAllCheckbox() {
		if (!this.selectAllCheckbox) return;
		this.selectAllCheckbox.checked = this.selectedFiles.size === this.files.length;
		this.selectAllCheckbox.indeterminate =
			this.selectedFiles.size > 0 && this.selectedFiles.size < this.files.length;
	}

	private updateButtons() {
		const count = this.selectedFiles.size;
		if (this.deleteButtonComponent) {
			this.deleteButtonComponent.setButtonText(t('deleteSelected', { count: count.toString() }));
			this.deleteButtonComponent.setDisabled(count === 0);
		}
		if (this.downloadButtonComponent) {
			this.downloadButtonComponent.setButtonText(t('downloadSelected', { count: count.toString() }));
			this.downloadButtonComponent.setDisabled(count === 0);
		}
	}

	private setButtonsDisabled(disabled: boolean) {
		if (this.deleteButtonComponent) this.deleteButtonComponent.setDisabled(disabled);
		if (this.downloadButtonComponent) this.downloadButtonComponent.setDisabled(disabled);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * CSS styles for dialogs (to be added to styles.css)
 */
export const dialogStyles = `
/* Resizable modal container */
.gdrive-sync-modal-resizable.modal {
	width: 80vw;
	max-width: 1000px;
	height: 80vh;
	max-height: 90vh;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.gdrive-sync-modal-resizable .modal-content {
	flex: 1;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	min-height: 0;
}

/* Drag handle (title bar) */
.gdrive-sync-modal-resizable .modal-drag-handle {
	cursor: move;
	padding: 12px 16px;
	margin: -16px -16px 16px -16px;
	background: var(--background-secondary);
	border-bottom: 1px solid var(--background-modifier-border);
	user-select: none;
	flex-shrink: 0;
}

.gdrive-sync-modal-resizable .modal-drag-handle h2 {
	margin: 0;
}

/* Resize handles */
.gdrive-sync-resize-handle {
	position: absolute;
	z-index: 100;
}

.gdrive-sync-resize-n {
	top: -4px;
	left: 10px;
	right: 10px;
	height: 8px;
	cursor: n-resize;
}

.gdrive-sync-resize-s {
	bottom: -4px;
	left: 10px;
	right: 10px;
	height: 8px;
	cursor: s-resize;
}

.gdrive-sync-resize-e {
	top: 10px;
	right: -4px;
	bottom: 10px;
	width: 8px;
	cursor: e-resize;
}

.gdrive-sync-resize-w {
	top: 10px;
	left: -4px;
	bottom: 10px;
	width: 8px;
	cursor: w-resize;
}

.gdrive-sync-resize-ne {
	top: -4px;
	right: -4px;
	width: 14px;
	height: 14px;
	cursor: ne-resize;
}

.gdrive-sync-resize-nw {
	top: -4px;
	left: -4px;
	width: 14px;
	height: 14px;
	cursor: nw-resize;
}

.gdrive-sync-resize-se {
	bottom: -4px;
	right: -4px;
	width: 14px;
	height: 14px;
	cursor: se-resize;
}

.gdrive-sync-resize-sw {
	bottom: -4px;
	left: -4px;
	width: 14px;
	height: 14px;
	cursor: sw-resize;
}

.conflict-dialog-description {
	color: var(--text-muted);
	margin-bottom: 0.5em;
}

.conflict-save-notice {
	color: var(--text-muted);
	font-size: 0.9em;
	background: var(--background-secondary);
	padding: 8px 12px;
	border-radius: 4px;
	margin-bottom: 1em;
}

.conflict-list {
	flex: 1;
	min-height: 100px;
	overflow-y: auto;
	margin-bottom: 1em;
}

.gdrive-sync-modal-resizable .conflict-list {
	max-height: none;
}

.conflict-item {
	padding: 12px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	margin-bottom: 8px;
}

.conflict-path {
	font-weight: 600;
	margin-bottom: 8px;
	word-break: break-all;
}

.conflict-times {
	font-size: 0.85em;
	color: var(--text-muted);
	margin-bottom: 8px;
}

.conflict-remote-deleted-desc {
	font-size: 0.9em;
	color: var(--text-warning);
	margin-bottom: 8px;
	font-style: italic;
}

.conflict-remote-deleted {
	color: var(--text-error);
}

.conflict-buttons {
	display: flex;
	gap: 8px;
}

.conflict-resolution-btn {
	padding: 4px 12px;
	border-radius: 4px;
	cursor: pointer;
}

.conflict-resolution-btn.is-active {
	background-color: var(--interactive-accent);
	color: var(--text-on-accent);
}

.conflict-dialog-buttons {
	margin-top: 1em;
	border-top: 1px solid var(--background-modifier-border);
	padding-top: 1em;
}

.sync-progress-container {
	background-color: var(--background-modifier-border);
	border-radius: 4px;
	height: 8px;
	overflow: hidden;
	margin-top: 1em;
}

.sync-progress-bar {
	background-color: var(--interactive-accent);
	height: 100%;
	transition: width 0.3s ease;
}

.sync-progress-status {
	color: var(--text-muted);
}

/* Diff view container */
.conflict-diff-container {
	margin: 8px 0;
}

.conflict-diff-view {
	font-family: var(--font-monospace);
	font-size: 12px;
	line-height: 1.5;
	max-height: 300px;
	overflow: auto;
	margin: 8px 0;
	border-radius: 4px;
	background: var(--background-secondary);
}

/* Side-by-side layout */
.conflict-diff-side-by-side {
	display: flex;
	flex-direction: row;
	gap: 2px;
	min-width: fit-content;
}

.conflict-diff-pane {
	flex: 1;
	min-width: 200px;
	display: flex;
	flex-direction: column;
}

.conflict-diff-pane-header {
	padding: 6px 8px;
	font-weight: 600;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	position: sticky;
	top: 0;
	z-index: 1;
}

.conflict-diff-local-pane .conflict-diff-pane-header {
	background: rgba(255, 100, 100, 0.2);
	color: var(--text-normal);
}

.conflict-diff-remote-pane .conflict-diff-pane-header {
	background: rgba(0, 200, 83, 0.2);
	color: var(--text-normal);
}

.conflict-diff-pane-body {
	flex: 1;
}

.conflict-diff-line {
	white-space: pre;
	min-height: 1.4em;
	padding: 0 8px;
	border-left: 3px solid transparent;
}

.conflict-diff-unchanged {
	background: transparent;
	color: var(--text-muted);
}

.conflict-diff-added {
	background: rgba(0, 200, 83, 0.15);
	border-left-color: var(--color-green);
	color: var(--text-normal);
}

.conflict-diff-removed {
	background: rgba(255, 100, 100, 0.15);
	border-left-color: var(--color-red);
	color: var(--text-normal);
}

.conflict-diff-placeholder {
	background: var(--background-secondary-alt);
	color: transparent;
}

/* Toggle button */
.conflict-diff-toggle {
	cursor: pointer;
	color: var(--text-accent);
	font-size: 0.9em;
}

.conflict-diff-toggle:hover {
	text-decoration: underline;
}

/* Mobile responsive: stack vertically on narrow screens */
@media (max-width: 600px) {
	.conflict-diff-side-by-side {
		flex-direction: column;
	}

	.conflict-diff-pane {
		min-width: 100%;
	}

	.conflict-diff-view {
		max-height: 400px;
	}

	.conflict-diff-pane-body {
		max-height: 150px;
		overflow-y: auto;
	}
}

/* Modified files notice dialog */
.modified-files-list {
	max-height: 300px;
	overflow-y: auto;
	margin-bottom: 1em;
}

.modified-file-item {
	padding: 8px 12px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	margin-bottom: 6px;
}

.modified-file-path {
	font-weight: 500;
	word-break: break-all;
}

.modified-file-time {
	font-size: 0.85em;
	color: var(--text-muted);
	margin-top: 2px;
}

/* Delete excluded files dialog */
.delete-dialog-description {
	color: var(--text-muted);
	margin-bottom: 0.25em;
}

.delete-dialog-local-note {
	color: var(--text-success);
	font-size: 0.9em;
	margin-bottom: 0.5em;
}

.delete-file-list {
	max-height: 200px;
	overflow-y: auto;
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	padding: 8px;
	margin-bottom: 1em;
	background-color: var(--background-secondary);
}

.delete-file-item {
	font-family: var(--font-monospace);
	font-size: 0.85em;
	padding: 4px 0;
	word-break: break-all;
	border-bottom: 1px solid var(--background-modifier-border);
}

.delete-file-item:last-child {
	border-bottom: none;
}

.delete-dialog-warning {
	color: var(--text-error);
	font-weight: 600;
	margin-top: 0.5em;
}

/* Sync complete dialog */
.sync-complete-summary {
	color: var(--text-muted);
	margin-bottom: 1em;
}

.sync-complete-file-list {
	max-height: 300px;
	overflow-y: auto;
	margin-bottom: 1em;
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	background-color: var(--background-secondary);
}

.sync-complete-file-item {
	padding: 8px 12px;
	border-bottom: 1px solid var(--background-modifier-border);
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
}

.sync-complete-file-item:last-child {
	border-bottom: none;
}

.sync-complete-file-path {
	font-family: var(--font-monospace);
	font-size: 0.85em;
	word-break: break-all;
	flex: 1;
}

.sync-complete-file-time {
	font-size: 0.8em;
	color: var(--text-muted);
	white-space: nowrap;
}

.sync-complete-skipped {
	color: var(--text-muted);
	font-size: 0.9em;
}

.untracked-dialog-description {
	color: var(--text-muted);
	margin-bottom: 1em;
}

.untracked-no-files {
	color: var(--text-muted);
	font-style: italic;
}

.untracked-select-all {
	margin-bottom: 0.5em;
	padding-bottom: 0.5em;
	border-bottom: 1px solid var(--background-modifier-border);
}

.untracked-file-list {
	max-height: 300px;
	overflow-y: auto;
	margin-bottom: 1em;
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
}

.untracked-file-item {
	padding: 6px 10px;
	border-bottom: 1px solid var(--background-modifier-border);
}

.untracked-file-item:last-child {
	border-bottom: none;
}

.untracked-file-item:hover {
	background: var(--background-secondary);
}

.untracked-checkbox-label {
	display: flex;
	align-items: center;
	gap: 8px;
	cursor: pointer;
}

.untracked-file-name {
	font-family: var(--font-monospace);
	font-size: 0.85em;
	word-break: break-all;
}
`;
