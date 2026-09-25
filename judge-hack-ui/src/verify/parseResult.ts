import type { ExtractedTarget, VerifyResult } from '../types';

export const VERIFY_SCHEMA = 'hackjudge.python.v1';
export const EXTRACT_SCHEMA = 'hackjudge.extract.v1';

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

type PythonShape = {
	stdout?: string;
	stderr?: string;
	exit_code?: number;
	timed_out?: boolean;
	result?: unknown;
	schema?: string;
	status?: string;
};

function lastLine(text: string): string {
	const lines = String(text || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
	return lines.length ? lines[lines.length - 1].slice(0, 400) : '';
}

/** Why tool_python returned no evaluator object. */
function executionFailure(tool: PythonShape): string {
	if (tool.timed_out) return 'Evaluator timed out on the RocketRide engine — no verdict on a partial run';
	const err = lastLine(tool.stderr || '');
	if (err) return `Evaluator error: ${err}`;
	if (tool.exit_code) return `Evaluator exited with code ${tool.exit_code}`;
	return 'Evaluator returned no JSON verdict';
}

function withoutVerdict(parsed: VerifyResult, reason: string): VerifyResult {
	return {
		...parsed,
		status: 'fetch_incomplete',
		reason,
		tag: undefined,
		backbone: undefined,
		score: undefined,
		breakdown: undefined,
		pipelines: undefined,
	};
}

/** Unwrap tool_python `{result, stdout, stderr, exit_code, timed_out}` into the evaluator JSON. */
export function parsePythonResult(value: unknown): VerifyResult {
	if (typeof value === 'string') {
		return parseJsonObject<VerifyResult>(value) ?? { status: 'invalid', reason: value };
	}
	if (!value || typeof value !== 'object') {
		return { status: 'invalid', reason: 'Empty evaluator response' };
	}
	const tool = value as PythonShape;
	if (tool.schema === VERIFY_SCHEMA || (tool.status && !('stdout' in tool) && !('exit_code' in tool) && !('result' in tool))) {
		return tool as VerifyResult;
	}
	let parsed: VerifyResult | null = null;
	if (tool.result && typeof tool.result === 'object') {
		parsed = tool.result as VerifyResult;
	} else if (typeof tool.result === 'string') {
		parsed = parseJsonObject<VerifyResult>(tool.result);
	}
	if (!parsed && typeof tool.stdout === 'string') {
		parsed = parseJsonObject<VerifyResult>(tool.stdout);
	}
	if (tool.timed_out) {
		return { status: 'unverifiable', reason: executionFailure(tool), output: tool.stderr || tool.stdout };
	}
	if (parsed && parsed.status) {
		if (parsed.truncated) {
			return withoutVerdict(parsed, String(parsed.reason || 'Evaluator payload was truncated — no verdict on partial retrieval'));
		}
		return parsed;
	}
	return {
		status: 'unverifiable',
		reason: executionFailure(tool),
		output: tool.stderr || tool.stdout || JSON.stringify(value),
	};
}

/** Unwrap tool_python output into extract.finalize JSON. */
export function parseExtractResult(value: unknown): ExtractedTarget {
	if (typeof value === 'string') {
		return parseJsonObject<ExtractedTarget>(value) ?? { status: 'failed', reason: value };
	}
	if (!value || typeof value !== 'object') {
		return { status: 'failed', reason: 'Empty evaluator response' };
	}
	const tool = value as PythonShape & { reason?: string };
	if (tool.schema === EXTRACT_SCHEMA || (tool.status && !('stdout' in tool) && !('exit_code' in tool) && !('result' in tool))) {
		return tool as ExtractedTarget;
	}
	let parsed: ExtractedTarget | null = null;
	if (tool.result && typeof tool.result === 'object') {
		parsed = tool.result as ExtractedTarget;
	} else if (typeof tool.result === 'string') {
		parsed = parseJsonObject<ExtractedTarget>(tool.result);
	}
	if (!parsed && typeof tool.stdout === 'string') {
		parsed = parseJsonObject<ExtractedTarget>(tool.stdout);
	}
	if (tool.timed_out) {
		return { status: 'failed', reason: executionFailure(tool) };
	}
	if (parsed && parsed.status) return parsed;
	return { status: 'failed', reason: executionFailure(tool) };
}
