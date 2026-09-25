/**
 * Owns every Judge Hack `.pipe` file.
 *
 * Stable project_ids are pinned here. Task addressing and deploy history key
 * on them — never regenerate. Writes `src/pipelines/` (app import + Stage 2
 * validate/deploy) and workspace `pipelines/` (disk-based tooling). The
 * Design canvas may rewrite `project_id` on watched `pipelines/` folders.
 *
 * `components` is always the first field (ROCKETRIDE_PIPELINES.md).
 *
 * The Python graph keeps a dummy `agent_rocketride` so `tool_python` can be
 * invoked from the app via `client.tool`. The agent is instructed not to
 * answer or invent JSON — it is not on the scoring path. The evaluator runs
 * in-process on the RocketRide engine (RestrictedPython); GitHub is read over
 * the REST/raw API with the judge's own token. No sandbox, no clone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');

/** Permanent identities. Do not change. */
export const PROJECT_IDS = {
	python: '3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53',
	explain: 'cf2762a0-ee71-4f77-9d99-1296e81e71b4',
	sql: '8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36',
};

/** Retired personal-Postgres fallback id — never reuse: c5d9e2b8-1a47-4f06-8d3c-9b7e0a4f2c18 */

/** Shared graph-tool node id on the live SQL pipe. */
export const SQL_NODE_ID = 'sql_1';

const SQL_DESCRIPTION = 'Judge Hack runs and custom targets. Deterministic app SQL via execute; the LLM does not invent schema or rows.';

function sqlGraph(provider, profileConfig) {
	return [
		{
			id: 'chat_1',
			provider: 'chat',
			name: 'SQL Source',
			config: { hideForm: true, mode: 'Source', parameters: {}, type: 'chat' },
		},
		{
			id: 'agent_1',
			provider: 'agent_rocketride',
			name: 'SQL Tool Host',
			config: {
				instructions: [
					'You are only here so the SQL node can be invoked as a tool. Do not answer the user. Do not call any tool. Do not invent SQL or JSON. If you receive a chat message, reply with exactly: WAITING_FOR_TOOL',
				],
				max_waves: 1,
				parameters: {},
			},
			input: [{ lane: 'questions', from: 'chat_1' }],
		},
		{
			id: 'llm_1',
			provider: 'llm_anthropic',
			name: 'Anthropic',
			config: {
				profile: 'claude-haiku-4-5',
				'claude-haiku-4-5': { apikey: '${ROCKETRIDE_ANTHROPIC_KEY}' },
				parameters: {},
			},
			control: [
				{ classType: 'llm', from: 'agent_1' },
				{ classType: 'llm', from: SQL_NODE_ID },
			],
		},
		{
			id: 'memory_1',
			provider: 'memory_internal',
			name: 'Execution Memory',
			config: { type: 'memory_internal' },
			control: [{ classType: 'memory', from: 'agent_1' }],
		},
		{
			id: SQL_NODE_ID,
			provider,
			name: 'Judge Hack SQL',
			config: {
				profile: 'default',
				default: profileConfig,
				parameters: {},
			},
			input: [{ lane: 'questions', from: 'chat_1' }],
			control: [{ classType: 'tool', from: 'agent_1' }],
		},
		{
			id: 'response_1',
			provider: 'response_answers',
			name: 'Return SQL',
			config: { laneName: 'answers' },
			input: [{ lane: 'answers', from: 'agent_1' }],
		},
	];
}

const VIEWPORT = { x: 0, y: 0, zoom: 1 };

/** Node ids the app addresses with client.tool({ nodeId }). */
export const PYTHON_NODE_ID = 'python_1';
export const HTTP_NODE_ID = 'http_1';
/** Evaluator wall-clock cap per call (seconds). tool_python allows up to 1200. */
export const PYTHON_TIMEOUT_SECS = 900;
/**
 * Beyond the sandbox defaults (json, re, time, base64, ...): GitHub/docs fetch + HTML unescape.
 * Staging's tool_python currently ignores this field (verified 23 Sep), so the evaluator
 * falls back to replay mode: the app fetches over `http_1` and hands bodies in. When the
 * engine honours the allowlist the same bundle fetches directly - no app change needed.
 */
export const PYTHON_ALLOWED_MODULES = ['urllib', 'html'];

