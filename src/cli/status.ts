import { type ComponentKey, componentsNamedInText, nameMatchesComponents, nameMatchesManyComponents } from '#github-down/cli/model';
import type { Source, StatusRow } from '#github-down/cli/model';
import { EXIT_CODES } from '#github-down/lib/constants';
import { checkDownDetector } from '#github-down/lib/downdetector';
import { checkGitHub } from '#github-down/lib/github';
import { componentsImpact, deriveConservativeIndicator, describeIndicator, higherImpact } from '#github-down/lib/severity';
import type { ComponentStatus } from '#github-down/lib/types';

function normalizeComponentStatus(value: string): ComponentStatus {
	if (
		value === 'operational'
		|| value === 'degraded_performance'
		|| value === 'partial_outage'
		|| value === 'major_outage'
		|| value === 'under_maintenance'
	) {
		return value;
	}

	return 'major_outage';
}

async function checkGitHubSource(
	githubStatusBase: string | URL,
): Promise<StatusRow> {
	const result = await checkGitHub(githubStatusBase);
	if (result.kind === 'unknown') {
		return {
			source: 'github',
			indicator: 'unavailable',
			summaryText: result.reason,
			incidents: null,
			affectedComponents: null,
		};
	}

	const reportedIndicator = result.summary.status.indicator;
	const indicator = deriveConservativeIndicator(
		reportedIndicator,
		result.summary.components,
	);
	const summaryText = indicator === reportedIndicator
		? result.summary.status.description
		: `${describeIndicator(indicator)} (reported ${String(reportedIndicator)})`;
	const affectedComponents = result.summary.components.filter(
		(component) => component.status !== 'operational',
	);

	return {
		source: 'github',
		indicator,
		summaryText,
		incidents: result.summary.incidents.length > 0
			? result.summary.incidents.map((incident) => ({
				name: incident.name,
				status: incident.status,
			}))
			: null,
		affectedComponents: affectedComponents.length > 0
			? affectedComponents.map((component) => ({
				name: component.name,
				status: normalizeComponentStatus(component.status),
			}))
			: null,
	};
}

async function checkDowndetectorSource(
	chromePath?: string,
): Promise<StatusRow> {
	const result = await checkDownDetector(chromePath);
	if (!result.ok) {
		return {
			source: 'downdetector',
			indicator: 'unavailable',
			summaryText: result.error,
			reportsOutage: false,
		};
	}

	if (result.down) {
		return {
			source: 'downdetector',
			indicator: 'major',
			summaryText: result.reason,
			reportsOutage: true,
		};
	}

	return {
		source: 'downdetector',
		indicator: result.note !== undefined ? 'minor' : 'none',
		summaryText: result.note ?? null,
		reportsOutage: false,
	};
}

async function checkSource(
	source: Source,
	githubStatusBase: string | URL,
	chromePath?: string,
): Promise<StatusRow> {
	switch (source) {
		case 'github':
			return checkGitHubSource(githubStatusBase);
		case 'downdetector':
			return checkDowndetectorSource(chromePath);
	}
}

async function checkSources(
	sources: readonly Source[],
	githubStatusBase: string | URL,
	chromePath?: string,
): Promise<readonly StatusRow[]> {
	return Promise.all(
		sources.map((source) => checkSource(source, githubStatusBase, chromePath)),
	);
}

function addComponentsNamedInItems(
	affected: Set<ComponentKey>,
	items: readonly { name: string }[],
	selected: ReadonlySet<ComponentKey>,
): boolean {
	let hasBroadMatch = false;

	for (const item of items) {
		if (nameMatchesManyComponents(item.name)) hasBroadMatch = true;
		for (const key of componentsNamedInText(item.name, selected)) {
			affected.add(key);
		}
	}

	return hasBroadMatch;
}

function matchedComponentKeys(
	incidents: readonly { name: string }[],
	affectedComponents: readonly { name: string }[],
	selected: ReadonlySet<ComponentKey>,
): ComponentKey[] {
	const affected = new Set<ComponentKey>();
	const broadFromIncidents = addComponentsNamedInItems(affected, incidents, selected);
	const broadFromComponents = addComponentsNamedInItems(affected, affectedComponents, selected);

	if (broadFromIncidents || broadFromComponents) {
		for (const key of selected) affected.add(key);
	}

	return [...selected].filter((key) => affected.has(key));
}

/**
 * Narrows a GitHub row to incidents/components naming the selected components
 * and re-derives its result from those matches (operational when none match).
 * Other rows, unavailable rows, and the empty selection pass through unchanged.
 */
function filterGitHubByComponents(
	row: StatusRow,
	selected: ReadonlySet<ComponentKey>,
): StatusRow {
	if (
		row.source !== 'github'
		|| selected.size === 0
		|| row.indicator === 'unavailable'
	) {
		return row;
	}

	const incidents = row.incidents?.filter((incident) => nameMatchesComponents(incident.name, selected))
		?? [];
	const affectedComponents = row.affectedComponents?.filter((component) => nameMatchesComponents(component.name, selected)) ?? [];

	const matchCount = incidents.length + affectedComponents.length;
	// Only name the components that actually appear in a matched
	// incident/component — not every queried one — so `--actions --pages`
	// reports just Actions when Pages is unaffected. Broad incidents like
	// "multiple GitHub services" affect all queried components.
	const affectedKeys = matchedComponentKeys(incidents, affectedComponents, selected);

	// Matched components carry real statuses, so severity derives from them
	// (degraded Actions must not read as a major outage). A matched incident
	// alone still means something is wrong, hence the 'minor' floor.
	const componentIndicator = componentsImpact(affectedComponents);
	const indicator = incidents.length > 0
		? higherImpact(componentIndicator, 'minor')
		: componentIndicator;

	return {
		source: 'github',
		indicator,
		summaryText: matchCount > 0
			? `${matchCount} report${matchCount === 1 ? '' : 's'} affecting ${affectedKeys.join(', ')}`
			: `No incidents reported for ${[...selected].join(', ')}`,
		incidents: incidents.length > 0 ? incidents : null,
		affectedComponents: affectedComponents.length > 0
			? affectedComponents
			: null,
	};
}

function getExitCode(row: StatusRow): number {
	const code = EXIT_CODES[row.indicator];
	// An active incident is a failure even when the page indicator reads operational.
	if (row.source === 'github' && row.incidents && row.incidents.length > 0) {
		return Math.max(code, EXIT_CODES.minor);
	}

	return code;
}

function summarizeExitCode(rows: readonly StatusRow[]): number {
	const reachable = rows.filter((row) => row.indicator !== 'unavailable');
	// A source we couldn't reach is "unknown", not "down": its code only counts
	// when every source was unreachable, so a flaky Downdetector scrape doesn't
	// mask an otherwise-operational result.
	if (reachable.length === 0) {
		return rows.length === 0 ? EXIT_CODES.none : EXIT_CODES.unavailable;
	}

	return reachable.reduce<number>(
		(max, row) => Math.max(max, getExitCode(row)),
		EXIT_CODES.none,
	);
}

function sortRows(rows: readonly StatusRow[]): StatusRow[] {
	return [...rows].sort((left, right) => left.source.localeCompare(right.source));
}

export { checkDowndetectorSource, checkGitHubSource, checkSource, checkSources, filterGitHubByComponents, getExitCode, sortRows, summarizeExitCode };
