import type { IncidentImpactValue } from '#github-down/lib/types';

const INDICATOR_RANKS = {
	none: 0,
	minor: 1,
	major: 2,
	critical: 3,
} as const satisfies Record<IncidentImpactValue, number>;

const INDICATOR_DESCRIPTIONS = {
	none: 'All Systems Operational',
	minor: 'Minor Service Outage',
	major: 'Major Service Outage',
	critical: 'Critical Service Outage',
} as const satisfies Record<IncidentImpactValue, string>;

const MANY_AFFECTED_COMPONENTS_THRESHOLD = 3;

function isIncidentImpact(value: unknown): value is IncidentImpactValue {
	return typeof value === 'string' && value in INDICATOR_RANKS;
}

function normalizeIncidentImpact(value: unknown): IncidentImpactValue {
	return isIncidentImpact(value) ? value : 'critical';
}

function higherImpact(
	left: IncidentImpactValue,
	right: IncidentImpactValue,
): IncidentImpactValue {
	return INDICATOR_RANKS[right] > INDICATOR_RANKS[left] ? right : left;
}

function componentStatusImpact(status: unknown): IncidentImpactValue {
	switch (status) {
		case 'operational':
			return 'none';
		case 'degraded_performance':
		case 'under_maintenance':
			return 'minor';
		case 'partial_outage':
		case 'major_outage':
			return 'major';
		default:
			return 'major';
	}
}

function isDisruptedComponentStatus(status: unknown): boolean {
	switch (status) {
		case 'degraded_performance':
		case 'partial_outage':
		case 'major_outage':
			return true;
		default:
			return false;
	}
}

function componentsImpact(
	components: readonly { status: unknown }[],
): IncidentImpactValue {
	let impact: IncidentImpactValue = 'none';
	let disruptedCount = 0;

	for (const component of components) {
		if (isDisruptedComponentStatus(component.status)) disruptedCount += 1;
		impact = higherImpact(impact, componentStatusImpact(component.status));
	}

	return disruptedCount >= MANY_AFFECTED_COMPONENTS_THRESHOLD
		? higherImpact(impact, 'major')
		: impact;
}

/**
 * Promotes the page indicator to the worst operational state we can observe.
 *
 * Incident `impact` labels are deliberately excluded: they are editorial and
 * outlive the disruption they describe (a notice can stay `major` with
 * nothing actually offline), so letting them drive the headline over-reports
 * the outage. Components can still override Statuspage's summary when several
 * surfaces are degraded at once.
 */
function deriveConservativeIndicator(
	reportedIndicator: unknown,
	components: readonly { status: unknown }[] = [],
): IncidentImpactValue {
	return higherImpact(
		normalizeIncidentImpact(reportedIndicator),
		componentsImpact(components),
	);
}

function describeIndicator(indicator: IncidentImpactValue): string {
	return INDICATOR_DESCRIPTIONS[indicator];
}

export {
	componentsImpact,
	componentStatusImpact,
	deriveConservativeIndicator,
	describeIndicator,
	higherImpact,
	isIncidentImpact,
	normalizeIncidentImpact,
};
