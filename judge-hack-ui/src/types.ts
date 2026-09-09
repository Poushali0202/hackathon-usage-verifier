export type View =
	| 'dashboard'
	| 'targets'
	| 'newrun'
	| 'verify'
	| 'runs'
	| 'rundetail'
	| 'settings'
	| 'pricing';

export type RunStatus = 'running' | 'done' | 'stopped' | 'error';

export type PlanTier = 'developer' | 'company' | 'organizers';

export type ActorStamp = {
	userId: string;
	email?: string;
	displayName?: string;
};

export type TargetRecord = {
	id: string;
	name: string;
	is_preset?: boolean;
	config: Record<string, unknown>;
	created_by?: ActorStamp;
	updated_by?: ActorStamp;
	updated_at?: string;
};

export type Submission = {
	project: string;
	github: string;
	names?: string;
	demo?: string;
	deployed?: string;
	feedback?: string;
	target_name?: string;
};

export type PipelineRow = {
	name: string;
	nodes?: number;
	complexity?: string;
	called?: boolean;
	first_commit?: string;
	call_sites?: { file: string; line?: number }[];
};

export type Breakdown = { signal: string; points: number };

export type ArchitecturePane = {
	id: string;
	label: string;
	signal?: string;
	load_bearing?: boolean;
	state?: string;
};

export type LayerMap = Partial<Record<'ingest' | 'retrieval' | 'orchestration' | 'reasoning' | 'output', string>>;

export type VerifyResult = {
	project?: string;
	github?: string;
	names?: string;
	demo?: string;
	deployed?: string;
	tag?: string;
	backbone?: string;
	score?: number;
	seconds?: number;
	description?: string;
	rocketride_usage?: string;
	justification?: string;
	notes?: string;
	evidence?: string[];
	pipelines?: PipelineRow[];
	breakdown?: Breakdown[];
	tech?: string[];
	other_platforms?: string[];
	layers?: LayerMap;
	architecture?: ArchitecturePane[];
	platform?: { domains?: string[]; files?: string[]; markers?: string[] };
	target_name?: string;
	scoring?: 'pipeline' | 'generic' | string;
	repo_accessible?: boolean;
	classify_failed?: boolean;
	event_window?: string[] | { start?: string; end?: string; event?: string } | null;
	project_predates?: unknown;
	history_tampered?: { sha?: string; author?: string; committer?: string }[];
	reused_pipelines?: Array<string | { name?: string; first_commit?: string }>;
	earliest_commit?: string;
	history_penalty?: number;
	status?: string;
	reason?: string;
	explain_failed?: boolean;
	explain_error?: string;
	readme_head?: string;
	readme_title?: string;
	pipelines_called?: number;
	pipelines_total?: number;
	[key: string]: unknown;
};

export type ExtractedTarget = {
	status?: string;
	reason?: string;
	repo?: string;
	config?: Record<string, unknown>;
	warnings?: string[];
	suggestions?: { competitors?: string; neutral?: string };
	sources?: Record<string, string[]>;
};

export type RunSummary = {
	tags?: Record<string, number>;
	backbone?: Record<string, number>;
};

export type StoredRun = {
	id: string;
	name: string;
	event_date: string;
	history_penalty: number;
	target_name: string;
	target_id?: string;
	status: RunStatus;
	results: VerifyResult[];
	total: number;
	summary?: RunSummary;
	significant_count: number;
	flagged_count: number;
	done_count: number;
	created_at: string;
	created_by?: ActorStamp;
	updated_by?: ActorStamp;
	updated_at?: string;
	finished_at?: string;
	error?: string;
	stage?: string;
};

export type JudgeSettings = {
	grace_days: number;
	history_penalty: number;
	plan: PlanTier;
	billingStatus?: string;
};

export type StoreStatus = {
	kind: 'appState' | 'sql';
	ready: boolean;
	error?: string;
	broker?: boolean;
	imported?: number;
};

export type Allowance = {
	estimated_kb: number;
	budget_kb: number;
	est_verified_rows: number;
	next_tier?: string;
};
