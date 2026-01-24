import { describe, it, expect } from 'vitest';
import { computeLineDiff, DiffLine } from '../sync/dialogs';

describe('computeLineDiff', () => {
	it('should return unchanged lines when texts are identical', () => {
		const text = 'Line 1\nLine 2\nLine 3';
		const result = computeLineDiff(text, text);

		expect(result).toHaveLength(3);
		expect(result.every(line => line.type === 'unchanged')).toBe(true);
		expect(result.map(line => line.content)).toEqual(['Line 1', 'Line 2', 'Line 3']);
	});

	it('should detect added lines', () => {
		const oldText = 'Line 1\nLine 3';
		const newText = 'Line 1\nLine 2\nLine 3';
		const result = computeLineDiff(oldText, newText);

		const added = result.filter(line => line.type === 'added');
		expect(added).toHaveLength(1);
		expect(added[0].content).toBe('Line 2');
	});

	it('should detect removed lines', () => {
		const oldText = 'Line 1\nLine 2\nLine 3';
		const newText = 'Line 1\nLine 3';
		const result = computeLineDiff(oldText, newText);

		const removed = result.filter(line => line.type === 'removed');
		expect(removed).toHaveLength(1);
		expect(removed[0].content).toBe('Line 2');
	});

	it('should detect modified lines as remove+add', () => {
		const oldText = 'Line 1\nOld content\nLine 3';
		const newText = 'Line 1\nNew content\nLine 3';
		const result = computeLineDiff(oldText, newText);

		const removed = result.filter(line => line.type === 'removed');
		const added = result.filter(line => line.type === 'added');

		expect(removed).toHaveLength(1);
		expect(removed[0].content).toBe('Old content');
		expect(added).toHaveLength(1);
		expect(added[0].content).toBe('New content');
	});

	it('should handle empty old text', () => {
		const oldText = '';
		const newText = 'Line 1\nLine 2';
		const result = computeLineDiff(oldText, newText);

		// Empty string splits to [''], so we get one removed empty line
		const added = result.filter(line => line.type === 'added');
		expect(added.map(line => line.content)).toContain('Line 1');
		expect(added.map(line => line.content)).toContain('Line 2');
	});

	it('should handle empty new text', () => {
		const oldText = 'Line 1\nLine 2';
		const newText = '';
		const result = computeLineDiff(oldText, newText);

		const removed = result.filter(line => line.type === 'removed');
		expect(removed.map(line => line.content)).toContain('Line 1');
		expect(removed.map(line => line.content)).toContain('Line 2');
	});

	it('should handle multiple changes throughout the text', () => {
		const oldText = 'Header\nOld line 1\nMiddle\nOld line 2\nFooter';
		const newText = 'Header\nNew line 1\nMiddle\nNew line 2\nFooter';
		const result = computeLineDiff(oldText, newText);

		const unchanged = result.filter(line => line.type === 'unchanged');
		const removed = result.filter(line => line.type === 'removed');
		const added = result.filter(line => line.type === 'added');

		expect(unchanged.map(line => line.content)).toContain('Header');
		expect(unchanged.map(line => line.content)).toContain('Middle');
		expect(unchanged.map(line => line.content)).toContain('Footer');
		expect(removed.map(line => line.content)).toContain('Old line 1');
		expect(removed.map(line => line.content)).toContain('Old line 2');
		expect(added.map(line => line.content)).toContain('New line 1');
		expect(added.map(line => line.content)).toContain('New line 2');
	});

	it('should preserve line order', () => {
		const oldText = 'A\nB\nC';
		const newText = 'A\nX\nC';
		const result = computeLineDiff(oldText, newText);

		// Find the indices
		const aIndex = result.findIndex(line => line.content === 'A');
		const bIndex = result.findIndex(line => line.content === 'B');
		const xIndex = result.findIndex(line => line.content === 'X');
		const cIndex = result.findIndex(line => line.content === 'C');

		expect(aIndex).toBeLessThan(bIndex);
		expect(bIndex).toBeLessThan(xIndex);
		expect(xIndex).toBeLessThan(cIndex);
	});

	it('should handle single line texts', () => {
		const oldText = 'Old';
		const newText = 'New';
		const result = computeLineDiff(oldText, newText);

		expect(result).toHaveLength(2);
		expect(result.find(line => line.type === 'removed')?.content).toBe('Old');
		expect(result.find(line => line.type === 'added')?.content).toBe('New');
	});

	it('should handle markdown content', () => {
		const oldText = '# Title\n\n- Item 1\n- Item 2';
		const newText = '# Title\n\n- Item 1\n- Item 2\n- Item 3';
		const result = computeLineDiff(oldText, newText);

		const added = result.filter(line => line.type === 'added');
		expect(added).toHaveLength(1);
		expect(added[0].content).toBe('- Item 3');
	});
});
