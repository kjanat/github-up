import { GITHUB_STATUS_BASE } from '#github-down/lib/constants';
import { StatusAPIEndpoints } from '#github-down/lib/github/endpoints';
import type { Result, Summary } from '#github-down/lib/types';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNamedStatusItem(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.name === 'string'
		&& typeof value.status === 'string';
}

function isStatus(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.indicator === 'string'
		&& typeof value.description === 'string';
}

function isIncident(value: unknown): boolean {
	return isNamedStatusItem(value)
		&& isRecord(value)
		&& typeof value.impact === 'string';
}

/** Structural check for the parts of a Statuspage summary this package reads
 * or re-exports (`status`, `components`, `incidents`), so a 200 from a proxy
 * or captive portal degrades to `unknown` instead of producing a wrong row or
 * crashing downstream. */
function isSummary(value: unknown): value is Summary {
	return isRecord(value)
		&& isStatus(value.status)
		&& Array.isArray(value.components)
		&& value.components.every(isNamedStatusItem)
		&& Array.isArray(value.incidents)
		&& value.incidents.every(isIncident);
}

async function getErrorReason(response: Response): Promise<string> {
	try {
		const body = await response.text();
		const message = body.length > 0 ? `: ${body}` : '';
		return `Request failed with status code ${response.status}${message}`;
	} catch {
		const { status, statusText } = response;
		return `Request failed with status code ${status}: ${statusText}`;
	}
}

/** Checks the status of GitHub's services by querying their Statuspage API.
 *
 * @param baseUrl - Optional base URL for the GitHub Statuspage API.
 * @returns A promise that resolves to a Result object containing either the summary of the status or an error reason.
 */
async function check(
	baseUrl: string | URL = GITHUB_STATUS_BASE,
): Promise<Result> {
	try {
		const response = await fetch(
			new URL(StatusAPIEndpoints.summary(), baseUrl),
		);
		if (!response.ok) {
			const { headers } = response;
			return {
				headers,
				kind: 'unknown',
				reason: await getErrorReason(response),
			};
		}
		const parsed: unknown = await response.json();
		if (!isSummary(parsed)) {
			return {
				headers: response.headers,
				kind: 'unknown',
				reason: 'unexpected response shape from status API',
			};
		}
		return { headers: response.headers, kind: 'ok', summary: parsed };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { kind: 'unknown', reason: msg };
	}
}

export { check as checkGitHub, check as default };
