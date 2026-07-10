import { describe, expect, test } from 'bun:test';

import { cssToken, escapeHtml, fmt, getErrorMessage, getString, isRecord } from '#demo/util';

describe('demo utilities', () => {
	test('escapes text for HTML rendering', () => {
		expect(escapeHtml(`<tag attr="x">A & B's</tag>`)).toBe(
			'&lt;tag attr=&quot;x&quot;&gt;A &amp; B&#39;s&lt;/tag&gt;',
		);
	});

	test('normalizes strings for CSS token use', () => {
		expect(cssToken('status:critical / degraded')).toBe(
			'statuscriticaldegraded',
		);
	});

	test('reads strings and records conservatively', () => {
		expect(getString('ok', 'fallback')).toBe('ok');
		expect(getString(42, 'fallback')).toBe('fallback');
		expect(isRecord({})).toBe(true);
		expect(isRecord(null)).toBe(false);
		expect(isRecord([])).toBe(false);
	});

	test('formats errors and dates', () => {
		expect(getErrorMessage(new Error('boom'))).toBe('boom');
		expect(getErrorMessage('plain')).toBe('plain');
		expect(fmt('2026-06-22T00:00:00.000Z')).toBe(
			new Date('2026-06-22T00:00:00.000Z').toLocaleString(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short',
			}),
		);
	});
});
