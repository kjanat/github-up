import type { ComponentStatus, IncidentStatusValue, Indicator } from '#github-down/lib/types';

const sources = ['github', 'downdetector'] as const;

type Source = (typeof sources)[number];

const sourceLabels = {
	github: 'GitHub',
	downdetector: 'Downdetector',
} as const satisfies Record<Source, string>;

/** GitHub status-page components that incident/component names can be
 * filtered against. */
const componentKeys = [
	'actions',
	'api',
	'codespaces',
	'copilot',
	'git',
	'issues',
	'packages',
	'pages',
	'pr',
	'webhooks',
] as const;

type ComponentKey = (typeof componentKeys)[number];

/** Word-bounded patterns per key: naive substring matching would let `pages`
 * hit "Packages" and `git` hit "GitHub". */
const componentPatterns = {
	actions: /\bactions\b/i,
	api: /\bapi\b/i,
	codespaces: /\bcodespaces\b/i,
	copilot: /\bcopilot\b/i,
	git: /\bgit\b/i,
	issues: /\bissues\b/i,
	packages: /\bpackages\b/i,
	pages: /\bpages\b/i,
	pr: /\bpull requests?\b/i,
	webhooks: /\bwebhooks?\b/i,
} as const satisfies Record<ComponentKey, RegExp>;

const broadComponentMessagePattern = /\b(?:all|many|most|multiple|several|some|various)\s+(?:github\s+)?(?:components|services|systems)\b/i;

/** Case-insensitive check for broad incidents like "multiple GitHub services". */
function nameMatchesManyComponents(name: string): boolean {
	return broadComponentMessagePattern.test(name);
}

/** List of selected components directly named in text. */
function componentsNamedInText(
	name: string,
	selected: ReadonlySet<ComponentKey>,
): ComponentKey[] {
	const matched: ComponentKey[] = [];

	for (const key of selected) {
		if (componentPatterns[key].test(name)) matched.push(key);
	}

	return matched;
}

/** Whether a name mentions selected components (or broad multi-service wording). */
function nameMatchesComponents(
	name: string,
	selected: ReadonlySet<ComponentKey>,
): boolean {
	return (
		selected.size > 0
		&& (componentsNamedInText(name, selected).length > 0
			|| nameMatchesManyComponents(name))
	);
}

type IncidentSummary = Readonly<{
	name: string;
	status: IncidentStatusValue;
}>;

type AffectedComponent = Readonly<{
	name: string;
	status: ComponentStatus;
}>;

type GitHubStatusRow = Readonly<{
	source: 'github';
	indicator: Indicator;
	summaryText: string | null;
	incidents: readonly IncidentSummary[] | null;
	affectedComponents: readonly AffectedComponent[] | null;
}>;

type DowndetectorStatusRow = Readonly<{
	source: 'downdetector';
	indicator: Extract<Indicator, 'none' | 'minor' | 'major' | 'unavailable'>;
	summaryText: string | null;
	reportsOutage: boolean;
}>;

type StatusRow = GitHubStatusRow | DowndetectorStatusRow;

type GitHubOutputStatus = Exclude<Indicator, 'none'> | 'up';
type DowndetectorOutputStatus = 'up' | 'down' | 'unavailable';

type GitHubOutputRow = Readonly<{
	source: 'github';
	status: GitHubOutputStatus;
	details: string | null;
	incidents: readonly IncidentSummary[] | null;
	affected: readonly AffectedComponent[] | null;
}>;

type DowndetectorOutputRow = Readonly<{
	source: 'downdetector';
	status: DowndetectorOutputStatus;
	details: string | null;
}>;

type StatusOutputRow = GitHubOutputRow | DowndetectorOutputRow;

export { componentKeys, componentsNamedInText, nameMatchesComponents, nameMatchesManyComponents, sourceLabels, sources };
export type { ComponentKey, DowndetectorStatusRow, GitHubStatusRow, Source, StatusOutputRow, StatusRow };
