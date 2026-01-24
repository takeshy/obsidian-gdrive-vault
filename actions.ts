/**
 * Google Drive API wrapper functions
 */

import { requestUrl, RequestUrlResponse } from "obsidian";

/** File info returned from Drive API */
export interface DriveFileInfo {
	id: string;
	name: string;
	modifiedTime: string;
	mimeType?: string;
}

/** Folder info returned from Drive API */
export interface DriveFolderInfo {
	id: string;
	name: string;
}

/**
 * Create a standardized error for API actions
 */
const newError = (actionName: string, err: Error): Error => {
	return new Error(`ERROR: Unable to complete action: - ${actionName} => ${err.name} - ${err.message} - ${err.stack}`);
};

/**
 * Get the vault folder ID from Google Drive
 */
export const getVaultId = async (
	accessToken: string,
	vault: string,
	root: string | null = null
): Promise<string> => {
	try {
		const response = await requestUrl({
			url:
				"https://www.googleapis.com/drive/v3/files?q=mimeType%20%3D%20'application%2Fvnd.google-apps.folder'" +
				(root != null ? `%20and%20'${root}'%20in%20parents` : ""),
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		}).catch((e) => console.log(e)) as RequestUrlResponse;
		const list = response.json.files;
		const vaultFolder = list.filter((file: { name: string }) => file.name == vault);
		const vaultId = vaultFolder.length ? vaultFolder[0].id : "NOT FOUND";
		return vaultId;
	} catch (err) {
		console.log(err);
		throw newError("getVaultId", err as Error);
	}
};

/**
 * Upload a file to Google Drive
 */
export const uploadFile = async (
	accessToken: string,
	fileName: string,
	buffer: ArrayBuffer | null = null,
	parentId: string | null = null
): Promise<string> => {
	try {
		const response = await requestUrl({
			url: "https://www.googleapis.com/drive/v3/files?uploadType=multipart",
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			contentType: "application/json",
			body: JSON.stringify({
				name: fileName,
				parents: parentId ? [parentId] : [],
			}),
		}).catch((e) => console.log(e)) as RequestUrlResponse;
		const id = response.json.id;
		if (buffer) {
			// upload the content
			await requestUrl({
				url: `https://www.googleapis.com/upload/drive/v3/files/${id}`,
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
				},
				contentType: "application/json",
				body: buffer,
			}).catch((e) => console.log(e));
		}
		return id;
	} catch (err) {
		console.log(err);
		throw newError("uploadFile", err as Error);
	}
};

/**
 * Modify an existing file's content
 */
export const modifyFile = async (
	accessToken: string,
	fileId: string,
	buffer: ArrayBuffer
): Promise<RequestUrlResponse> => {
	try {
		const res = await requestUrl({
			url: `https://www.googleapis.com/upload/drive/v3/files/${fileId}`,
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			contentType: "application/json",
			body: buffer,
		}).catch((e) => console.log(e)) as RequestUrlResponse;
		return res;
	} catch (err) {
		console.log(err);
		throw newError("modifyFile", err as Error);
	}
};

/**
 * Rename a file in Google Drive
 */
export const renameFile = async (
	accessToken: string,
	fileId: string,
	newName: string
): Promise<string> => {
	try {
		const response = await requestUrl({
			url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			contentType: "application/json",
			body: JSON.stringify({
				name: newName,
			}),
		}).catch((e) => console.log(e)) as RequestUrlResponse;
		const id = response.json.id;
		return id;
	} catch (err) {
		console.log(err);
		throw newError("renameFile", err as Error);
	}
};

/**
 * Delete a file from Google Drive
 */
export const deleteFile = async (
	accessToken: string,
	fileId: string
): Promise<boolean> => {
	try {
		const response = await requestUrl({
			url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			contentType: "application/json",
		});
		if (response.status == 404) {
			return false;
		} else {
			return true;
		}
	} catch (err: any) {
		if (err.status == 404) {
			return false;
		}
		console.log(err);
		throw newError("deleteFile", err as Error);
	}
};

/**
 * Create a folder in Google Drive
 */
