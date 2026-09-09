/** Pull judge-facing prose from an LLM chat result. Never reads tag / backbone / score. */

export type ExplainProse = {
	description?: string;
	rocketride_usage?: string;
	justification?: string;
	project_name?: string;
	team_members?: string;
	explain_failed?: boolean;
	explain_error?: string;
};

const PROSE_KEYS = ['description', 'rocketride_usage', 'justification'] as const;
const MAX = {
	description: 800,
	rocketride_usage: 1000,
	justification: 1400,
	project_name: 80,
	team_members: 200,
} as const;

const PLACEHOLDER = /^(?:<\d|TODO\b|TBD\b|\.{3}$)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function liftAnswer(value: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	const box = value as { getJson?: () => unknown; getText?: () => string };
	if (typeof box.getJson === 'function') {
		try {
			const json = box.getJson();
			if (json != null && json !== '') return json;
		} catch { /* fall through */ }
	}
	if (typeof box.getText === 'function') {
		try {
			const text = box.getText();
			if (text != null && String(text).trim()) return text;
		} catch { /* fall through */ }
	}
	return value;
}

function stripFences(text: string): string {
	return text
		.replace(/```(?:json|javascript|js)?\s*/gi, '')
		.replace(/```/g, '')
		.trim();
}

function iterJsonObjects(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = -1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '{') {
			if (depth === 0) start = i;
			depth += 1;
		} else if (ch === '}' && depth > 0) {
			depth -= 1;
			if (depth === 0 && start >= 0) {
				out.push(text.slice(start, i + 1));
				start = -1;
			}
		}
	}
	return out;
}

function clip(text: string, max: number): string {
	const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function pickProse(obj: Record<string, unknown>): ExplainProse {
	const usage = obj.rocketride_usage ?? obj.usage ?? obj.how_used;
	return {
		description: obj.description != null ? String(obj.description) : '',
		rocketride_usage: usage != null ? String(usage) : '',
		justification: obj.justification != null ? String(obj.justification) : '',
		project_name: obj.project_name != null ? String(obj.project_name) : '',
		team_members: obj.team_members != null ? String(obj.team_members) : '',
	};
}

export function sanitizeExplainProse(prose: ExplainProse): ExplainProse {
	const next: ExplainProse = {
		description: clip(String(prose.description || ''), MAX.description),
		rocketride_usage: clip(String(prose.rocketride_usage || ''), MAX.rocketride_usage),
		justification: clip(String(prose.justification || ''), MAX.justification),
		project_name: clip(String(prose.project_name || ''), MAX.project_name),
		team_members: clip(String(prose.team_members || ''), MAX.team_members),
	};
	for (const key of PROSE_KEYS) {
		const value = next[key] || '';
		if (PLACEHOLDER.test(value) || value.length < 8) next[key] = '';
	}
	if (next.project_name && PLACEHOLDER.test(next.project_name)) next.project_name = '';
	if (next.team_members && PLACEHOLDER.test(next.team_members)) next.team_members = '';
	return next;
}

export function hasUsableProse(prose: ExplainProse): boolean {
	if (prose.explain_failed) return false;
	const body = `${prose.description || ''} ${prose.rocketride_usage || ''}`.trim();
	return body.length >= 12;
}

export function extractProse(text: string): ExplainProse {
	let best: ExplainProse = {};
	for (const cand of iterJsonObjects(stripFences(text || ''))) {
		try {
			const obj = JSON.parse(cand) as Record<string, unknown>;
			if (obj && typeof obj === 'object' && (
				'description' in obj || 'rocketride_usage' in obj || 'justification' in obj || 'usage' in obj
			)) {
				best = pickProse(obj);
			}
		} catch { /* keep scanning */ }
	}
	return best;
}

function extractFromPayload(payload: unknown): ExplainProse {
	const lifted = liftAnswer(payload);
	const rec = asRecord(lifted);
	if (rec && (PROSE_KEYS.some((k) => k in rec) || 'usage' in rec || 'how_used' in rec)) {
		return pickProse(rec);
	}
	if (typeof lifted === 'string') return extractProse(lifted);
	if (rec) {
		for (const key of ['text', 'content', 'output', 'answer', 'message']) {
			if (typeof rec[key] === 'string') {
				const got = extractProse(String(rec[key]));
				if (hasUsableProse(sanitizeExplainProse(got))) return got;
			}
		}
	}
	return {};
}

function pushPayloads(into: unknown[], value: unknown): void {
	const lifted = liftAnswer(value);
	if (lifted == null) return;
	if (Array.isArray(lifted)) {
		for (const item of lifted) pushPayloads(into, item);
		return;
	}
	into.push(lifted);
}

/** Prefer `answers` (Python client shape). Never flatten the whole envelope — that
 *  concatenates UUIDs and the echoed prompt and breaks JSON brace matching. */
export function chatAnswerPayloads(resp: unknown): unknown[] {
	const out: unknown[] = [];
	const root = liftAnswer(resp);
	const rec = asRecord(root);
	if (!rec) {
		if (root != null) out.push(root);
		return out;
	}
	if (PROSE_KEYS.some((k) => k in rec) || 'usage' in rec) out.push(rec);
	pushPayloads(out, rec.answers);
	const types = asRecord(rec.result_types);
	if (types) {
		for (const [field, kind] of Object.entries(types)) {
			if (kind === 'answers' || kind === 'text' || field === 'answers') {
				pushPayloads(out, rec[field]);
			}
		}
	}
	for (const key of ['text', 'output', 'content', 'result']) {
		if (key !== 'answers') pushPayloads(out, rec[key]);
	}
	return out;
}

export function extractProseFromResponse(resp: unknown): ExplainProse {
	for (const payload of chatAnswerPayloads(resp)) {
		const got = sanitizeExplainProse(extractFromPayload(payload));
		if (hasUsableProse(got)) return got;
	}
	if (typeof resp === 'string') {
		const got = sanitizeExplainProse(extractProse(resp));
		if (hasUsableProse(got)) return got;
	}
	return {};
}
