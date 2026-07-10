import { CHROME_PATH_ENV } from '#github-down/lib/constants';
import {
	detectPossibleProblemsNote,
	POGO_SNAPSHOT_EXPRESSION,
	pollPogoSnapshotFromEvaluate,
	POSSIBLE_PROBLEMS_PATTERN,
} from '#github-down/lib/downdetector/snapshot';
import type { Signal } from '#github-down/lib/types';
import { setTimeout as sleep } from 'node:timers/promises';

type WebViewBackend =
	| 'chrome'
	| 'webkit'
	| {
		type: 'chrome';
		path?: string;
		url?: false;
		argv?: readonly string[];
	};

type WebViewOptions = {
	width?: number;
	height?: number;
	backend?: WebViewBackend;
};

type WebView = {
	navigate(url: string): Promise<void>;
	evaluate(expression: string): Promise<unknown>;
	close(): void;
};

type WebViewConstructor = new(options?: WebViewOptions) => WebView;

type BunGlobal = {
	WebView?: unknown;
};

type WebViewWorkerMessage =
	| { type: 'result'; result: Signal }
	| { type: 'error'; error: string };

const WEBVIEW_WIDTH = 1920;
const WEBVIEW_HEIGHT = 1080;
const WEBVIEW_SNAPSHOT_TIMEOUT_MS = 20000;
/** Budget for `view.navigate()`, which runs before the snapshot poll starts. */
const WEBVIEW_NAVIGATION_TIMEOUT_MS = 20000;
/** The worker supervises navigation plus the whole snapshot poll, so its
 * deadline must outlast both budgets combined or a slow navigation eats into
 * the poll and every slow Cloudflare challenge dies as a worker timeout. */
const WEBVIEW_WORKER_TIMEOUT_MS = WEBVIEW_NAVIGATION_TIMEOUT_MS + WEBVIEW_SNAPSHOT_TIMEOUT_MS + 5000;
const CHROME_ARGV = [
	'--headless=new',
	'--disable-gpu',
	'--no-sandbox',
	'--disable-blink-features=AutomationControlled',
	'--window-size=1920,1080',
	'--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
] as const;

const WEBVIEW_WORKER_SOURCE = `
const WEBVIEW_WIDTH = ${WEBVIEW_WIDTH};
const WEBVIEW_HEIGHT = ${WEBVIEW_HEIGHT};
const SNAPSHOT_TIMEOUT_MS = ${WEBVIEW_SNAPSHOT_TIMEOUT_MS};
const POLL_INTERVAL_MS = 700;
const CHROME_ARGV = ${JSON.stringify(CHROME_ARGV)};
const POSSIBLE_PROBLEMS_PATTERN = ${POSSIBLE_PROBLEMS_PATTERN};
${detectPossibleProblemsNote.toString()}

function webViewOptions(chromePath) {
	if (chromePath || process.platform !== 'darwin') {
		return {
			width: WEBVIEW_WIDTH,
			height: WEBVIEW_HEIGHT,
			backend: {
				type: 'chrome',
				url: false,
				argv: CHROME_ARGV,
				...(chromePath ? { path: chromePath } : {}),
			},
		};
	}

	return { width: WEBVIEW_WIDTH, height: WEBVIEW_HEIGHT };
}

function isPogoSnapshot(value) {
	if (typeof value !== 'object' || value === null) return false;
	if (!('title' in value) || typeof value.title !== 'string') return false;
	if ('h1' in value && value.h1 !== null && typeof value.h1 !== 'string') return false;
	if ('cfChallenge' in value && value.cfChallenge !== undefined && typeof value.cfChallenge !== 'boolean') return false;
	if (!('pogo' in value)) return false;
	const { pogo } = value;
	if (pogo === null) return true;
	if (typeof pogo !== 'object') return false;
	return !('outage' in pogo) || pogo.outage === undefined || typeof pogo.outage === 'boolean';
}

async function pollPogoSnapshot(view) {
	const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const snapshot = await view.evaluate(${JSON.stringify(POGO_SNAPSHOT_EXPRESSION)}).catch(() => null);
		if (isPogoSnapshot(snapshot) && snapshot.cfChallenge === true) {
			return { kind: 'cloudflare-challenge' };
		}

		if (
			isPogoSnapshot(snapshot)
			&& snapshot.pogo !== null
		) {
			return { kind: 'status', pogo: snapshot.pogo, heading: snapshot.h1 };
		}

		await Bun.sleep(POLL_INTERVAL_MS);
	}

	return null;
}

async function check(url, chromePath) {
	const WebView = globalThis.Bun?.WebView;
	if (typeof WebView !== 'function') {
		return { ok: false, error: 'Bun.WebView is unavailable; upgrade Bun or run with Node' };
	}

	let view;
	try {
		view = new WebView(webViewOptions(chromePath));
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	try {
		await view.navigate(url);
		const result = await pollPogoSnapshot(view);
		if (result === null) return { ok: false, error: 'CF challenge not cleared in time' };
		if (result.kind === 'cloudflare-challenge') return { ok: false, error: 'Cloudflare challenge page' };
		if (result.pogo.outage === true) {
			return { ok: true, down: true, reason: result.heading ?? 'outage reported' };
		}
		const note = detectPossibleProblemsNote(result.heading);
		if (note !== undefined) {
			return { ok: true, down: false, note };
		}
		return { ok: true, down: false };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		view?.close();
	}
}

self.onmessage = async (event) => {
	try {
		const { url, chromePath } = event.data;
		self.postMessage({ type: 'result', result: await check(url, chromePath) });
	} catch (error) {
		self.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
`;