export const uploadFolder = async (
	accessToken: string,
	foldername: string,
	rootId: string | null = null
): Promise<string> => {
	try {
		const response = await requestUrl({
			url: "https://www.googleapis.com/drive/v3/files?uploadType=multipart",
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			contentType: "application/json",
			body: JSON.stringify({
				mimeType: "application/vnd.google-apps.folder",
				name: foldername,
				parents: rootId ? [rootId] : [],
			}),
		}).catch((e) => console.log(e)) as RequestUrlResponse;

		const id = response.json.id;
		return id;
	} catch (err) {
		console.log(err);
		throw newError("uploadFolder", err as Error);
	}
};

/**
 * Get list of files in a vault folder
 */
export const getFilesList = async (
	accessToken: string,
	vault: string
): Promise<DriveFileInfo[]> => {
	try {
		const response = await requestUrl({
			url:
				"https://www.googleapis.com/drive/v3/files" +
				(vault != null
					? `?q='${vault}'%20in%20parents&fields=files(name%2CmodifiedTime%2CmimeType%2Cid)&pageSize=1000`
					: ""),
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
			contentType: "application/json",
		});
		let files: DriveFileInfo[] = response.json.files;
		let isNextPageAvailable = response.json.nextPageToken ? true : false;
		let nextPageToken = response.json.nextPageToken;
		while (isNextPageAvailable) {
			const pageResponse = await requestUrl({
				url:
					"https://www.googleapis.com/drive/v3/files" +
					(vault != null
						? `?q='${vault}'%20in%20parents&fields=files(name%2CmodifiedTime%2CmimeType%2Cid)&pageSize=1000`
						: "") +
					`&pageToken=${nextPageToken}`,
				method: "GET",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
				},
				contentType: "application/json",
			});
			files = files.concat(pageResponse.json.files);
			isNextPageAvailable = pageResponse.json.nextPageToken ? true : false;
			nextPageToken = pageResponse.json.nextPageToken;
		}
		return files;
	} catch (err) {
		console.log(err);
		throw newError("getFilesList", err as Error);
	}
};

/**
 * Get list of folders
 */
export const getFoldersList = async (
	accessToken: string,
	vault: string | null = null
): Promise<DriveFolderInfo[]> => {
	try {
		const response = await requestUrl({
			url:
				"https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27" +
				(vault != null ? `%20and%20'${vault}'%20in%20parents` : "") +
				"&fields=files(name%2Cid)&orderBy=createdTime&pageSize=1000",
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		});
		let folders: DriveFolderInfo[] = response.json.files;
		console.log(folders);
		let isNextPageAvailable = response.json.nextPageToken ? true : false;
		let nextPageToken = response.json.nextPageToken;
		while (isNextPageAvailable) {
			const pageResponse = await requestUrl({
				url:
					"https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27" +
					(vault != null ? `%20and%20'${vault}'%20in%20parents` : "") +
					"&fields=files(name%2Cid)&orderBy=createdTime&pageSize=1000" +
					`&pageToken=${nextPageToken}`,
				method: "GET",
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			});
			folders = folders.concat(pageResponse.json.files);
			isNextPageAvailable = pageResponse.json.nextPageToken ? true : false;
			nextPageToken = pageResponse.json.nextPageToken;
		}
		return folders;
	} catch (err) {
		console.log(err);
		throw newError("getFoldersList", err as Error);
	}
};

/**
 * Download a file from Google Drive
 */
export const getFile = async (
	accessToken: string,
	fileId: string
): Promise<[string, ArrayBuffer]> => {
	try {
		const responseBuffer = await requestUrl({
			url:
				"https://www.googleapis.com/drive/v3/files/" +
				fileId +
				"?alt=media",
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});
		const responseName = await requestUrl({
			url: "https://www.googleapis.com/drive/v3/files/" + fileId,
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});
		return [responseName.json.name, responseBuffer.arrayBuffer];
	} catch (err) {
		console.log(err);
		throw newError("getFile", err as Error);
	}
};

/**
 * Get file metadata from Google Drive
 */
export const getFileInfo = async (
	accessToken: string,
	id: string
): Promise<RequestUrlResponse> => {
	try {
		const response = await requestUrl({
			url: `https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime%2Cname%2Cid%2CmimeType`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		});
		return response;
	} catch (err) {
		console.log(err);
		throw newError("getFileInfo", err as Error);
	}
};
