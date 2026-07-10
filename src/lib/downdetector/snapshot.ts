import type { CdpSend } from '#github-down/lib/downdetector/cdp';
import { setTimeout } from 'node:timers/promises';

/** Represents the structure of the snapshot taken from the page. */
type PogoSnapshot = {
	/** The page's title. */
	title: string;
	/** The Pogo configuration object, which may indicate an outage. */
	pogo: { outage?: boolean } | null;
	/** The text content of the first <h1> element on the page, or null if it doesn't exist. */
	h1: string | null;
	/** Whether the current page is Cloudflare's managed challenge. */
	cfChallenge?: boolean;
};

type PogoSnapshotResult =
	| { kind: 'status'; pogo: { outage?: boolean }; heading: string | null }
	| { kind: 'cloudflare-challenge' };

type PageEvaluate = (expression: string) => Promise<unknown>;

/** Page-side expression producing a {@linkcode PogoSnapshot}. Exported so the
 * inline worker source in webview.ts (which can't import this module)
 * interpolates this exact expression instead of duplicating it. */
const POGO_SNAPSHOT_EXPRESSION = `({
	title: document.title,
	pogo: window.PogoConfig ?? null,
	h1: document.querySelector('h1')?.innerText ?? null,
	cfChallenge: document.title === 'Just a moment...'
		|| document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]') !== null
		|| document.body?.innerText?.includes('Enable JavaScript and cookies to continue') === true,
})`;

/** Represents the structure of the result returned from evaluating a CDP expression. */
type CdpEvalResult = {
	result: {
		result: {
			/** The string value returned from the CDP evaluation. */
			value: string;
		};
	};
};

/** Type guard to check if a value is a {@linkcode CdpEvalResult} object. */
function isCdpEvalResult(value: unknown): value is CdpEvalResult {
	return (
		value !== null
		&& typeof value === 'object'
		&& 'result' in value
		&& typeof value.result === 'object'
		&& value.result !== null
		&& 'result' in value.result
		&& typeof value.result.result === 'object'
		&& value.result.result !== null
		&& 'value' in value.result.result
		&& typeof value.result.result.value === 'string'
	);
}

/** Type guard to check if a value is a {@linkcode PogoSnapshot} object.
 * @param value - The value to check.
 * @returns `true` if the value is a PogoSnapshot, or `false` otherwise.
 */
function isPogoSnapshot(value: unknown): value is PogoSnapshot {
	if (typeof value !== 'object' || value === null) return false;
	if (!('title' in value) || typeof value.title !== 'string') return false;
	if ('h1' in value && value.h1 !== null && typeof value.h1 !== 'string') {
		return false;
	}
	if (
		'cfChallenge' in value
		&& value.cfChallenge !== undefined
		&& typeof value.cfChallenge !== 'boolean'
	) {
		return false;
	}
	if (!('pogo' in value)) return false;
	const { pogo } = value;

	if (pogo === null) return true;
	if (typeof pogo !== 'object') return false;

	if (
		'outage' in pogo
		&& pogo.outage !== undefined
		&& typeof pogo.outage !== 'boolean'
	) {
		return false;
	}

	return true;
}

/** Polls the page for a snapshot of the Pogo configuration and page heading within a specified timeout.
 * @param send - A function to send CDP commands.
 * @param timeoutMs - The maximum time to wait for a valid snapshot, in milliseconds.
 * @returns A promise that resolves to an object containing the Pogo
 * configuration and page heading if a valid snapshot is found,
 * or `null` if the timeout is reached without finding a valid snapshot.
 */
async function pollPogoSnapshot(
	send: CdpSend,
	timeoutMs: number,
): Promise<PogoSnapshotResult | null> {
	await send('Runtime.enable');

	return pollPogoSnapshotFromEvaluate(async (expression) => {
		const response = await send('Runtime.evaluate', {
			expression: `JSON.stringify(${expression})`,
			returnByValue: true,
		});

		if (!isCdpEvalResult(response)) return null;

		try {
			return JSON.parse(response.result.result.value) as unknown;
		} catch {
			return null;
		}
	}, timeoutMs);
}

async function pollPogoSnapshotFromEvaluate(
	evaluate: PageEvaluate,
	timeoutMs: number,
): Promise<PogoSnapshotResult | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const snapshot = await evaluate(POGO_SNAPSHOT_EXPRESSION);
		if (isPogoSnapshot(snapshot) && snapshot.cfChallenge === true) {
			return { kind: 'cloudflare-challenge' };
		}

		if (isPogoSnapshot(snapshot) && snapshot.pogo !== null) {
			return { kind: 'status', pogo: snapshot.pogo, heading: snapshot.h1 };
		}

		await setTimeout(700);
	}

	return null;
}

/** Matches Downdetector's "possible problems" heading text. Exported so the
 * inline worker-source copy in webview.ts (which can't import this module)
 * interpolates this exact pattern instead of duplicating the regex literal. */
const POSSIBLE_PROBLEMS_PATTERN = /possible problems/i;

/** Downdetector's own "possible problems" heading text, when the page's
 * heading carries that signal despite `pogo.outage` being `false`. */
function detectPossibleProblemsNote(
	heading: string | null,
): string | undefined {
	return heading !== null && POSSIBLE_PROBLEMS_PATTERN.test(heading)
		? heading
		: undefined;
}

export { detectPossibleProblemsNote, POGO_SNAPSHOT_EXPRESSION, pollPogoSnapshot, pollPogoSnapshotFromEvaluate, POSSIBLE_PROBLEMS_PATTERN };
