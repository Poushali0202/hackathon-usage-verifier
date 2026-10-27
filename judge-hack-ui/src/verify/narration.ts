/**
 * AI narration (Option A): detect the Anthropic key NAME only, and narrate
 * already-scored rows without re-verifying. The app never reads, writes, or
 * displays the key value.
 */
import type { VerifyResult } from '../types';
import type { ExplainProse } from './explainParse';

export const ANTHROPIC_KEY_NAME = 'ROCKETRIDE_ANTHROPIC_KEY';

export const NARRATION_COPY = {
	fallbackLabel: 'Summary from verified evidence',
	offBeside: 'AI narration is off',
	enable: 'Enable AI narration',
	dialogSentence: 'AI narration uses an Anthropic API key stored in Environment Variables. Judge Hack never sees the key; the platform provides it to the explanation step directly.',
	copyName: 'Copy name',
	checkAgain: "I've added it, check again",
	notFound: 'Key not found yet. The name must match exactly.',
	toastOn: 'AI narration is on.',
	settingsTitle: 'AI narration',
	statusOn: 'On',
	statusOff: 'Off',
	statusChecking: 'Checking',
	settingsOff: 'Off. Verdicts still use verified evidence.',
	settingsOn: 'On. Project summaries use the model.',
	settingsOffBody: 'Add ROCKETRIDE_ANTHROPIC_KEY in Environment Variables to turn on AI-written prose. Scores will not change.',
	settingsOnBody: 'The Anthropic key is managed in Settings, then Environment Variables. Judge Hack never sees the value.',
	openEnv: 'Open Environment Variables',
	dossierOffBody: 'These paragraphs are from verified evidence. Add an Anthropic key in Environment Variables to write model prose. Scores will not change.',
	dossierReadyBody: 'This project still has the evidence summary. Write model prose without changing the score.',
	writeProject: 'Write narration for this project',
	aiLabel: 'AI narration',
	authFailure: 'The Anthropic key was rejected by the model service. Check it in Environment Variables.',
	dialogStepAdd: 'Add the key under that exact name at user scope (org scope if the whole team should have narration).',
	dialogStepBack: 'Come back here and check again.',
} as const;

export type EnvKeysClient = {
	account: {
		getEnvironmentKeys: () => Promise<string[]>;
	};
};

/** Names-only. Never call getEnv from this module. */
export function narrationOnFromNames(names: unknown): boolean {
	if (!Array.isArray(names)) return false;
	return names.some((name) => String(name) === ANTHROPIC_KEY_NAME);
}

export async function readNarrationOn(client: EnvKeysClient | null | undefined): Promise<boolean> {
	if (!client?.account?.getEnvironmentKeys) return false;
	const names = await client.account.getEnvironmentKeys();
	return narrationOnFromNames(names);
}

export function isFailedRow(result: VerifyResult): boolean {
	return !!result.classify_failed || result.repo_accessible === false
		|| result.status === 'unverifiable' || result.status === 'fetch_incomplete';
}

export function hasStoredVerdict(result: VerifyResult): boolean {
	return result.tag != null && String(result.tag) !== ''
		&& result.backbone != null && String(result.backbone) !== ''
		&& result.score != null && Number.isFinite(Number(result.score));
}

/** Scored fallback row. FAILED / inaccessible rows are never narratable. */
export function isNarratable(result: VerifyResult): boolean {
	if (isFailedRow(result)) return false;
	if (!hasStoredVerdict(result)) return false;
	return !!result.explain_failed;
}

export function narratableIndexes(results: VerifyResult[] | undefined): number[] {
	return (results || []).map((row, i) => (isNarratable(row) ? i : -1)).filter((i) => i >= 0);
}

export function runNarrateLabel(n: number): string {
	return `Narrate this run (${n} remaining)`;
}

export function batchConfirm(n: number): string {
	return `Write narration for ${n} projects using the Anthropic key on your account? Scores will not change.`;
}

export function progressLine(x: number, n: number): string {
	return `Narrating ${x} of ${n}`;
}

export function endSummary(k: number, n: number, m: number): string {
	return `Narrated ${k} of ${n}. ${m} could not be narrated; their summaries are unchanged.`;
}

export function explainVerdictConflicts(prose: ExplainProse, stored: VerifyResult): boolean {
	if (prose.tag != null && String(prose.tag) && String(prose.tag) !== String(stored.tag)) return true;
	if (prose.backbone != null && String(prose.backbone) && String(prose.backbone) !== String(stored.backbone)) return true;
	if (prose.score != null && Number.isFinite(Number(prose.score)) && Number(prose.score) !== Number(stored.score)) return true;
	return false;
}

const PROSE_KEYS = ['description', 'rocketride_usage', 'justification', 'explain_failed', 'explain_error', 'names', 'project'] as const;

/**
 * Keep the stored verdict. Only prose fields and explain_failed may change.
 * A failed or contradicting explain leaves the fallback row narratable.
 */
export function applyNarration(stored: VerifyResult, explained: VerifyResult): VerifyResult {
	if (explainVerdictConflicts(explained, stored)) return stored;
	if (explained.explain_failed) return stored;
	const next: VerifyResult = { ...stored };
	for (const key of PROSE_KEYS) {
		if (key in explained) (next as Record<string, unknown>)[key] = explained[key];
	}
	next.explain_failed = false;
	next.explain_error = undefined;
	next.tag = stored.tag;
	next.backbone = stored.backbone;
	next.score = stored.score;
	return next;
}

export function verdictFields(result: VerifyResult): Pick<VerifyResult, 'tag' | 'backbone' | 'score'> {
	return { tag: result.tag, backbone: result.backbone, score: result.score };
}

export function classifyNarrateError(message: string): 'auth' | 'rate' | 'transient' {
	const t = String(message || '').toLowerCase();
	if (/429|rate limit|too many requests|resource_exhausted/.test(t)) return 'rate';
	if (/401|403|unauthorized|forbidden|invalid.?api.?key|authentication|api key.*reject|invalid x-api-key/.test(t)) {
		return 'auth';
	}
	return 'transient';
}

export type NarrationChrome = {
	fallbackLabel: boolean;
	offBeside: boolean;
	enable: boolean;
	writeProject: boolean;
	aiLabel: boolean;
};

export function narrationChrome(narrationOn: boolean | null, result: VerifyResult): NarrationChrome {
	const failed = isFailedRow(result);
	const fallback = !failed && !!result.explain_failed;
	const model = !failed && !result.explain_failed && hasStoredVerdict(result);
	return {
		fallbackLabel: fallback,
		offBeside: fallback && narrationOn === false,
		enable: fallback && narrationOn === false,
		writeProject: isNarratable(result) && narrationOn === true,
		aiLabel: model && narrationOn === true,
	};
}
