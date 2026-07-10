import type { CommandBuilder, Out } from '@kjanat/dreamcli';
import { command } from '@kjanat/dreamcli';

import {
	chromeFlag,
	componentConvenienceFlags,
	componentFlag,
	githubStatusBaseFlag,
	quietFlag,
	selectedComponents,
	selectedSources,
	sourceSelectionFlag,
} from '#github-down/cli/flags';
import { type ComponentKey, type Source, sourceLabels } from '#github-down/cli/model';
import type { StatusRow } from '#github-down/cli/model';
import { renderPageFooter, renderStatusRow, renderStatusRows } from '#github-down/cli/render';
import {
	checkDowndetectorSource,
	checkGitHubSource,
	checkSource,
	filterGitHubByComponents,
	sortRows,
	summarizeExitCode,
} from '#github-down/cli/status';
import { openUrlInDefaultBrowser } from '#github-down/lib/open-url';
import pkg from '#pkg' with { type: 'json' };

/** A source paired with the deferred work that checks it. */
type SourceTask = Readonly<{
	source: Source;
	run: () => Promise<StatusRow>;
}>;

type UrlOpener = (url: string) => Promise<void> | void;

/** Registers `--component` and every per-component convenience flag in one
 * place, so the set can't drift between the `status` and `github` commands.
 * Takes a still-flagless builder because dreamcli's `.flag()` name-clash
 * guard (`Exclude<N, keyof F>`) can't be proven for an open generic `F`. */
function withComponentFlags(cmd: CommandBuilder) {
	return cmd
		.flag('component', componentFlag)
		.flag('actions', componentConvenienceFlags.actions)
		.flag('api', componentConvenienceFlags.api)
		.flag('codespaces', componentConvenienceFlags.codespaces)
		.flag('copilot', componentConvenienceFlags.copilot)
		.flag('git', componentConvenienceFlags.git)
		.flag('issues', componentConvenienceFlags.issues)
		.flag('packages', componentConvenienceFlags.packages)
		.flag('pages', componentConvenienceFlags.pages)
		.flag('pr', componentConvenienceFlags.pr)
		.flag('webhooks', componentConvenienceFlags.webhooks);
}

/**
 * Drives a set of source checks and renders the result. In an interactive
 * terminal each row is streamed in as it resolves behind a spinner; otherwise
 * the rows are collected and rendered in one batch (JSON, or nothing when
 * quiet). The status-derived exit code is always set.
 */
async function runStatus(
	tasks: readonly SourceTask[],
	selected: ReadonlySet<ComponentKey>,
	quiet: boolean,
	out: Out,
): Promise<void> {
	// Spinners and per-row streaming only make sense in a real terminal: JSON
	// must stay a single array on stdout, non-TTY output is machine-bound, and
	// quiet suppresses decoration entirely.
	if (out.isTTY && !out.jsonMode && !quiet) {
		const rows = await streamStatus(tasks, selected, out);
		out.setExitCode(summarizeExitCode(rows));
		return;
	}

	const rows = applyComponentFilter(
		await Promise.all(tasks.map((task) => task.run())),
		selected,
	);
	finishStatus(rows, quiet, out);
}

/** Spinner label naming the sources still being checked. */
function checkingText(pending: ReadonlySet<Source>): string {
	return `Checking ${
		[...pending]
			.map((source) => sourceLabels[source])
			.join(', ')
	}…`;
}

/**
 * Runs the checks concurrently and prints each result the instant it lands,
 * keeping a spinner alive for whatever is still outstanding. dreamcli allows
 * only one active spinner, so we stop it to clear the line before printing a
 * row and start a fresh one (with the shrunken source list) if work remains.
 */
