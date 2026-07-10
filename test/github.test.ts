import { describe, expect, test } from 'bun:test';

import { checkGitHubSource, summarizeExitCode } from '#github-down/cli/status';
import { checkGitHub } from '#github-down/lib/github';
import { cacheControlHeader, withSummaryBody, withSummaryFixture } from '#test/support/statuspage-fixture.ts';

describe('checkGitHub', () => {
	test('parses the down fixture summary', async () => {
		await withSummaryFixture('github-down.json', async (server) => {
			const result = await checkGitHub(server.baseUrl);

			expect(result.kind).toBe('ok');
			if (result.kind !== 'ok') {
				throw new Error(`expected ok result, got ${result.kind}`);
			}

			expect(result.summary.status.indicator).toBe('major');
			expect(result.summary.status.description).toBe('Partial System Outage');
			expect(result.summary.incidents[0]?.name).toBe(
				'Actions is experiencing degraded availability',
			);
			expect(
				result.summary.components
					.filter((component) => component.status !== 'operational')
					.map((component) => component.name),
			).toEqual(['Actions']);
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('degrades to unknown when a 200 response has the wrong shape', async () => {
		await withSummaryBody({ hello: 'world' }, async (server) => {
			const result = await checkGitHub(server.baseUrl);

			expect(result).toMatchObject({
				kind: 'unknown',
				reason: 'unexpected response shape from status API',
			});
		});
	});

	test('rejects incomplete summaries whose fields the row mapping reads', async () => {
		const bodies = [
			// status missing indicator/description
			{ status: {}, components: [], incidents: [] },
			// incident missing impact
			{
				status: { description: 'ok', indicator: 'none' },
				components: [],
				incidents: [{ name: 'x', status: 'investigating' }],
			},
		];

		for (const body of bodies) {
			await withSummaryBody(body, async (server) => {
				const result = await checkGitHub(server.baseUrl);

				expect(result).toMatchObject({
					kind: 'unknown',
					reason: 'unexpected response shape from status API',
				});
			});
		}
	});

	test('parses the up fixture summary', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const result = await checkGitHub(server.baseUrl);

			expect(result.kind).toBe('ok');
			if (result.kind !== 'ok') {
				throw new Error(`expected ok result, got ${result.kind}`);
			}

			expect(result.summary.status.indicator).toBe('none');
			expect(result.headers.get('cache-control')).toBe(cacheControlHeader);
			expect(result.summary.status.description).toBe('All Systems Operational');
			expect(result.summary.incidents).toEqual([]);
			expect(
				result.summary.components
					.filter((component) => component.status !== 'operational')
					.map((component) => component.name),
			).toEqual([]);
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});
});

describe('checkGitHubSource', () => {
	test('maps the down fixture to the internal row model', async () => {
		await withSummaryFixture('github-down.json', async (server) => {
			const row = await checkGitHubSource(server.baseUrl);

			expect(row).toEqual({
				source: 'github',
				indicator: 'major',
				summaryText: 'Partial System Outage',
				incidents: [
					{
						name: 'Actions is experiencing degraded availability',
						status: 'investigating',
					},
				],
				affectedComponents: [{ name: 'Actions', status: 'partial_outage' }],
			});
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('maps the up fixture to the internal row model', async () => {
		await withSummaryFixture('github-up.json', async (server) => {
			const row = await checkGitHubSource(server.baseUrl);

			expect(row).toEqual({
				source: 'github',
				indicator: 'none',
				summaryText: 'All Systems Operational',
				incidents: null,
				affectedComponents: null,
			});
			expect(server.requests).toEqual(['/api/v2/summary.json']);
		});
	});

	test('keeps summary text aligned with promoted severity', async () => {
		await withSummaryBody(
			{
				page: {
					id: 'page',
					name: 'GitHub',
					time_zone: 'Etc/UTC',
					updated_at: '2026-06-22T00:00:00.000Z',
					url: 'https://www.githubstatus.com',
				},
				components: [
					{
						name: 'Actions',
						status: 'partial_outage',
					},
				],
				incidents: [
					{
						impact: 'major',
						name: 'Elevated Error Rates',
						status: 'investigating',
					},
				],
				scheduled_maintenances: [],
				status: {
					description: 'Minor Service Outage',
					indicator: 'minor',
				},
			},
			async (server) => {
				const row = await checkGitHubSource(server.baseUrl);

				expect(row.indicator).toBe('major');
				expect(row.summaryText).toBe('Major Service Outage (reported minor)');
				expect(server.requests).toEqual(['/api/v2/summary.json']);
			},
		);
	});

	test('promotes many degraded components above a minor report', async () => {
		await withSummaryBody(
			{
				page: {
					id: 'page',
					name: 'GitHub',
					time_zone: 'Etc/UTC',
					updated_at: '2026-07-04T00:00:00.000Z',
					url: 'https://www.githubstatus.com',
				},
				components: [
					{ name: 'Actions', status: 'degraded_performance' },
					{ name: 'Codespaces', status: 'degraded_performance' },
					{ name: 'Packages', status: 'degraded_performance' },
					{ name: 'Pages', status: 'degraded_performance' },
				],
				incidents: [
					{
						impact: 'minor',
						name: 'Elevated errors across multiple services',
						status: 'investigating',
					},
				],
				scheduled_maintenances: [],
				status: {
					description: 'Partially Degraded Service',
					indicator: 'minor',
				},
			},
			async (server) => {
				const row = await checkGitHubSource(server.baseUrl);

				expect(row.indicator).toBe('major');
				expect(row.summaryText).toBe('Major Service Outage (reported minor)');
				expect(server.requests).toEqual(['/api/v2/summary.json']);
			},
		);
	});

	test('derives exit codes from the normalized indicator', async () => {
		await withSummaryFixture('github-down.json', async (downServer) => {
			const downRow = await checkGitHubSource(downServer.baseUrl);

			await withSummaryFixture('github-up.json', async (upServer) => {
				const upRow = await checkGitHubSource(upServer.baseUrl);

				expect(summarizeExitCode([downRow])).toBe(2);
				expect(summarizeExitCode([upRow])).toBe(0);
			});
		});
	});
});
