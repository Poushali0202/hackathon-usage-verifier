/** Merge LLM extract JSON onto the deterministic draft. Tokens must appear in the corpus. */

const FIELDS = [
	'name', 'dependency_names', 'artifacts', 'invocation', 'hosted_markers', 'cli_verbs',
	'platform_domains', 'platform_files', 'platform_markers',
] as const;

const SEPS: Record<string, string> = { invocation: ' | ' };

const NAME_SKIP = new Set([
	'quick start', 'getting started', 'home', 'documentation', 'docs', 'readme',
	'install', 'overview', 'index', 'tier 1', 'tier 2', 'tier 3', 'pricing',
]);
const NOT_METHODS = new Set([
	'ai', 'io', 'com', 'org', 'dev', 'app', 'net', 'svg', 'png', 'jpg', 'jpeg',
	'gif', 'ico', 'css', 'js', 'ts', 'md', 'json', 'html', 'htm', 'toml', 'lock',
	'map', 'py', 'rs', 'go', 'txt', 'yml', 'yaml', 'pdf',
]);
const CLI_STOP = new Set([
	'the', 'a', 'an', 'to', 'of', 'in', 'for', 'with', 'and', 'or', 'on', 'as', 'by',
	'from', 'this', 'that', 'is', 'are', 'be', 'it', 'we', 'you', 'your', 'our',
	'learn', 'build', 'see', 'graph', 'use', 'using', 'turns',
	'documents', 'into', 'text', 'memory', 'about', 'pipeline',
]);

function productStems(cfg: Record<string, unknown>): string[] {
	const names = String(cfg.dependency_names || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
	return names.map((n) => n.replace(/-cli$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter((s) => s.length >= 3);
}

function plausibleName(name: string, stems: string[]): boolean {
	const n = name.trim();
	if (!n || NAME_SKIP.has(n.toLowerCase()) || /^tier\s*\d+$/i.test(n)) return false;
	const nl = n.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (nl.length < 3 || !/[a-z]/i.test(n)) return false;
	if (!stems.length) return true;
	return stems.some((s) => s.includes(nl) || nl.includes(s));
}

function isCliPhrase(phrase: string): boolean {
	const parts = phrase.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return false;
	if (/[^\x00-\x7F]/.test(phrase) || /['"]/.test(phrase)) return false;
	if (/\.(svg|png|jpg|jpeg|gif|ai|io|com|org|dev|net|html?|md)$/i.test(parts[0])) return false;
	const bin = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
	if (!bin || CLI_STOP.has(bin)) return false;
	if (parts.slice(1).some((p) => CLI_STOP.has(p.toLowerCase().replace(/[^a-z0-9-]/g, '')))) return false;
	return true;
}

function okInvocation(token: string, stems: string[]): boolean {
	const t = token.trim();
	if (/^(import|from)\s+[a-z]/i.test(t)) return true;
	const m = t.match(/^([a-z][\w-]*)\.([a-z][\w]*)$/i);
	if (m) {
		if (NOT_METHODS.has(m[2].toLowerCase())) return false;
		const stem = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
		return !stems.length || stems.includes(stem);
	}
	return isCliPhrase(t);
}

function consumerPkgName(name: string): boolean {
	const stem = name.trim().split('/').pop() || '';
	if (/-(starter(?:-kit)?|example|examples|demo|evals?|mcp|frontend)$/i.test(stem)) return false;
	if (/^comparative[-_]/i.test(stem)) return false;
	return true;
}

function pkgAlias(primary: string, name: string): boolean {
	const norm = (s: string) => (s.split('/').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
	const p = norm(primary);
	const n = norm(name);
	if (!p || !n) return false;
	if (n === p) return true;
	const extra = n.startsWith(p) ? n.slice(p.length) : '';
	return extra === 'ts' || extra === 'js' || extra === 'py' || extra === 'cli' || extra === 'sdk';
}

export function parseExtractLlmJson(raw: unknown): Record<string, unknown> | null {
	const text = typeof raw === 'string' ? raw : (raw != null ? JSON.stringify(raw) : '');
	if (!text.trim()) return null;
	const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
	const tryParse = (s: string): Record<string, unknown> | null => {
		try {
			const v = JSON.parse(s) as unknown;
			return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
		} catch {
			return null;
		}
	};
	const direct = tryParse(stripped);
	if (direct && ('dependency_names' in direct || 'name' in direct || 'invocation' in direct)) return direct;
	const start = stripped.indexOf('{');
	const end = stripped.lastIndexOf('}');
	if (start >= 0 && end > start) {
		const nested = tryParse(stripped.slice(start, end + 1));
		if (nested && ('dependency_names' in nested || 'name' in nested || 'invocation' in nested)) return nested;
	}
	return null;
}

export function verifyExtractField(value: string, corpusLower: string, sep = ', '): string {
	const stop = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'with', 'and', 'or', 'on', 'as', 'by', 'from', 'graph', 'search', 'add', 'learn', 'build', 'see']);
	const kept: string[] = [];
	for (const tok of String(value || '').split(/[|,\n]/)) {
		const t = tok.trim();
		if (!t) continue;
		const words = t.split(/\s+/).map((w) => w.replace(/^[*.]+/, '').toLowerCase()).filter(Boolean);
		if (words.length && words.every((w) => stop.has(w))) continue;
		if (words.length && words.every((w) => corpusLower.includes(w))) kept.push(t);
	}
	return [...new Set(kept)].join(sep);
}

export function mergeExtractConfig(
	deterministic: Record<string, unknown> | undefined,
	llm: Record<string, unknown> | null,
	corpusLower: string,
): {
	config: Record<string, unknown>;
	usedLlm: boolean;
	warnings: string[];
	suggestions?: { competitors?: string; neutral?: string };
} {
	const base: Record<string, unknown> = { ...(deterministic || {}) };
	const warnings: string[] = [];
	if (!llm) return { config: base, usedLlm: false, warnings };

	let used = false;
	for (const field of FIELDS) {
		const raw = String(llm[field] ?? '');
		if (!raw.trim()) continue;
		if (field === 'name') {
			const name = raw.trim().slice(0, 80);
			if (name && plausibleName(name, productStems(base))) {
				base.name = name;
				used = true;
			}
			continue;
		}
		const kept = verifyExtractField(raw, corpusLower, SEPS[field] || ', ');
		let next = kept;
		if (field === 'dependency_names') {
			const toks = kept.split(',').map((s) => s.trim()).filter((s) => s && consumerPkgName(s));
			const primary = toks[0] || '';
			next = toks.filter((s) => pkgAlias(primary, s)).join(', ');
		}
		if (field === 'hosted_markers') {
			next = kept.split(',').map((s) => s.trim()).filter((s) => s && !/^(PREFERENCE|VSCODE|EDITOR)_/i.test(s)).join(', ');
		}
		if (field === 'invocation') {
			const stems = productStems(base);
			next = kept.split('|').map((s) => s.trim()).filter((s) => s && okInvocation(s, stems)).join(' | ');
		}
		if (field === 'cli_verbs') {
			next = kept.split(',').map((s) => s.trim()).filter((s) => s && isCliPhrase(s)).join(', ');
		}
		if (kept && next) {
			base[field] = next;
			used = true;
		}
	}
	const suggestions = (llm.suggestions && typeof llm.suggestions === 'object')
		? llm.suggestions as { competitors?: string; neutral?: string }
		: undefined;
	return {
		config: base,
		usedLlm: used,
		warnings,
		suggestions: suggestions
			? {
				competitors: String(suggestions.competitors || ''),
				neutral: String(suggestions.neutral || ''),
			}
			: undefined,
	};
}
