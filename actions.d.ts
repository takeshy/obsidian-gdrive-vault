/**
 * Type declarations for actions.js
 */

export function getVaultId(
	accessToken: string,
	vault: string,
	root?: string | null
): Promise<string>;

export function uploadFile(
	accessToken: string,
	fileName: string,
	buffer?: ArrayBuffer | null,
	parentId?: string | null
): Promise<string>;

export function modifyFile(
	accessToken: string,
	fileId: string,
	buffer: ArrayBuffer
): Promise<any>;

export function renameFile(
	accessToken: string,
	fileId: string,
	newName: string
): Promise<string>;

export function deleteFile(
	accessToken: string,
	fileId: string
): Promise<boolean>;

export function uploadFolder(
	accessToken: string,
	foldername: string,
	rootId?: string | null
): Promise<string>;

export function getFilesList(
	accessToken: string,
	vault: string
): Promise<Array<{
	id: string;
	name: string;
	modifiedTime: string;
	mimeType?: string;
}>>;

export function getFoldersList(
	accessToken: string,
	vault?: string | null
): Promise<Array<{
	id: string;
	name: string;
}>>;

export function getFile(
	accessToken: string,
	fileId: string
): Promise<[string, ArrayBuffer]>;

export function getFileInfo(
	accessToken: string,
	id: string
): Promise<any>;
