/** Product-class architecture. Panes are a view of generic signals, not a new scorer. */
import type { PlanTier } from '../types';

export type ArchTemplateId = 'sdk' | 'data_platform' | 'api' | 'deploy';

export const ARCHITECTURE_TEMPLATES: Record<ArchTemplateId, { label: string; hint: string; panes: Array<{
	id: string; label: string; signal: string; load_bearing: boolean;
}> }> = {
	sdk: {
		label: 'SDK / library',
		hint: 'A package teams import. Backbone is real call-sites, not a RAG stack.',
		panes: [
			{ id: 'install', label: 'Package installed', signal: 'dependency', load_bearing: false },
			{ id: 'wired', label: 'Configured / keys', signal: 'hosted', load_bearing: false },
			{ id: 'client', label: 'Called in code', signal: 'invocation', load_bearing: true },
			{ id: 'runtime', label: 'Runtime API', signal: 'api_usage', load_bearing: true },
			{ id: 'hosted', label: 'Shipped / hosted', signal: 'platform_deploy', load_bearing: false },
		],
	},
	data_platform: {
		label: 'Data / gateway platform',
		hint: 'BaaS, streams, vector stores. Complementary infra — not RocketRide retrieval layers.',
		panes: [
			{ id: 'install', label: 'Package installed', signal: 'dependency', load_bearing: false },
			{ id: 'config', label: 'Platform config', signal: 'artifact', load_bearing: false },
			{ id: 'client', label: 'Client / SDK', signal: 'invocation', load_bearing: true },
			{ id: 'data', label: 'Data plane / API', signal: 'api_usage', load_bearing: true },
			{ id: 'hosted', label: 'Hosted on platform', signal: 'platform_deploy', load_bearing: true },
		],
	},
	api: {
		label: 'API / service',
		hint: 'Judged on live calls to your hosts, with or without an SDK.',
		panes: [
			{ id: 'install', label: 'Package / client', signal: 'dependency', load_bearing: false },
			{ id: 'auth', label: 'Auth / keys', signal: 'hosted', load_bearing: false },
			{ id: 'client', label: 'Called in code', signal: 'invocation', load_bearing: false },
			{ id: 'runtime', label: 'Runtime API', signal: 'api_usage', load_bearing: true },
			{ id: 'hosted', label: 'Live endpoint', signal: 'platform_deploy', load_bearing: true },
		],
	},
	deploy: {
		label: 'Deploy / hosting',
		hint: 'The question is whether they shipped on you, not whether they imported an SDK.',
		panes: [
			{ id: 'install', label: 'Package / project', signal: 'dependency', load_bearing: false },
			{ id: 'config', label: 'Deploy config', signal: 'artifact', load_bearing: false },
			{ id: 'account', label: 'Account / env', signal: 'hosted', load_bearing: false },
			{ id: 'runtime', label: 'Preview / API', signal: 'api_usage', load_bearing: false },
			{ id: 'hosted', label: 'Live on platform', signal: 'platform_deploy', load_bearing: true },
		],
	},
};

export function inferArchitectureTemplate(types: unknown, explicit?: unknown): ArchTemplateId {
	const id = String(explicit || '');
	if (id === 'sdk' || id === 'data_platform' || id === 'api' || id === 'deploy') return id;
	const tset = new Set((Array.isArray(types) ? types : ['code']).map((x) => String(x).toLowerCase()));
	if (tset.has('platform') && (tset.has('code') || tset.has('api'))) return 'data_platform';
	if (tset.has('platform')) return 'deploy';
	if (tset.has('api') && !tset.has('code')) return 'api';
	return 'sdk';
}

export function isStockArchitecture(panes: unknown, templateId: ArchTemplateId): boolean {
	const stock = ARCHITECTURE_TEMPLATES[templateId].panes;
	if (!Array.isArray(panes) || panes.length !== stock.length) return false;
	return panes.every((raw, i) => {
		const pane = raw as { label?: string; signal?: string };
		return pane.label === stock[i].label && pane.signal === stock[i].signal;
	});
}

/** Developer runs use team defaults. Company / Organizers may persist a per-target rubric. */
export function scoringConfigForPlan(
	config: Record<string, unknown>,
	plan: PlanTier,
): Record<string, unknown> {
	if (plan === 'company' || plan === 'organizers') return { ...config };
	return withoutUserRubric(config);
}

/** Strip user-tuned weights so the engine falls back to team defaults. */
export function withoutUserRubric(config: Record<string, unknown>): Record<string, unknown> {
	const { weights: _w, thresholds: _t, ...rest } = config;
	return rest;
}
