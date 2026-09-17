/** Merge LLM extract JSON onto the deterministic draft. Tokens must appear in the corpus. */

const FIELDS = [
	'name', 'dependency_names', 'artifacts', 'invocation', 'hosted_markers', 'cli_verbs',
	'platform_domains', 'platform_files', 'platform_markers',
] as const;

const SEPS: Record<string, string> = { invocation: ' | ' };

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
	const kept: string[] = [];
	for (const tok of String(value || '').split(/[|,\n]/)) {
		const t = tok.trim();
		if (!t) continue;
		const words = t.split(/\s+/).map((w) => w.replace(/^[*.]+/, '').toLowerCase()).filter(Boolean);
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
			if (name) {
				base.name = name;
				used = true;
			}
			continue;
		}
		const kept = verifyExtractField(raw, corpusLower, SEPS[field] || ', ');
		if (kept) {
			base[field] = kept;
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
