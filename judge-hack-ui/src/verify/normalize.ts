import type { LayerMap, Submission, VerifyResult } from '../types';
import { scoringSummary, usesPipelineRubric } from '../format';

const LAYER_KEYS = ['ingest', 'retrieval', 'orchestration', 'reasoning', 'output'] as const;
const LAYER_VALUES = new Set(['target', 'other', 'none']);

function layersFromBackbone(backbone: unknown): LayerMap {
	const bb = String(backbone || '').trim().toLowerCase();
	const orch = bb === 'yes' || bb === 'partial' ? 'target' : 'none';
	const reason = bb === 'yes' ? 'target' : 'none';
	return { ingest: 'none', retrieval: 'none', orchestration: orch, reasoning: reason, output: 'none' };
}

function normalizeLayers(raw: unknown, backbone: unknown): LayerMap {
	const derived = layersFromBackbone(backbone);
	if (!raw || typeof raw !== 'object') return derived;
	const src = raw as Record<string, unknown>;
	const out: LayerMap = {};
	for (const k of LAYER_KEYS) {
		let v = String(src[k] ?? '').trim().toLowerCase();
		if (v === 'rocketride') v = 'target';
		out[k] = LAYER_VALUES.has(v) ? v : derived[k];
	}
	return out;
}

function eventWindow(raw: unknown): string[] | null {
	if (!raw) return null;
	if (Array.isArray(raw) && raw.length >= 2) return [String(raw[0]), String(raw[1])];
	if (typeof raw === 'object') {
		const w = raw as { start?: string; end?: string };
		if (w.start && w.end) return [w.start, w.end];
	}
	return null;
}

function repoName(url: string): string {
	const m = url.match(/github\.com[/:]([^/\s#?]+)\/([^/\s#?]+)/i);
	return m ? m[2].replace(/\.git$/i, '').replace(/\/+$/, '') : url;
}

export function normalizeResult(raw: VerifyResult, row: Submission, seconds: number): VerifyResult {
	const status = String(raw.status || '');
	const complete = status === 'complete';
	const github = row.github || String(raw.repo_url || raw.github || '');
	const project = row.project
		|| String(raw.readme_title || raw.project || '')
		|| repoName(github);
	const window = eventWindow(raw.event_window);
	const reused = Array.isArray(raw.reused_pipelines)
		? raw.reused_pipelines.map((p) => (typeof p === 'string' ? p : (p?.name || ''))).filter(Boolean)
		: [];

	const http = Number(raw.http_status);
	const reasonText = String(raw.reason || '');
	const sandboxError = /^Evaluator (error|timed out)/i.test(reasonText)
		|| status === 'invalid';
	const missingRepo = !sandboxError && (
		http === 404
		|| /HTTP 404/i.test(reasonText)
		|| /not parseable/i.test(reasonText)
		|| /repo (is )?inaccessible/i.test(reasonText)
	);
	const inaccessible = !complete && missingRepo;
	const fetchIncomplete = status === 'fetch_incomplete' || !!raw.truncated;
	const noVerdict = !complete || fetchIncomplete || sandboxError || !!raw.truncated;
	const failReason = reasonText
		|| (fetchIncomplete ? 'Evidence fetch was incomplete — no verdict on partial retrieval' : '')
		|| (sandboxError ? 'Evaluator returned an incomplete payload — no verdict' : '')
		|| (!complete ? 'Verification did not finish — no verdict' : '');
	const called = typeof raw.pipelines_called === 'number'
		? raw.pipelines_called
		: (Array.isArray(raw.pipelines) ? raw.pipelines.filter((p) => p.called).length : 0);
	const total = typeof raw.pipelines_total === 'number'
		? raw.pipelines_total
		: (Array.isArray(raw.pipelines) ? raw.pipelines.length : 0);
	const detNote = !noVerdict && (raw.tag != null || raw.score != null)
		? scoringSummary({ ...raw, pipelines_called: called, pipelines_total: total })
		: '';
	const notes = String(noVerdict ? (failReason || raw.notes || '') : (raw.notes || raw.justification || detNote));
	const pipelineRubric = usesPipelineRubric({ scoring: raw.scoring, target_name: raw.target_name || row.target_name });
	const scoring = pipelineRubric ? 'pipeline' : 'generic';

	return {
		...raw,
		project,
		github,
		names: row.names || String(raw.names || ''),
		demo: row.demo || String(raw.demo || ''),
		deployed: row.deployed || String(raw.deployed || ''),
		tag: noVerdict ? undefined : String(raw.tag || 'None'),
		backbone: noVerdict ? undefined : String(raw.backbone || 'No'),
		score: noVerdict ? undefined : (typeof raw.score === 'number' ? raw.score : undefined),
		seconds: Math.round(seconds * 10) / 10,
		repo_accessible: complete && !noVerdict ? true : (inaccessible ? false : (sandboxError ? undefined : !inaccessible)),
		classify_failed: noVerdict && !inaccessible,
		reason: noVerdict ? (failReason || reasonText) : raw.reason,
		notes,
		justification: noVerdict ? failReason : String(raw.justification || notes),
		evidence: noVerdict ? undefined : (Array.isArray(raw.evidence) ? raw.evidence : undefined),
		breakdown: noVerdict ? undefined : raw.breakdown,
		pipelines: noVerdict || !pipelineRubric ? undefined : raw.pipelines,
		layers: noVerdict || !pipelineRubric ? undefined : normalizeLayers(raw.layers, raw.backbone),
		architecture: noVerdict || pipelineRubric
			? undefined
			: (Array.isArray(raw.architecture) ? raw.architecture as VerifyResult['architecture'] : undefined),
		event_window: window,
		reused_pipelines: reused,
		target_name: String(raw.target_name || row.target_name || ''),
		scoring,
		history_penalty: typeof raw.history_penalty === 'number' ? raw.history_penalty : undefined,
	};
}
