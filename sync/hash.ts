/**
 * SHA-256 hash calculation utilities
 */

/**
 * Calculate SHA-256 hash of an ArrayBuffer
 */
export async function calculateHash(buffer: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return hashHex;
}

/**
 * Calculate SHA-256 hash of a string (UTF-8 encoded)
 */
export async function calculateHashFromString(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	return calculateHash(data.buffer);
}
