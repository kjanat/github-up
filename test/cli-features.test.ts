import { describe, expect, test } from 'bun:test';
import { execPath } from 'node:process';

import { parseComponentList, parseSourceList, selectedComponents, selectedSources } from '#github-down/cli/flags';
import { nameMatchesComponents, sources } from '#github-down/cli/model';
import type { ComponentKey, Source, StatusRow } from '#github-down/cli/model';
import { filterGitHubByComponents, getExitCode, summarizeExitCode } from '#github-down/cli/status';
import { CHROME_PATH_ENV } from '#github-down/lib/constants';
import { findChrome } from '#github-down/lib/downdetector/chrome';

function githubRow(
	overrides: Partial<Extract<StatusRow, { source: 'github' }>> = {},
): StatusRow {
	return {
		source: 'github',
		indicator: 'major',
		summaryText: 'Partial System Outage',
		incidents: [
			{
				name: 'Actions is experiencing degraded availability',
				status: 'investigating',
			},
		],
		affectedComponents: [
			{
				name: 'Actions',
				status: 'degraded_performance',
			},
		],
		...overrides,
	};
}

const componentFlags = (
	selected: readonly ComponentKey[],
	booleans: Partial<Record<ComponentKey, boolean>> = {},
) => ({
	component: selected.map((key) => [key]),
	actions: false,
	api: false,
	codespaces: false,
	copilot: false,
	git: false,
	issues: false,
	packages: false,
	pages: false,
	pr: false,
	webhooks: false,
	...booleans,
});

describe('selectedComponents', () => {
	test('unions --component array with convenience flags and dedupes', () => {
		expect(
			[
				...selectedComponents(
					componentFlags(['actions'], { pages: true, actions: true }),
				),
			].sort(),
		).toEqual(['actions', 'pages']);
	});

	test('empty when nothing selected', () => {
		expect(selectedComponents(componentFlags([])).size).toBe(0);
	});
});

describe(parseComponentList.name, () => {
	test('splits a comma-separated token and trims whitespace', () => {
		expect(parseComponentList('actions, pr ')).toEqual(['actions', 'pr']);
	});

	test('throws a clear error for an unknown component', () => {
		expect(() => parseComponentList('actions,bogus')).toThrow(
			"Invalid value 'bogus' for flag --component. Allowed: actions, api, codespaces, copilot, git, issues, packages, pages, pr, webhooks",
		);
	});
});

describe(filterGitHubByComponents.name, () => {
	test('keeps matches and derives severity from component statuses', () => {
		const filtered = filterGitHubByComponents(
			githubRow(),
			new Set<ComponentKey>(['actions']),
		);

		// Degraded Actions plus a matched incident is 'minor', not a blanket
		// 'major': matched components carry real statuses.
		expect(filtered).toMatchObject({
			source: 'github',
			indicator: 'minor',
			summaryText: '2 reports affecting actions',
			incidents: [
				{
					name: 'Actions is experiencing degraded availability',
					status: 'investigating',
				},
			],
			affectedComponents: [
				{ name: 'Actions', status: 'degraded_performance' },
			],
		});
	});

	test('promotes to major when a matched component reports an outage', () => {
		const filtered = filterGitHubByComponents(
			githubRow({
				affectedComponents: [{ name: 'Actions', status: 'major_outage' }],
			}),
			new Set<ComponentKey>(['actions']),
		);

		expect(filtered.indicator).toBe('major');
	});

	test('floors at minor when only an incident matches', () => {
		const filtered = filterGitHubByComponents(
			githubRow({ affectedComponents: null }),
			new Set<ComponentKey>(['actions']),
		);

		expect(filtered).toMatchObject({
			indicator: 'minor',
			summaryText: '1 report affecting actions',
			affectedComponents: null,
		});
	});

	test('names only affected components, omitting queried-but-unaffected ones', () => {
		const filtered = filterGitHubByComponents(
			githubRow(),
			new Set<ComponentKey>(['actions', 'pages']),
		);

		expect(filtered.summaryText).toContain('actions');
		expect(filtered.summaryText).not.toContain('pages');
	});

	test('reports operational when nothing mentions the component', () => {
		const filtered = filterGitHubByComponents(
			githubRow({
				incidents: null,
				affectedComponents: [{ name: 'Packages', status: 'major_outage' }],
			}),
			new Set<ComponentKey>(['pages']),
		);

		// 'pages' must not substring-match "Packages".
		expect(filtered).toMatchObject({
			indicator: 'none',
			incidents: null,
			affectedComponents: null,
			summaryText: 'No incidents reported for pages',
		});
	});

	test('word-bounds component matching', () => {
		const git = new Set<ComponentKey>(['git']);
		expect(nameMatchesComponents('Git Operations', git)).toBe(true);
		expect(nameMatchesComponents('GitHub is down', git)).toBe(false);

		const pr = new Set<ComponentKey>(['pr']);
		expect(nameMatchesComponents('Pull Requests', pr)).toBe(true);
		expect(nameMatchesComponents('Degraded pull request merges', pr)).toBe(true);
	});

	test('matches broad multi-service incident names', () => {
		const filtered = filterGitHubByComponents(
			githubRow({
				incidents: [
					{
						name: 'Incident with multiple GitHub services',
						status: 'investigating',
					},
				],
				affectedComponents: null,
			}),
			new Set<ComponentKey>(['pages']),
		);

		expect(filtered).toMatchObject({
			indicator: 'minor',
			summaryText: '1 report affecting pages',
		});
	});

	test('passes through the empty selection unchanged', () => {
		const row = githubRow();
		expect(filterGitHubByComponents(row, new Set<ComponentKey>())).toBe(row);
	});

	test('leaves unavailable rows untouched', () => {
		const row = githubRow({
			indicator: 'unavailable',
			incidents: null,
			affectedComponents: null,
		});
		expect(filterGitHubByComponents(row, new Set<ComponentKey>(['actions'])))
			.toBe(row);
	});

	test('leaves downdetector rows untouched', () => {
		const row: StatusRow = {
			source: 'downdetector',
			indicator: 'major',
			summaryText: 'outage reported',
			reportsOutage: true,
		};
		expect(filterGitHubByComponents(row, new Set<ComponentKey>(['actions'])))
			.toBe(row);
	});
});

