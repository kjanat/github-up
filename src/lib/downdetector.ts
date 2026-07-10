import { DOWNDETECTOR_URL } from '#github-down/lib/constants';
import { openCdpTarget } from '#github-down/lib/downdetector/cdp';
import { cleanupBrowser, findChrome, launchBrowser } from '#github-down/lib/downdetector/chrome';
import { detectPossibleProblemsNote, pollPogoSnapshot } from '#github-down/lib/downdetector/snapshot';
import { checkDownDetectorWithWebView, hasBunWebView } from '#github-down/lib/downdetector/webview';
import type { Signal } from '#github-down/lib/types';

/** Checks the status of GitHub on Downdetector.
 *
 * Launches a headless Chromium browser, navigates to the Downdetector status
 * page for GitHub, and polls for the presence of a "Pogo Snapshot" element
 * that indicates whether there is an outage.
 *
 * If an outage is detected, it extracts the reason from the page.
 *
 * @param chromePath Optional explicit Chrome/Chromium binary to use.
 * @returns A promise of {@linkcode Signal}.
 * @see {@link https://downdetector.com/status/github/} for the target page.
 */
async function check(chromePath?: string): Promise<Signal> {
	// A Bun runtime without WebView support (older Bun) falls through to the
	// CDP path below, which works fine under Bun when a Chromium exists.
	if (hasBunWebView()) {
		return checkDownDetectorWithWebView(DOWNDETECTOR_URL, chromePath);
	}

	const chrome = findChrome(chromePath);
	if (chrome === null) {
		return {
			ok: false,
			error: 'no Chrome/Chromium found; set GITHUB_DOWN_CHROME or pass --chrome <path>',
		};
	}

	const launched = await launchBrowser(chrome);
	if (!launched.ok) {
		return launched;
	}

	const {
		browser: { proc, userDataDir, base },
	} = launched;

	try {
		const target = await openCdpTarget(base, DOWNDETECTOR_URL);
		if (!target.ok) {
			return target;
		}

		const result = await pollPogoSnapshot(target.send, 20000);
		target.close();

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
		cleanupBrowser(proc, userDataDir);
	}
}

export { check as checkDownDetector, check as default };