async function streamStatus(
	tasks: readonly SourceTask[],
	selected: ReadonlySet<ComponentKey>,
	out: Out,
): Promise<StatusRow[]> {
	const pending = new Set<Source>(tasks.map((task) => task.source));
	const collected: StatusRow[] = [];
	const inFlight = new Map(
		tasks.map(
			(task, index) =>
				[
					index,
					task.run().then((row) => ({ source: task.source, row })),
				] as const,
		),
	);

	let spinner = out.spinner(checkingText(pending));
	let renderedRows = 0;
	try {
		while (inFlight.size > 0) {
			const settled = await Promise.race(
				[...inFlight].map(([index, ready]) => ready.then((value) => ({ index, ...value }))),
			);
			inFlight.delete(settled.index);
			pending.delete(settled.source);

			const row = filterGitHubByComponents(settled.row, selected);
			collected.push(row);

			spinner.stop();
			renderStatusRow(row, out, { leadingBlank: renderedRows > 0 });
			renderedRows += 1;
			if (pending.size > 0) {
				spinner = out.spinner(checkingText(pending));
			}
		}
	} catch (error: unknown) {
		// Restore the cursor/clear the line before the error propagates.
		spinner.stop();
		throw error;
	}

	renderPageFooter(out);
	return collected;
}

function finishStatus(
	rows: readonly StatusRow[],
	quiet: boolean,
	out: Out,
): void {
	if (!quiet) {
		renderStatusRows(sortRows(rows), out);
	}

	out.setExitCode(summarizeExitCode(rows));
}

function applyComponentFilter(
	rows: readonly StatusRow[],
	selected: ReadonlySet<ComponentKey>,
): readonly StatusRow[] {
	if (selected.size === 0) return rows;
	return rows.map((row) => filterGitHubByComponents(row, selected));
}

const statusCommand = withComponentFlags(
	command('status')
		.description('Check GitHub status across GitHub and Downdetector')
		.example('status', 'Check all sources')
		.example('status --source github', 'Check only GitHub')
		.example('status --actions', 'Only report trouble mentioning Actions')
		.example('status --json', 'Emit machine-readable source rows'),
)
	.flag('githubStatusBase', githubStatusBaseFlag)
	.flag('chrome', chromeFlag)
	.flag('quiet', quietFlag)
	.flag('source', sourceSelectionFlag)
	.action(async ({ flags, out }) => {
		const { source, githubStatusBase, chrome, quiet } = flags;
		const tasks = selectedSources(source).map(
			(src): SourceTask => ({
				source: src,
				run: () => checkSource(src, githubStatusBase, chrome),
			}),
		);
		await runStatus(tasks, selectedComponents(flags), quiet, out);
	});

const githubCommand = withComponentFlags(
	command('github')
		.description(`Check only ${sourceLabels.github}`)
		.example('github', `Check only ${sourceLabels.github}`)
		.example('github --component actions', 'Only report trouble mentioning Actions'),
)
	.flag('githubStatusBase', githubStatusBaseFlag)
	.flag('quiet', quietFlag)
	.action(async ({ flags, out }) => {
		const tasks: SourceTask[] = [
			{
				source: 'github',
				run: () => checkGitHubSource(flags.githubStatusBase),
			},
		];
		await runStatus(tasks, selectedComponents(flags), flags.quiet, out);
	});

const downdetectorCommand = command('downdetector')
	.description(`Check only ${sourceLabels.downdetector}`)
	.example('downdetector', `Check only ${sourceLabels.downdetector}`)
	.flag('chrome', chromeFlag)
	.flag('quiet', quietFlag)
	.action(async ({ flags, out }) => {
		const tasks: SourceTask[] = [
			{
				source: 'downdetector',
				run: () => checkDowndetectorSource(flags.chrome),
			},
		];
		await runStatus(tasks, new Set(), flags.quiet, out);
	});

function createWebCommand(openUrl: UrlOpener = openUrlInDefaultBrowser) {
	return command('web')
		.alias('site')
		.description('Open the live status page')
		.example('web', 'Open the live status page in your browser')
		.action(async ({ out }) => {
			await openUrl(pkg.homepage);
			out.log(`Opening ${pkg.homepage}`);
		});
}

const webCommand = createWebCommand();

export { createWebCommand, downdetectorCommand, githubCommand, statusCommand, webCommand };
