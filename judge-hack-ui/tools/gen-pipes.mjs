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
 * The Daytona graph keeps a dummy `agent_rocketride` so `tool_daytona` can be
 * invoked from the app via `client.tool`. The agent is instructed not to
 * answer or invent JSON — it is not on the scoring path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');

/** Permanent identities. Do not change. */
export const PROJECT_IDS = {
	daytona: 'bde4acbb-7db2-4a97-8d01-28214a1bc284',
	explain: 'cf2762a0-ee71-4f77-9d99-1296e81e71b4',
	sql: '8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36',
	sqlExternal: 'c5d9e2b8-1a47-4f06-8d3c-9b7e0a4f2c18',
};

/** Shared graph-tool node id across default / external SQL variants. */
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

const daytona = {
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
			name: 'V1 Daytona Runner',
			config: {
				instructions: [
					'You are only here so the Daytona sandbox can be invoked as a tool. Do not answer the user. Do not call any tool. Do not invent JSON. If you receive a chat message, reply with exactly: WAITING_FOR_TOOL',
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
			id: 'daytona_1',
			provider: 'tool_daytona',
			name: 'Daytona',
			config: {
				type: 'tool_daytona',
				apikey: '${ROCKETRIDE_DAYTONA_KEY}',
				api_url: '',
				target: '',
				snapshot: '',
				language: 'python',
				auto_stop_minutes: 10,
				exec_timeout_secs: 1200,
				max_output_chars: 1000000,
				github_token: '${ROCKETRIDE_GITHUB_TOKEN}',
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
	name: 'Judge Hack Daytona V1',
	description: 'Fully RocketRide-hosted repository verification using one deterministic Daytona execution per repository.',
	source: 'chat_1',
	isLocked: false,
	project_id: PROJECT_IDS.daytona,
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

const sqlExternal = {
	components: sqlGraph('db_postgres', {
		allow_execute: true,
		host: '${ROCKETRIDE_HACKJUDGE_PG_HOST}',
		user: '${ROCKETRIDE_HACKJUDGE_PG_USER}',
		password: '${ROCKETRIDE_HACKJUDGE_PG_PASSWORD}',
		database: '${ROCKETRIDE_HACKJUDGE_PG_DATABASE}',
		table: 'hj_runs',
		db_description: SQL_DESCRIPTION,
		max_attempts: 1,
	}),
	name: 'Judge Hack SQL V1 (external)',
	description: 'Transitional db_postgres fallback. Same node id sql_1. Do not deploy unless the rocketride_sql broker probe fails.',
	source: 'chat_1',
	isLocked: false,
	project_id: PROJECT_IDS.sqlExternal,
	viewport: VIEWPORT,
	version: 1,
};

const PIPES = [
	['hackjudge_daytona_v1.pipe', daytona],
	['hackjudge_explain_v1.pipe', explain],
	['hackjudge_sql_v1.pipe', sql],
	['hackjudge_sql_v1.external.pipe', sqlExternal],
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
