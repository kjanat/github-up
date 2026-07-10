const API_V2_BASE = '/api/v2';

/** Endpoints for GitHub's status page API. */
export const StatusAPIEndpoints = {
	components() {
		return `${API_V2_BASE}/components.json` as const;
	},
	Incidents: {
		all() {
			return `${API_V2_BASE}/incidents.json` as const;
		},
		unresolved() {
			return `${API_V2_BASE}/incidents/unresolved.json` as const;
		},
	},
	ScheduledMaintenances: {
		active() {
			return `${API_V2_BASE}/scheduled-maintenances/active.json` as const;
		},
		all() {
			return `${API_V2_BASE}/scheduled-maintenances.json` as const;
		},
		upcoming() {
			return `${API_V2_BASE}/scheduled-maintenances/upcoming.json` as const;
		},
	},
	status() {
		return `${API_V2_BASE}/status.json` as const;
	},
	/** @private */
	subscriber(subscriberId: string) {
		const subId = encodeURIComponent(subscriberId);
		return `${API_V2_BASE}/subscribers/${subId}.json` as const;
	},
	/** @private */
	subscribers() {
		return `${API_V2_BASE}/subscribers.json` as const;
	},
	summary() {
		return `${API_V2_BASE}/summary.json` as const;
	},
};
