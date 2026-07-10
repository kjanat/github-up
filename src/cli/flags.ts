import { flag, ParseError } from '@kjanat/dreamcli';

import { type ComponentKey, componentKeys, type Source, sources } from '#github-down/cli/model';
import { CHROME_PATH_ENV, GITHUB_STATUS_BASE } from '#github-down/lib/constants';

/** Builds a flag parser that splits one comma-separated token into validated
 * enum members, so `--flag a,b` works alongside repeated `--flag a --flag b`.
 * Thrown ParseErrors are surfaced verbatim by dreamcli's flag parser, matching
 * its built-in enum error format. */
function csvEnumParser<T extends string>(
	allowed: readonly T[],
	flagName: string,
): (raw: unknown) => readonly T[] {
	return (raw: unknown): readonly T[] => {
		const result: T[] = [];
		for (const token of String(raw).split(',')) {
			const name = token.trim();
			if (name.length === 0) continue;
			// `find` yields the typed member (or undefined) without a cast.
			const match = allowed.find((value) => value === name);
			if (match === undefined) {
				throw new ParseError(
					`Invalid value '${name}' for flag --${flagName}. Allowed: ${
						allowed.join(
							', ',
						)
					}`,
					{
						code: 'INVALID_VALUE',
						details: {
							flag: flagName,
							input: `--${flagName}`,
							value: name,
							allowed,
						},
					},
				);
			}
			result.push(match);
		}

		return result;
	};
}

/** Parses one `--source` token into the sources it names (comma-separated). */
const parseSourceList = csvEnumParser(sources, 'source');

/** Parses one `--component` token into the components it names (comma-separated). */
const parseComponentList = csvEnumParser(componentKeys, 'component');

/** Suppresses all output; the process exit code conveys the status instead. */
const quietFlag = flag.boolean().alias('q').describe('Silent; exit code only');

/** Overrides the base URL used to reach GitHub's Statuspage API. */
const githubStatusBaseFlag = flag
	.custom((raw) => new URL(String(raw)))
	.alias('github-status-base', { hidden: true })
	.alias('base')
	.alias('b')
	.default(new URL(GITHUB_STATUS_BASE))
	.env('GITHUB_DOWN_GITHUB_STATUS_BASE')
	.describe('Override GitHub status page base URL');

/** Selects which data sources to query; defaults to all available sources.
 * Accepts comma-separated values and/or repeated flags. */
const sourceSelectionFlag = flag
	.array(flag.custom(parseSourceList))
	.alias('s')
	.default([[...sources]])
	.env('GITHUB_DOWN_SOURCE')
	.env('GITHUB_DOWN_SOURCES') // plural form for convenience
	.describe('Data source(s) to check');

/** Path to a Chrome/Chromium binary, overriding platform discovery. */
const chromeFlag = flag
	.string()
	.env(CHROME_PATH_ENV)
	.describe('Path to a Chrome/Chromium binary');

/** Restricts reported incidents/components to those naming the given GitHub
 * component(s). Accepts comma-separated values and/or repeated flags. */
const componentFlag = flag
	.array(flag.custom(parseComponentList))
	.alias('c')
	.describe('Only report incidents/components mentioning these component(s)');

/** Per-component convenience flags, e.g. `--actions` is shorthand for
 * `--component actions`. */
const componentConvenienceFlags = {
	actions: flag.boolean().describe('Shortcut for --component actions'),
	api: flag.boolean().describe('Shortcut for --component api'),
	codespaces: flag.boolean().describe('Shortcut for --component codespaces'),
	copilot: flag.boolean().describe('Shortcut for --component copilot'),
	git: flag.boolean().describe('Shortcut for --component git'),
	issues: flag.boolean().alias('issue').describe('Shortcut for --component issues'),
	packages: flag.boolean().describe('Shortcut for --component packages'),
	pages: flag.boolean().describe('Shortcut for --component pages'),
	pr: flag.boolean().alias('prs').describe('Shortcut for --component pr'),
	webhooks: flag.boolean().describe('Shortcut for --component webhooks'),
} as const satisfies Record<ComponentKey, unknown>;

/** Shape of the flag values used to determine which components were selected.
 * `--component` resolves to one list per occurrence, flattened below. */
type ComponentFlagValues =
	& { component: readonly (readonly ComponentKey[])[] }
	& Record<ComponentKey, boolean>;

/** Unions the `--component` lists with any enabled per-component convenience flags. */
function selectedComponents(flags: ComponentFlagValues): Set<ComponentKey> {
	const selected = new Set<ComponentKey>(flags.component.flat());
	for (const key of componentKeys) {
		if (flags[key]) selected.add(key);
	}

	return selected;
}

/** Flattens the per-occurrence `--source` lists into the sources to query,
 * deduplicated so `--source github,github` checks GitHub once. */
function selectedSources(
	source: readonly (readonly Source[])[],
): readonly Source[] {
	return [...new Set(source.flat())];
}

export {
	chromeFlag,
	componentConvenienceFlags,
	componentFlag,
	githubStatusBaseFlag,
	parseComponentList,
	parseSourceList,
	quietFlag,
	selectedComponents,
	selectedSources,
	sourceSelectionFlag,
};
