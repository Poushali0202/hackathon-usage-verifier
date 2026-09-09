import { EVALUATOR_BUNDLE } from './generated/evaluatorBundle';

export type DaytonaToolClient = {
	tool: (opts: {
		token: string;
		tool: string;
		nodeId?: string;
		input?: Record<string, unknown>;
		timeout?: number;
	}) => Promise<unknown>;
};

export type VerifyJob = {
	repo: string;
	eventDate?: string;
	historyPenalty?: number;
	customTarget?: { name: string; config: Record<string, unknown> };
};

export type ExtractJob = {
	repoUrl?: string;
	docsUrl?: string;
	pkg?: string;
	uploads?: Record<string, string>;
};

type ToolExec = {
	error?: string;
	output?: string;
	exit_code?: number;
	truncated?: boolean;
	success?: boolean;
	path?: string;
};

const TOOL_TIMEOUT_MS = 600_000;
const NO_PYTHON_JSON = '{"schema":"hackjudge.daytona.v1","status":"unverifiable","reason":"Daytona sandbox has no Python interpreter (python3/python not on PATH)"}';

const BUNDLE = EVALUATOR_BUNDLE;

export async function invokeTool(
	client: DaytonaToolClient,
	token: string,
	tool: string,
	input: Record<string, unknown>,
	timeout = TOOL_TIMEOUT_MS,
): Promise<unknown> {
	try {
		return await client.tool({ token, tool, nodeId: 'daytona_1', input, timeout });
	} catch (first) {
		return await client.tool({
			token, tool: `daytona.${tool}`, nodeId: 'daytona_1', input, timeout,
		}).catch(() => { throw first; });
	}
}

export function toolExec(value: unknown): ToolExec {
	return value && typeof value === 'object' ? value as ToolExec : {};
}

export function toolExit(value: unknown): number | undefined {
	const n = Number(toolExec(value).exit_code);
	return Number.isFinite(n) ? n : undefined;
}

function pythonCmd(script: string): string {
	const inner = [
		`if command -v python3 >/dev/null 2>&1; then python3 ${script}`,
		`elif command -v python >/dev/null 2>&1; then python ${script}`,
		`else echo '${NO_PYTHON_JSON}'; exit 127`,
		'fi',
	].join('; ');
	return `sh -c ${JSON.stringify(inner)}`;
}

async function invokeUpload(client: DaytonaToolClient, token: string, path: string, content: string): Promise<void> {
	const result = toolExec(await invokeTool(client, token, 'upload_file', { path, content }, 120_000));
	if (result.success === false || result.error) {
		throw new Error(result.error || `upload_file failed for ${path}`);
	}
}

async function invokeCommand(client: DaytonaToolClient, token: string, command: string, timeout = TOOL_TIMEOUT_MS): Promise<unknown> {
	return invokeTool(client, token, 'run_command', { command }, timeout);
}

/** Upload the evaluator once per sandbox. Files persist until the sandbox is recycled. */
export async function uploadEvaluatorBundle(client: DaytonaToolClient, token: string): Promise<void> {
	const mkdir = toolExec(await invokeCommand(client, token, 'sh -c "mkdir -p hj/targets"', 30_000));
	if (mkdir.error) throw new Error(mkdir.error);
	for (const [path, content] of BUNDLE) {
		await invokeUpload(client, token, path, content);
	}
}

async function runScript(client: DaytonaToolClient, token: string, script: string, timeout: number): Promise<unknown> {
	try {
		return await invokeCommand(client, token, pythonCmd(script), timeout);
	} catch (first) {
		const bootstrap = `import runpy\nrunpy.run_path(${JSON.stringify(script)}, run_name="__main__")\n`;
		try {
			return await invokeTool(client, token, 'run_code', { code: bootstrap }, timeout);
		} catch {
			throw first;
		}
	}
}

export async function runVerifyInSandbox(
	client: DaytonaToolClient,
	token: string,
	job: VerifyJob,
	timeout = TOOL_TIMEOUT_MS,
): Promise<unknown> {
	const payload = {
		repo: job.repo,
		eventDate: job.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(job.eventDate) ? job.eventDate : '',
		historyPenalty: Number.isFinite(job.historyPenalty) ? job.historyPenalty : null,
		customTarget: job.customTarget
			? { name: job.customTarget.name, ...job.customTarget.config }
			: null,
	};
	await invokeUpload(client, token, 'hj/job.json', JSON.stringify(payload));
	return runScript(client, token, 'hj/run_verify.py', timeout);
}

export async function runExtractInSandbox(
	client: DaytonaToolClient,
	token: string,
	job: ExtractJob,
	timeout = 180_000,
): Promise<unknown> {
	await invokeUpload(client, token, 'hj/job.json', JSON.stringify({
		repoUrl: (job.repoUrl || '').trim(),
		docsUrl: (job.docsUrl || '').trim(),
		pkg: (job.pkg || '').trim(),
		uploads: job.uploads || {},
	}));
	return runScript(client, token, 'hj/run_extract.py', timeout);
}
