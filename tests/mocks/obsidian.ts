/**
 * Mock implementations for Obsidian API
 */

export class MockAdapter {
	private files: Map<string, { content: ArrayBuffer; mtime: number }>;

	constructor(files: Map<string, { content: ArrayBuffer; mtime: number }>) {
		this.files = files;
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const data = this.files.get(path);
		if (!data) {
			throw new Error(`File not found: ${path}`);
		}
		return new TextDecoder().decode(data.content);
	}

	async write(path: string, content: string): Promise<void> {
		const buffer = new TextEncoder().encode(content).buffer as ArrayBuffer;
		this.files.set(path, { content: buffer, mtime: Date.now() });
	}

	async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
		this.files.set(path, { content, mtime: Date.now() });
	}
}

export class MockTFile {
	path: string;
	name: string;
	stat: { mtime: number };

	constructor(path: string, mtime: number = Date.now()) {
		this.path = path;
		this.name = path.split('/').pop() || path;
		this.stat = { mtime };
	}
}

export class MockVault {
	private files: Map<string, { content: ArrayBuffer; mtime: number }> = new Map();
	private folders: Set<string> = new Set();
	adapter: MockAdapter;

	constructor() {
		// Initialize with .obsidian folder
		this.folders.add('.obsidian');
		this.adapter = new MockAdapter(this.files);
	}

	// Add a file to the mock vault
	addFile(path: string, content: string | ArrayBuffer, mtime: number = Date.now()): MockTFile {
		const buffer = typeof content === 'string'
			? new TextEncoder().encode(content).buffer as ArrayBuffer
			: content;
		this.files.set(path, { content: buffer, mtime });

		// Create parent folders
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) {
			this.folders.add(parts.slice(0, i).join('/'));
		}

		return new MockTFile(path, mtime);
	}

	// Remove a file
	removeFile(path: string): void {
		this.files.delete(path);
	}

	// Get all files
	getFiles(): MockTFile[] {
		return Array.from(this.files.entries()).map(
			([path, data]) => new MockTFile(path, data.mtime)
		);
	}

	getAbstractFileByPath(path: string): MockTFile | null {
		const fileData = this.files.get(path);
		if (fileData) {
			return new MockTFile(path, fileData.mtime);
		}
		return null;
	}

	async read(file: MockTFile): Promise<string> {
		const data = this.files.get(file.path);
		if (!data) {
			throw new Error(`File not found: ${file.path}`);
		}
		return new TextDecoder().decode(data.content);
	}

	async readBinary(file: MockTFile): Promise<ArrayBuffer> {
		const data = this.files.get(file.path);
		if (!data) {
			throw new Error(`File not found: ${file.path}`);
		}
		return data.content;
	}

	async modify(file: MockTFile, content: string): Promise<void> {
		const data = this.files.get(file.path);
		if (!data) {
			throw new Error(`File not found: ${file.path}`);
		}
		const buffer = new TextEncoder().encode(content).buffer as ArrayBuffer;
		this.files.set(file.path, { content: buffer, mtime: Date.now() });
	}

	async modifyBinary(file: MockTFile, content: ArrayBuffer): Promise<void> {
		const data = this.files.get(file.path);
		if (!data) {
			throw new Error(`File not found: ${file.path}`);
		}
		this.files.set(file.path, { content, mtime: Date.now() });
	}

	async create(path: string, content: string): Promise<MockTFile> {
		if (this.files.has(path)) {
			throw new Error(`File already exists: ${path}`);
		}
		return this.addFile(path, content);
	}

	async createBinary(path: string, content: ArrayBuffer): Promise<MockTFile> {
		if (this.files.has(path)) {
			throw new Error(`File already exists: ${path}`);
		}
		return this.addFile(path, content);
	}

	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path)) {
			throw new Error(`Folder already exists: ${path}`);
		}
		this.folders.add(path);
	}

	async trash(file: MockTFile, system: boolean): Promise<void> {
		this.files.delete(file.path);
	}

	// Helper to check file content
	getFileContent(path: string): string | null {
		const data = this.files.get(path);
		if (!data) return null;
		return new TextDecoder().decode(data.content);
	}

	// Helper to check if file exists
	hasFile(path: string): boolean {
		return this.files.has(path);
	}

	// Helper to modify file content by path
	modifyFileContent(path: string, content: string): void {
		const buffer = new TextEncoder().encode(content).buffer as ArrayBuffer;
		this.files.set(path, { content: buffer, mtime: Date.now() });
	}
}

// Mock GDrive API responses
export class MockGDriveAPI {
	private files: Map<string, { id: string; content: ArrayBuffer; modifiedTime: string }> = new Map();
	private nextId = 1;

	addFile(name: string, content: string | ArrayBuffer): { id: string; name: string; modifiedTime: string } {
		const id = `file_${this.nextId++}`;
		const buffer = typeof content === 'string'
			? new TextEncoder().encode(content).buffer as ArrayBuffer
			: content;
		const modifiedTime = new Date().toISOString();
		this.files.set(name, { id, content: buffer, modifiedTime });
		return { id, name, modifiedTime };
	}

	getFilesList(): Array<{ id: string; name: string; modifiedTime: string }> {
		return Array.from(this.files.entries()).map(([name, data]) => ({
			id: data.id,
			name,
			modifiedTime: data.modifiedTime,
		}));
	}

	getFile(fileId: string): [string, ArrayBuffer] | null {
		for (const [name, data] of this.files.entries()) {
			if (data.id === fileId) {
				return [name, data.content];
			}
		}
		return null;
	}

	uploadFile(name: string, content: ArrayBuffer): string {
		const existing = this.files.get(name);
		if (existing) {
			this.files.set(name, { ...existing, content, modifiedTime: new Date().toISOString() });
			return existing.id;
		}
		const file = this.addFile(name, content);
		return file.id;
	}

	modifyFile(fileId: string, content: ArrayBuffer): void {
		for (const [name, data] of this.files.entries()) {
			if (data.id === fileId) {
				this.files.set(name, { ...data, content, modifiedTime: new Date().toISOString() });
				return;
			}
		}
		throw new Error(`File not found: ${fileId}`);
	}

	deleteFile(fileId: string): boolean {
		for (const [name, data] of this.files.entries()) {
			if (data.id === fileId) {
				this.files.delete(name);
				return true;
			}
		}
		return false;
	}

	clear(): void {
		this.files.clear();
		this.nextId = 1;
	}

	getFileByName(name: string): { id: string; content: ArrayBuffer; modifiedTime: string } | null {
		return this.files.get(name) || null;
	}

	// Helper to get file content by name as string
	getFileContent(name: string): string | null {
		const data = this.files.get(name);
		if (!data) return null;
		return new TextDecoder().decode(data.content);
	}
}
