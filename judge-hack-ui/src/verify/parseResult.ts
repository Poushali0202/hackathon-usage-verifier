import type { ExtractedTarget, VerifyResult } from '../types';

function parseJsonObject<T extends object>(value: string): T | null {
	const text = String(value || '');
	const tryParse = (s: string): T | null => {
		try {
			const parsed = JSON.parse(s) as T;
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	};
	const trimmed = tryParse(text.trim());
	if (trimmed) return trimmed;
	const marker = Math.max(text.lastIndexOf('"schema"'), text.lastIndexOf('"status"'));
	if (marker >= 0) {
		const start = text.lastIndexOf('{', marker);
		const end = text.lastIndexOf('}');
		if (start >= 0 && end > start) {
			const parsed = tryParse(text.slice(start, end + 1));
			if (parsed) return parsed;
		}
	}
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	return tryParse(text.slice(start, end + 1));
}

/** Unwrap Daytona `{output,error,exit_code}` into the evaluator JSON. */
export function parseDaytonaResult(value: unknown): VerifyResult {
	if (typeof value === 'string') {
		return parseJsonObject<VerifyResult>(value) ?? { status: 'invalid', reason: value };
	}
	if (!value || typeof value !== 'object') {
		return { status: 'invalid', reason: 'Empty Daytona response' };
	}
	const tool = value as {
		error?: string;
		output?: string;
		exit_code?: number;
		truncated?: boolean;
		schema?: string;
		status?: string;
	};
	if (tool.schema === 'hackjudge.daytona.v1' || (tool.status && !('output' in tool) && !('exit_code' in tool))) {
		return tool as VerifyResult;
	}
	const parsed = typeof tool.output === 'string' ? parseJsonObject<VerifyResult>(tool.output) : null;
	if (tool.truncated) {
		return {
			status: 'fetch_incomplete',
			reason: 'Daytona output was truncated — no verdict on a partial payload',
			truncated: true,
			...(parsed && parsed.status && parsed.status !== 'complete' ? parsed : {}),
			tag: undefined,
			backbone: undefined,
			score: undefined,
			breakdown: undefined,
			pipelines: undefined,
		};
	}
	if (parsed) {
		if (parsed.truncated) {
			return {
				...parsed,
				status: 'fetch_incomplete',
				reason: String(parsed.reason || 'Evaluator payload was truncated — no verdict on partial retrieval'),
				tag: undefined,
				backbone: undefined,
				score: undefined,
				breakdown: undefined,
				pipelines: undefined,
			};
		}
		return parsed;
	}
	if (tool.error) {
		return { status: 'unverifiable', reason: `Daytona sandbox error: ${tool.error}`, output: tool.output };
	}
	const exitReason = tool.exit_code === 127
		? 'Daytona sandbox has no Python interpreter (exit 127)'
		: (tool.exit_code ? `Daytona exit ${tool.exit_code}` : 'Daytona returned no JSON verdict');
	return {
		status: 'unverifiable',
		reason: exitReason,
		output: tool.output ?? JSON.stringify(value),
	};
}

/** Unwrap Daytona output into extract.finalize JSON. */
export function parseExtractResult(value: unknown): ExtractedTarget {
	if (typeof value === 'string') {
		return parseJsonObject<ExtractedTarget>(value) ?? { status: 'failed', reason: value };
	}
	if (!value || typeof value !== 'object') {
		return { status: 'failed', reason: 'Empty Daytona response' };
	}
	const tool = value as {
		error?: string;
		output?: string;
		exit_code?: number;
		schema?: string;
		status?: string;
		reason?: string;
	};
	if (tool.schema === 'hackjudge.extract.v1' || (tool.status && !('output' in tool) && !('exit_code' in tool))) {
		return tool as ExtractedTarget;
	}
	const parsed = typeof tool.output === 'string' ? parseJsonObject<ExtractedTarget>(tool.output) : null;
	const truncated = !!(tool as { truncated?: boolean }).truncated;
	if (parsed && parsed.schema === 'hackjudge.extract.v1' && parsed.status === 'complete') return parsed;
	if (truncated) {
		return { status: 'failed', reason: 'Daytona output was truncated — no target prefill on a partial payload' };
	}
	if (parsed) return parsed;
	if (tool.error) {
		return { status: 'failed', reason: `Daytona sandbox error: ${tool.error}` };
	}
	return {
		status: 'failed',
		reason: tool.exit_code === 127
			? 'Daytona sandbox has no Python interpreter (exit 127)'
			: (tool.exit_code ? `Daytona exit ${tool.exit_code}` : 'Daytona returned no extract JSON'),
	};
}
