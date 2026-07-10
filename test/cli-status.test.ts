import { createWebCommand, githubCommand, statusCommand } from '#github-down/cli/commands';
import { githubDown } from '#github-down/cli/index';
import { renderStatusRow } from '#github-down/cli/render';
import { EXIT_CODES } from '#github-down/lib/constants';
import pkg from '#pkg' with { type: 'json' };
import { githubStatusBaseEnvVar, withSummaryFixture } from '#test/support/statuspage-fixture.ts';
import { ExitError } from '@kjanat/dreamcli/runtime';
import { createTestAdapter, runCommand } from '@kjanat/dreamcli/testkit';
import { strip } from 'ansispeck';
import { serve } from 'bun';
import { describe, expect, test } from 'bun:test';

function downOutputRow() {
	return [
		{
			source: 'github',
			status: 'major',
			details: 'Partial System Outage',
			incidents: [
				{
					name: 'Actions is experiencing degraded availability',
					status: 'investigating',
				},
			],
			affected: [{ name: 'Actions', status: 'partial_outage' }],
		},
	];
}

function upOutputRow() {
	return [
		{
			source: 'github',
			status: 'up',
			details: 'All Systems Operational',
			incidents: null,
			affected: null,
		},
	];
}

// We only assert on the plain text this package produces, plus whether
// styling is present — not on the exact escape bytes ansispeck emits for a
// given style, which is that package's own API surface, not ours.
// oxlint-disable-next-line no-control-regex
const ESCAPE = /\x1b/;

// Trailing pointer to the web page, appended under human (TTY) status output.
const PAGE_FOOTER_PLAIN = `\nWatch the live status page: ${pkg.homepage}\n`;

async function withClosedPort<T>(
	run: (baseUrl: string) => Promise<T>,
): Promise<T> {
	const probe = serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: () => new Response(),
	});
	const baseUrl = probe.url.origin;
	probe.stop(true);
	return run(baseUrl);
}

async function runRootCli(argv: readonly string[]) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const adapter = createTestAdapter({
		argv: ['node', '/usr/bin/github-down', ...argv],
		cwd: '/work/actup-v2',
		stdout: (line) => {
			stdout.push(line);
		},
		stderr: (line) => {
			stderr.push(line);
		},
		readFile: async (path) => {
			if (path !== '/work/actup-v2/package.json') return null;
			return JSON.stringify({
				name: 'actup',
				version: '0.0.0+dev',
				bin: { actup: './dist/cli.mjs' },
			});
		},
	});

	try {
		await githubDown.run({ adapter });
	} catch (error: unknown) {
		if (error instanceof ExitError) {
			return { exitCode: error.code, stderr, stdout };
		}
		throw error;
	}

	throw new Error('expected CLI run to exit');
}