const python = {
	components: [
		{
			id: 'chat_1',
			provider: 'chat',
			name: 'Repository URL',
			config: { hideForm: true, mode: 'Source', parameters: {}, type: 'chat' },
		},
		{
			id: 'agent_1',
			provider: 'agent_rocketride',
			name: 'V1 Evaluator Host',
			config: {
				instructions: [
					'You are only here so the Python evaluator can be invoked as a tool. Do not answer the user. Do not call any tool. Do not invent JSON. If you receive a chat message, reply with exactly: WAITING_FOR_TOOL',
				],
				max_waves: 1,
				parameters: {},
			},
			input: [{ lane: 'questions', from: 'chat_1' }],
		},
		{
			id: 'llm_1',
			provider: 'llm_anthropic',
			name: 'Anthropic',
			config: {
				profile: 'claude-haiku-4-5',
				'claude-haiku-4-5': { apikey: '${ROCKETRIDE_ANTHROPIC_KEY}' },
				parameters: {},
			},
			control: [{ classType: 'llm', from: 'agent_1' }],
		},
		{
			id: 'memory_1',
			provider: 'memory_internal',
			name: 'Execution Memory',
			config: { type: 'memory_internal' },
			control: [{ classType: 'memory', from: 'agent_1' }],
		},
		{
			id: PYTHON_NODE_ID,
			provider: 'tool_python',
			name: 'Evaluator (Python)',
			config: {
				type: 'tool_python',
				serverName: 'python',
				timeout: PYTHON_TIMEOUT_SECS,
				allowedModules: PYTHON_ALLOWED_MODULES.map((moduleName) => ({ moduleName })),
			},
			control: [{ classType: 'tool', from: 'agent_1' }],
		},
		{
			id: HTTP_NODE_ID,
			provider: 'tool_http_request',
			name: 'GitHub fetch (GET only)',
			config: {
				type: 'tool_http_request',
				serverName: 'http',
				allowGET: true,
				allowPOST: false,
				allowPUT: false,
				allowPATCH: false,
				allowDELETE: false,
				allowHEAD: false,
				allowOPTIONS: false,
				rateLimitPerSecond: 20,
				rateLimitPerMinute: 900,
				maxConcurrentRequests: 8,
			},
			control: [{ classType: 'tool', from: 'agent_1' }],
		},
		{
			id: 'response_1',
			provider: 'response_answers',
			name: 'Return Verification',
			config: { laneName: 'answers' },
			input: [{ lane: 'answers', from: 'agent_1' }],
		},
	],
	name: 'Judge Hack Python V1',
	description: 'RocketRide-hosted repository verification: deterministic in-process Python evaluation per repository over the GitHub API (fetched via tool_http_request with the judge\'s own token). No sandbox, no clone.',
	source: 'chat_1',
	isLocked: false,
	project_id: PROJECT_IDS.python,
	viewport: VIEWPORT,
	version: 1,
};

const explain = {
	components: [
		{
			id: 'chat_1',
			provider: 'chat',
			name: 'Chat',
			config: { hideForm: true, mode: 'Source', parameters: {}, type: 'chat' },
		},
		{
			id: 'llm_anthropic_1',
			provider: 'llm_anthropic',
			name: 'Anthropic',
			config: {
				profile: 'claude-haiku-4-5',
				'claude-haiku-4-5': { apikey: '${ROCKETRIDE_ANTHROPIC_KEY}' },
				parameters: {},
			},
			input: [{ lane: 'questions', from: 'chat_1' }],
		},
		{
			id: 'response_answers_1',
			provider: 'response_answers',
			name: 'Return Answers',
			config: { laneName: 'answers' },
			input: [{ lane: 'answers', from: 'llm_anthropic_1' }],
		},
	],
	name: 'Judge Hack Explain V1',
	description: 'Post-verdict prose only. Does not decide tag, backbone, or score.',
	source: 'chat_1',
	isLocked: true,
	project_id: PROJECT_IDS.explain,
	viewport: VIEWPORT,
	version: 1,
};

const sql = {
	components: sqlGraph('rocketride_sql', {
		allow_execute: true,
		table: 'hj_runs',
		db_description: SQL_DESCRIPTION,
		max_attempts: 1,
	}),
	name: 'Judge Hack SQL V1',
	description: 'Staging-managed SQL for runs and custom targets. allow_execute is on so the app issues literal statements; the LLM never writes rows.',
	source: 'chat_1',
	isLocked: false,
	project_id: PROJECT_IDS.sql,
	viewport: VIEWPORT,
	version: 1,
};

const PIPES = [
	['hackjudge_python_v1.pipe', python],
	['hackjudge_explain_v1.pipe', explain],
	['hackjudge_sql_v1.pipe', sql],
];

const destinations = [
	path.join(appRoot, 'src', 'pipelines'),
	path.join(workspaceRoot, 'pipelines'),
];

function serialize(pipe) {
	const ordered = {
		components: pipe.components,
		name: pipe.name,
		description: pipe.description,
		source: pipe.source,
		isLocked: pipe.isLocked,
		project_id: pipe.project_id,
		viewport: pipe.viewport,
		version: pipe.version,
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

for (const dir of destinations) {
	fs.mkdirSync(dir, { recursive: true });
}

const RETIRED = ['hackjudge_daytona_v1.pipe', 'hackjudge_sql_v1.external.pipe'];
for (const dir of destinations) {
	for (const filename of RETIRED) {
		const stale = path.join(dir, filename);
		if (fs.existsSync(stale)) {
			fs.unlinkSync(stale);
			console.log(`Removed retired ${stale}`);
		}
	}
}

for (const [filename, pipe] of PIPES) {
	if (Object.keys(pipe)[0] !== 'components') {
		throw new Error(`${filename}: components must be the first field`);
	}
	const body = serialize(pipe);
	for (const dir of destinations) {
		const dest = path.join(dir, filename);
		fs.writeFileSync(dest, body, 'utf8');
		console.log(`Wrote ${dest}`);
	}
}