describe(parseSourceList.name, () => {
	test('splits a comma-separated token', () => {
		expect(parseSourceList('github,downdetector')).toEqual([
			'github',
			'downdetector',
		]);
	});

	test('throws a clear error for an unknown source', () => {
		expect(() => parseSourceList('github,bogus')).toThrow(
			"Invalid value 'bogus' for flag --source. Allowed: github, downdetector",
		);
	});
});

describe(selectedSources.name, () => {
	test('supports the all-sources default', () => {
		expect(selectedSources([[...sources]])).toEqual([
			'github',
			'downdetector',
		]);
	});

	test('flattens per-occurrence lists', () => {
		const lists: readonly (readonly Source[])[] = [
			['github'],
			['downdetector'],
		];
		expect(selectedSources(lists)).toEqual(['github', 'downdetector']);
	});

	test('dedupes repeated sources so nothing is checked twice', () => {
		const lists: readonly (readonly Source[])[] = [
			['github'],
			['github', 'downdetector'],
		];
		expect(selectedSources(lists)).toEqual(['github', 'downdetector']);
	});
});

describe('getExitCode', () => {
	test('fails when an active incident is present under an operational indicator', () => {
		expect(getExitCode(githubRow({ indicator: 'none' }))).toBe(1);
	});

	test('is zero when operational with no incidents', () => {
		expect(
			getExitCode(githubRow({ indicator: 'none', incidents: null })),
		).toBe(0);
	});

	test('reflects the indicator when it is more severe than an incident', () => {
		expect(getExitCode(githubRow({ indicator: 'major' }))).toBe(2);
	});

	test('reports unavailable downdetector with its dedicated code', () => {
		expect(
			getExitCode({
				source: 'downdetector',
				indicator: 'unavailable',
				summaryText: 'boom',
				reportsOutage: false,
			}),
		).toBe(21);
	});
});

describe(summarizeExitCode.name, () => {
	const unreachableDowndetector: StatusRow = {
		source: 'downdetector',
		indicator: 'unavailable',
		summaryText: 'CF challenge not cleared in time',
		reportsOutage: false,
	};

	test('ignores an unreachable source when another was readable', () => {
		// GitHub operational with no incidents -> 0, despite Downdetector
		// being unavailable (a flaky scrape must not force 21).
		expect(
			summarizeExitCode([
				githubRow({ indicator: 'none', incidents: null }),
				unreachableDowndetector,
			]),
		).toBe(0);
	});

	test('keeps a real outage when another source is unreachable', () => {
		expect(
			summarizeExitCode([
				githubRow({ indicator: 'major' }),
				unreachableDowndetector,
			]),
		).toBe(2);
	});

	test('surfaces 21 only when every source is unreachable', () => {
		expect(
			summarizeExitCode([
				githubRow({
					indicator: 'unavailable',
					incidents: null,
					affectedComponents: null,
				}),
				unreachableDowndetector,
			]),
		).toBe(21);
	});

	test('is zero for no rows', () => {
		expect(summarizeExitCode([])).toBe(0);
	});
});

describe('findChrome override', () => {
	test('uses an explicit path that exists', () => {
		expect(findChrome(execPath)).toBe(execPath);
	});

	test('returns null for an explicit path that does not exist', () => {
		expect(findChrome('/no/such/chrome-binary')).toBeNull();
	});

	test('honors the GITHUB_DOWN_CHROME environment variable', () => {
		const previous = process.env[CHROME_PATH_ENV];
		process.env[CHROME_PATH_ENV] = execPath;
		try {
			expect(findChrome()).toBe(execPath);
		} finally {
			if (previous === undefined) delete process.env[CHROME_PATH_ENV];
			else process.env[CHROME_PATH_ENV] = previous;
		}
	});
});