describe('CLI status output', () => {
	test('can render a streamed row with a leading blank line', () => {
		const stdout: string[] = [];
		const out = {
			isTTY: false,
			jsonMode: false,
			log: (line: string) => stdout.push(line),
		} as unknown as Parameters<typeof renderStatusRow>[1];

		renderStatusRow(
			{
				source: 'downdetector',
				indicator: 'major',
				summaryText: 'User reports show problems with GitHub',
				reportsOutage: true,
			},
			out,
			{ leadingBlank: true },
		);

		expect(stdout).toEqual([
			'\nDowndetector\n  User reports show problems with GitHub',
		]);
	});

	test('root help ignores cwd package metadata', async () => {
		const result = await runRootCli(['--help']);
		const output = result.stdout[0] ?? '';

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual([]);
		expect(output.startsWith(`github-down v${pkg.version}\n`)).toBe(true);
		expect(output).toContain('Usage: github-down [command] [options]');
		expect(output).toContain(
			'status (default)  Check GitHub status across GitHub and Downdetector',
		);
		expect(output).toContain('github-down [flags]');
		expect(output).toContain('web');
		expect(output).not.toContain('actup');
		expect(output).not.toContain('0.0.0+dev');
	});

	test('root version ignores cwd package metadata', async () => {
		const result = await runRootCli(['--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual([]);
		expect(result.stdout).toEqual([`${pkg.version}\n`]);
	});

	test('web command opens the live status page', async () => {
		const opened: string[] = [];
		const command = createWebCommand((url) => {
			opened.push(url);
		});

		const result = await runCommand(command, []);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual([]);
		expect(result.stdout).toEqual([`Opening ${pkg.homepage}\n`]);
		expect(opened).toEqual([pkg.homepage]);
	});

	test('web command exposes site alias', () => {
		expect(createWebCommand().schema.aliases).toContain('site');
	});

	test('renders GitHub down fixture as human output in TTY mode', async () => {
		await withSummaryFixture('github-down.json', async (server) => {
			const result = await runCommand(githubCommand, [], {
				env: { [githubStatusBaseEnvVar]: server.baseUrl },
				isTTY: true,
			});

			expect(result.exitCode).toBe(EXIT_CODES.major);
			expect(result.stderr).toEqual([]);
			expect(result.stdout).toHaveLength(2);
			const [body, footer] = result.stdout as [string, string];
			expect(body).toMatch(ESCAPE);
			expect(strip(body)).toBe(`\
GitHub
  Partial System Outage
  Active incident:
    - Actions is experiencing degraded availability (investigating)
  Affected components:
    - Actions
`);
			expect(strip(footer)).toBe(PAGE_FOOTER_PLAIN);
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('renders GitHub up fixture as human output in TTY mode', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const result = await runCommand(githubCommand, [], {
				env: { [githubStatusBaseEnvVar]: server.baseUrl },
				isTTY: true,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toEqual([]);
			expect(result.stdout).toHaveLength(2);
			const [body, footer] = result.stdout as [string, string];
			expect(body).toMatch(ESCAPE);
			expect(strip(body)).toBe('GitHub\n  All Systems Operational\n');
			expect(strip(footer)).toBe(PAGE_FOOTER_PLAIN);
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('root CLI dispatches explicit status command with down fixture JSON output', async () => {
		await withSummaryFixture('github-down.json', async (server) => {
			const result = await githubDown.execute(
				['status', '--source', 'github'],
				{
					env: { [githubStatusBaseEnvVar]: server.baseUrl },
				},
			);

			expect(result.exitCode).toBe(EXIT_CODES.major);
			expect(result.stderr).toEqual([]);
			expect(JSON.parse(result.stdout[0] ?? 'null')).toEqual(downOutputRow());
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('root CLI filters by component shorthand flags', async () => {
		await withSummaryFixture('github-down.json', async (server) => {
			const result = await githubDown.execute(
				['status', '--source', 'github', '--actions'],
				{
					env: { [githubStatusBaseEnvVar]: server.baseUrl },
				},
			);

			expect(result.exitCode).toBe(EXIT_CODES.major);
			expect(result.stderr).toEqual([]);
			expect(JSON.parse(result.stdout[0] ?? 'null')).toEqual([
				{
					source: 'github',
					status: 'major',
					details: '2 reports affecting actions',
					incidents: [
						{
							name: 'Actions is experiencing degraded availability',
							status: 'investigating',
						},
					],
					affected: [{ name: 'Actions', status: 'partial_outage' }],
				},
			]);
		});
	});

	test('--prs alias reports operational when pull requests are unaffected', async () => {
		await withSummaryFixture('github-down.json', async (server) => {
			const result = await runCommand(
				statusCommand,
				['--source', 'github', '--prs'],
				{ env: { [githubStatusBaseEnvVar]: server.baseUrl } },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toEqual([]);
			expect(JSON.parse(result.stdout[0] ?? 'null')).toEqual([
				{
					source: 'github',
					status: 'up',
					details: 'No incidents reported for pr',
					incidents: null,
					affected: null,
				},
			]);
		});
	});

	test('status command emits up fixture JSON output when stdout is not a tty', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const result = await runCommand(
				statusCommand,
				['--source', 'github'],
				{ env: { [githubStatusBaseEnvVar]: server.baseUrl } },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toEqual([]);
			expect(JSON.parse(result.stdout[0] ?? 'null')).toEqual(upOutputRow());
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('renders GitHub unavailable as a dim row in TTY mode', async () => {
		await withClosedPort(async (baseUrl) => {
			const result = await runCommand(githubCommand, [], {
				env: { [githubStatusBaseEnvVar]: baseUrl },
				isTTY: true,
			});

			expect(result.exitCode).toBe(EXIT_CODES.unavailable);
			expect(result.stderr).toEqual([]);
			expect(result.stdout).toHaveLength(2);
			const [body, footer] = result.stdout as [string, string];
			expect(body).toMatch(ESCAPE);
			expect(strip(body)).toMatch(/^GitHub\n {2}Unavailable: /);
			expect(strip(footer)).toBe(PAGE_FOOTER_PLAIN);
		});
	});

	test('streams a spinner and the row in interactive (TTY) mode', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const result = await runCommand(
				statusCommand,
				['--source', 'github'],
				{
					env: { [githubStatusBaseEnvVar]: server.baseUrl },
					isTTY: true,
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toEqual([]);
			// The result row streams to stdout as styled human output, with a
			// trailing pointer to the web page.
			expect(result.stdout).toHaveLength(2);
			const [body, footer] = result.stdout as [string, string];
			expect(body).toMatch(ESCAPE);
			expect(strip(body)).toBe('GitHub\n  All Systems Operational\n');
			expect(strip(footer)).toBe(PAGE_FOOTER_PLAIN);
			// A spinner brackets the check: started naming the source, stopped
			// once the row is ready to print.
			expect(result.activity).toEqual([
				{ type: 'spinner:start', text: 'Checking GitHub…' },
				{ type: 'spinner:stop' },
			]);
		});
	});

	test('does not spin or stream when stdout is not a tty', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const result = await runCommand(
				statusCommand,
				['--source', 'github'],
				{
					env: { [githubStatusBaseEnvVar]: server.baseUrl },
				},
			);

			expect(result.exitCode).toBe(0);
			// Non-TTY stays machine-bound: a single JSON array, no spinner, no
			// human page-footer leaking into stdout.
			expect(result.activity).toEqual([]);
			expect(result.stdout).toHaveLength(1);
			expect(result.stdout.join('')).not.toContain(pkg.homepage);
			expect(JSON.parse(result.stdout[0] ?? 'null')).toEqual(upOutputRow());
		});
	});

	test('quiet mode suppresses the spinner even in a tty', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const result = await runCommand(
				statusCommand,
				['--source', 'github', '--quiet'],
				{
					env: { [githubStatusBaseEnvVar]: server.baseUrl },
					isTTY: true,
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.activity).toEqual([]);
			expect(result.stdout).toEqual([]);
		});
	});

	test('status command emits unavailable JSON when source is unreachable', async () => {
		await withClosedPort(async (baseUrl) => {
			const result = await runCommand(
				statusCommand,
				['--source', 'github'],
				{ env: { [githubStatusBaseEnvVar]: baseUrl } },
			);

			expect(result.exitCode).toBe(EXIT_CODES.unavailable);
			expect(result.stderr).toEqual([]);
			const parsed = JSON.parse(result.stdout[0] ?? 'null');
			expect(parsed).toHaveLength(1);
			expect(parsed[0].source).toBe('github');
			expect(parsed[0].status).toBe('unavailable');
			expect(typeof parsed[0].details).toBe('string');
		});
	});
});
