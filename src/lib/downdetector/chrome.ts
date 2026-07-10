import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
	BROWSER_CANDIDATES,
	BROWSER_CANDIDATES_WIN,
	CHROME_PATH_ENV,
	MACOS_CHROME_PATHS,
	WINDOWS_CHROME_ROOT_ENV_VARS,
	WINDOWS_CHROME_SUFFIX_SEGMENTS,
} from '#github-down/lib/constants';

/** Represents a launched headless browser instance. */
type LaunchedBrowser = {
	/** The child process of the launched browser. */
	proc: ChildProcess;
	/** The temporary user data directory used by the browser. */
	userDataDir: string;
	/** The base URL for the browser's CDP endpoint (e.g., `'http://localhost:9222'`). */
	base: string;
};

/** Represents the result of attempting to launch a browser, including success or failure information. */
type LaunchBrowserResult =
	| { ok: true; browser: LaunchedBrowser }
	| { ok: false; error: string };

/** Resolves an executable name against `$PATH` using the platform's lookup tool. */
function lookupOnPath(tool: string, names: readonly string[]): string | null {
	for (const name of names) {
		const result = spawnSync(tool, [name]);
		if (result.status === 0 && result.stdout) {
			// `where.exe` may return several lines; the first hit wins.
			const first = result.stdout.toString().split(/\r?\n/)[0]?.trim();
			if (first) return first;
		}
	}

	return null;
}

/** Returns the first path in `candidates` that exists on disk, or null. */
function firstExisting(candidates: readonly string[]): string | null {
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate;
	}

	return null;
}

/** Builds the default Windows install paths from the program-files style env roots. */
function windowsInstallPaths(): string[] {
	const paths: string[] = [];
	for (const rootVar of WINDOWS_CHROME_ROOT_ENV_VARS) {
		const root = process.env[rootVar];
		if (!root) continue;
		for (const segments of WINDOWS_CHROME_SUFFIX_SEGMENTS) {
			paths.push(win32.join(root, ...segments));
		}
	}

	return paths;
}

/**
 * Locates a Chromium-family executable.
 *
 * Resolution order: explicit `chromePath` argument, then the
 * {@link CHROME_PATH_ENV} environment variable, then platform discovery
 * (`where.exe` + default install dirs on Windows, `which` + app bundles on
 * macOS, `which` elsewhere).
 */
function findChrome(chromePath?: string): string | null {
	const override = chromePath ?? process.env[CHROME_PATH_ENV];
	if (override) {
		return existsSync(override) ? override : null;
	}

	if (process.platform === 'win32') {
		return (
			lookupOnPath('where.exe', BROWSER_CANDIDATES_WIN)
				?? firstExisting(windowsInstallPaths())
		);
	}

	if (process.platform === 'darwin') {
		return (
			lookupOnPath('which', BROWSER_CANDIDATES)
				?? firstExisting(MACOS_CHROME_PATHS)
		);
	}

	return lookupOnPath('which', BROWSER_CANDIDATES);
}

/** Waits for the Chrome DevTools Protocol (CDP) endpoint to become available at the specified base URL within a given timeout.
 *
 * @param base - The base URL of the CDP endpoint, e.g., `'http://localhost:9222'`.
 * @param timeoutMs - The maximum time to wait for the CDP endpoint to become available, in milliseconds.
 * @returns A promise that resolves to `true` if the CDP endpoint became available within the timeout, or `false` if it did not.
 */
async function waitForCdp(base: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${base}/json/version`);
			if (response.ok) return true;
		} catch {
			// retry until deadline
		}

		await sleep(100);
	}

	return false;
}

/** Reads the CDP port Chrome chose from the `DevToolsActivePort` file it
 * writes into the user data dir when launched with `--remote-debugging-port=0`
 * (letting the OS pick a free port instead of racing other processes for a
 * hardcoded one).
 *
 * @param userDataDir - The temporary user data directory passed to Chrome.
 * @param timeoutMs - The maximum time to wait for Chrome to write the file, in milliseconds.
 * @returns A promise that resolves to the port number, or `null` if the file never appeared.
 */
async function readDevToolsPort(
	userDataDir: string,
	timeoutMs: number,
): Promise<number | null> {
	// biome-ignore lint/security/noSecrets: Chrome's well-known port-file name, not a secret
	const portFile = join(userDataDir, 'DevToolsActivePort');
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const firstLine = readFileSync(portFile, 'utf8').split('\n')[0]?.trim();
			const port = Number(firstLine);
			if (Number.isInteger(port) && port > 0) return port;
		} catch {
			// not written yet; retry until deadline
		}

		await sleep(100);
	}

	return null;
}

/** Launches a headless Chrome browser with a temporary user data directory and remote debugging enabled.
 *
 * @param chrome - The path to the Chrome executable to launch.
 * @returns A promise that resolves to a `LaunchBrowserResult` indicating success or failure, including the launched browser instance on success or an error message on failure.
 */
async function launchBrowser(chrome: string): Promise<LaunchBrowserResult> {
	let userDataDir: string;
	try {
		userDataDir = mkdtempSync(join(tmpdir(), 'github-down-'));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `mkdtemp failed: ${message}` };
	}

	const proc = spawn(
		chrome,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--disable-blink-features=AutomationControlled',
			'--window-size=1920,1080',
			`--user-data-dir=${userDataDir}`,
			'--remote-debugging-port=0',
			'--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
			'about:blank',
		],
		{ stdio: 'ignore' },
	);
	// A failed exec (e.g. ENOENT/EACCES) or an early exit must surface its own
	// message immediately, not burn the port-file wait and report a generic
	// CDP timeout. The listener also keeps the 'error' event from crashing the
	// process unhandled.
	const launchFailure = new Promise<{ failed: string }>((resolve) => {
		proc.once('error', (error) => resolve({ failed: error.message }));
		proc.once('exit', (code, signal) =>
			resolve({
				failed: `Chrome exited before CDP came up (${signal ?? code ?? 'unknown'})`,
			}));
	});

	const outcome = await Promise.race([
		readDevToolsPort(userDataDir, 5000),
		launchFailure,
	]);
	if (typeof outcome !== 'number') {
		cleanupBrowser(proc, userDataDir);
		return {
			ok: false,
			error: outcome === null
				? 'CDP endpoint never came up'
				: `Chrome launch failed: ${outcome.failed}`,
		};
	}

	const base = `http://localhost:${outcome}`;
	if (!(await waitForCdp(base, 5000))) {
		cleanupBrowser(proc, userDataDir);
		return { ok: false, error: 'CDP endpoint never came up' };
	}

	return { ok: true, browser: { proc, userDataDir, base } };
}

/** Cleans up a launched browser instance by killing the process and removing the temporary user data directory.
 *
 * @param proc - The child process of the launched browser to kill.
 * @param userDataDir - The path to the temporary user data directory to remove.
 */
function cleanupBrowser(proc: ChildProcess, userDataDir: string): void {
	// `proc.kill()` only signals the parent. On Windows, Chrome's child
	// processes keep handles on the user-data-dir, so we kill the whole tree
	// (taskkill /t) to release the locks before removing the directory.
	if (process.platform === 'win32' && proc.pid !== undefined) {
		spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f']);
	} else {
		proc.kill();
	}

	try {
		rmSync(userDataDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	} catch {
		// Best-effort: a lingering Windows lock can keep the temp dir around.
		// It lives under the OS temp dir and gets reaped later; a failed
		// cleanup must never mask or replace the actual status result.
	}
}

export { cleanupBrowser, findChrome, launchBrowser };
export type { LaunchedBrowser };
