/**
 * Mock for the 'obsidian' module
 */

export class TFile {
	path: string;
	name: string;
	stat: { mtime: number };

	constructor(path: string = '', mtime: number = Date.now()) {
		this.path = path;
		this.name = path.split('/').pop() || path;
		this.stat = { mtime };
	}
}

export class TFolder {
	path: string;
	name: string;

	constructor(path: string = '') {
		this.path = path;
		this.name = path.split('/').pop() || path;
	}
}

export class Vault {
	getFiles(): TFile[] {
		return [];
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		return null;
	}

	async read(file: TFile): Promise<string> {
		return '';
	}

	async readBinary(file: TFile): Promise<ArrayBuffer> {
		return new ArrayBuffer(0);
	}

	async modify(file: TFile, content: string): Promise<void> {}

	async modifyBinary(file: TFile, content: ArrayBuffer): Promise<void> {}

	async create(path: string, content: string): Promise<TFile> {
		return new TFile(path);
	}

	async createBinary(path: string, content: ArrayBuffer): Promise<TFile> {
		return new TFile(path);
	}

	async createFolder(path: string): Promise<void> {}

	async trash(file: TFile, system: boolean): Promise<void> {}
}

export class App {
	vault: Vault;

	constructor() {
		this.vault = new Vault();
	}
}

export class Notice {
	constructor(message: string, duration?: number) {}
}

export class Modal {
	app: App;
	contentEl: HTMLElement;

	constructor(app: App) {
		this.app = app;
		this.contentEl = {} as HTMLElement;
	}

	open(): void {}
	close(): void {}
	onOpen(): void {}
	onClose(): void {}
}

export class Setting {
	constructor(containerEl: HTMLElement) {}

	setName(name: string): this {
		return this;
	}

	setDesc(desc: string): this {
		return this;
	}

	addButton(cb: (button: any) => any): this {
		return this;
	}

	addToggle(cb: (toggle: any) => any): this {
		return this;
	}

	addText(cb: (text: any) => any): this {
		return this;
	}

	addTextArea(cb: (textArea: any) => any): this {
		return this;
	}
}

export class Plugin {
	app: App;

	constructor() {
		this.app = new App();
	}

	loadData(): Promise<any> {
		return Promise.resolve({});
	}

	saveData(data: any): Promise<void> {
		return Promise.resolve();
	}

	addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement {
		return {} as HTMLElement;
	}

	addCommand(command: any): void {}

	addSettingTab(tab: any): void {}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = {} as HTMLElement;
	}

	display(): void {}
}

export class FileSystemAdapter {
	getBasePath(): string {
		return '/mock/vault';
	}
}

export function setIcon(el: HTMLElement, iconId: string): void {}

export async function requestUrl(options: any): Promise<any> {
	return { json: {}, arrayBuffer: new ArrayBuffer(0), status: 200 };
}