function getBunGlobal(): BunGlobal | null {
	const value = (globalThis as typeof globalThis & { Bun?: BunGlobal }).Bun;
	return value === undefined ? null : value;
}

function getBunWebView(): WebViewConstructor | null {
	const WebView = getBunGlobal()?.WebView;
	return typeof WebView === 'function' ? (WebView as WebViewConstructor) : null;
}

function isBunRuntime(): boolean {
	return getBunGlobal() !== null;
}

/** Whether this runtime exposes `Bun.WebView`; callers without it should fall
 * back to the CDP path instead of failing outright. */
function hasBunWebView(): boolean {
	return getBunWebView() !== null;
}

function webViewOptions(chromePath?: string): WebViewOptions {
	const chromeOverride = chromePath ?? process.env[CHROME_PATH_ENV];
	if (chromeOverride) {
		return {
			width: WEBVIEW_WIDTH,
			height: WEBVIEW_HEIGHT,
			backend: {
				type: 'chrome',
				path: chromeOverride,
				url: false,
				argv: CHROME_ARGV,
			},
		};
	}

	if (process.platform !== 'darwin') {
		return {
			width: WEBVIEW_WIDTH,
			height: WEBVIEW_HEIGHT,
			backend: { type: 'chrome', url: false, argv: CHROME_ARGV },
		};
	}

	return { width: WEBVIEW_WIDTH, height: WEBVIEW_HEIGHT };
}

async function checkWithWebView(
	WebView: WebViewConstructor,
	url: string,
	chromePath?: string,
): Promise<Signal> {
	let view: WebView;
	try {
		view = new WebView(webViewOptions(chromePath));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}

	try {
		await view.navigate(url);
		const result = await pollPogoSnapshotFromEvaluate(
			(expression) => view.evaluate(expression),
			WEBVIEW_SNAPSHOT_TIMEOUT_MS,
		);

		if (result === null) {
			return { ok: false, error: 'CF challenge not cleared in time' };
		}
		if (result.kind === 'cloudflare-challenge') {
			return { ok: false, error: 'Cloudflare challenge page' };
		}

		if (result.pogo.outage === true) {
			return {
				ok: true,
				down: true,
				reason: result.heading ?? 'outage reported',
			};
		}

		const note = detectPossibleProblemsNote(result.heading);
		if (note !== undefined) {
			return { ok: true, down: false, note };
		}

		return { ok: true, down: false };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	} finally {
		view.close();
	}
}

function createWebViewWorker(): Worker {
	const workerUrl = URL.createObjectURL(
		new Blob([WEBVIEW_WORKER_SOURCE], { type: 'text/javascript' }),
	);

	return new Worker(workerUrl, { type: 'module' });
}

async function checkWithWebViewWorker(
	url: string,
	chromePath?: string,
	timeoutMs = WEBVIEW_WORKER_TIMEOUT_MS,
): Promise<Signal> {
	let worker: Worker;
	try {
		worker = createWebViewWorker();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}

	try {
		return await new Promise<Signal>((resolve) => {
			const timer = setTimeout(() => {
				void worker.terminate();
				resolve({ ok: false, error: 'Bun.WebView timed out' });
			}, timeoutMs);

			worker.onmessage = (event: MessageEvent<WebViewWorkerMessage>) => {
				clearTimeout(timer);
				void worker.terminate();

				const message = event.data;
				if (message.type === 'result') {
					resolve(message.result);
					return;
				}

				resolve({ ok: false, error: message.error });
			};

			worker.onerror = (event) => {
				clearTimeout(timer);
				void worker.terminate();
				resolve({ ok: false, error: event.message });
			};

			worker.postMessage({ url, chromePath });
		});
	} finally {
		await sleep(0);
	}
}

async function checkDownDetectorWithWebView(
	url: string,
	chromePath?: string,
): Promise<Signal> {
	const WebView = getBunWebView();
	if (WebView === null) {
		return {
			ok: false,
			error: 'Bun.WebView is unavailable; upgrade Bun or run with Node',
		};
	}

	// The worker's inlined `webViewOptions` copy has no access to this module,
	// so the env override must be resolved before crossing the postMessage
	// boundary.
	return checkWithWebViewWorker(url, chromePath ?? process.env[CHROME_PATH_ENV]);
}

export { checkDownDetectorWithWebView, checkWithWebView, checkWithWebViewWorker, hasBunWebView, isBunRuntime };
export type { WebView, WebViewConstructor };
