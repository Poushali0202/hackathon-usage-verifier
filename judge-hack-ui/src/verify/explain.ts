import { Question } from 'rocketride';
import type { PipelineConfig } from 'rocketride';
import type { Submission, VerifyResult } from '../types';
import { genericScoreMath, usesPipelineRubric } from '../format';
import explainPipe from '../pipelines/hackjudge_explain_v1.pipe';
import {
	extractProseFromResponse,
	hasUsableProse,
	sanitizeExplainProse,
	type ExplainProse,
} from './explainParse';

export type { ExplainProse } from './explainParse';
export { extractProse, extractProseFromResponse } from './explainParse';

/** Generated graph. `tools/gen-pipes.mjs` is the source of truth. */
export const explainPipeline = explainPipe as unknown as PipelineConfig;

const EXPLAIN_PROMPT = `You are documenting how a hackathon project used RocketRide, for a judge.

The VERDICT has ALREADY been decided deterministically from the project's actual code - you must NOT
change it. Your only job is to explain it in plain English, grounded entirely in the evidence table
you are given (pipelines, their node counts, and whether each is actually CALLED in the code, with
call sites).

Return ONLY a strict JSON object - start with { and end with }, no prose outside it:
{
  "description": "<1-2 sentences: what the project does>",
  "rocketride_usage": "<1-2 sentences: concretely how it uses RocketRide - name the pipeline(s), the
                        node count, and whether/where they are called; ground every claim in the table>",
  "justification": "<2-3 sentences: why the code earns THIS tag and backbone, citing the table (e.g.
                     'the 7-node agent pipeline is loaded and run at relay.ts:83'). If a pipeline is
                     present but never called, say so explicitly. If a pipeline predates the event
                     window (reused), call that out.>",
  "project_name": "<ONLY if the README clearly states the project's name - else omit>",
  "team_members": "<ONLY if the README clearly lists team member names - comma-separated - else omit>"
}
Rules: cite ONLY what is in the evidence. Never contradict the verdict. If the tag is None, state that
the code shows no real RocketRide usage. Write plainly and never use em dashes anywhere in your
prose; use commas, periods, or parentheses instead.`;

const GENERIC_EXPLAIN_PROMPT = `You are documenting how a hackathon project used TARGET, for a judge.

The VERDICT has ALREADY been decided deterministically from the project's actual code - you must NOT
change it. TARGET is an SDK, API, or platform. It is NOT judged on RocketRide RAG pipelines, .pipe
files, agent nodes, or LLM nodes. Explain only from the score breakdown and SDK/platform evidence
(dependency, invocation call-sites, runtime API usage, env wiring, artifacts, deploy domains).

Return ONLY a strict JSON object - start with { and end with }, no prose outside it:
{
  "description": "<1-2 sentences: what the project does>",
  "rocketride_usage": "<1-2 sentences: concretely how it uses TARGET - cite the breakdown signals>",
  "justification": "<2-3 sentences: why the code earns THIS tag and backbone, citing those signals>",
  "project_name": "<ONLY if the README clearly states the project's name - else omit>",
  "team_members": "<ONLY if the README clearly lists team member names - comma-separated - else omit>"
}
Rules: cite ONLY what is in the evidence. Never mention pipelines, RAG, or retrieval unless those
words appear in the evidence table. Never contradict the verdict. If the tag is None, state that
the code shows no real TARGET usage. Write plainly and never use em dashes anywhere in your
prose; use commas, periods, or parentheses instead.`;

function pipelinePayload(result: VerifyResult) {
	return (result.pipelines || []).map((p) => ({
		name: p.name,
		nodes: p.nodes,
		complexity: p.complexity,
		has_agent: Boolean((p as { has_agent?: boolean }).has_agent),
		called: p.called,
		first_commit: p.first_commit,
		call_sites: (p.call_sites || []).map((s) => `${s.file}:${s.line}`),
	}));
}

export function explainPrompt(
	result: VerifyResult,
	project: string,
	repo: string,
	feedback: string,
	readmeHead: string,
	targetName: string,
): string {
	const payload = {
		verdict: { tag: result.tag, backbone: result.backbone, score: result.score },
		score_breakdown: result.breakdown || [],
		pipelines: pipelinePayload(result),
		sdk: result.sdk || {},
		other_platforms: result.other_platforms || [],
		event_window: result.event_window,
		reused_pipelines: result.reused_pipelines || [],
		...(result.platform ? { platform_evidence: result.platform } : {}),
	};
	const readmeBlock = readmeHead
		? `\n\nREADME EXCERPT (for project_name / team_members / description only):\n${readmeHead.slice(0, 2500)}`
		: '';
	const base = usesPipelineRubric(result)
		? (targetName === 'RocketRide' ? EXPLAIN_PROMPT : EXPLAIN_PROMPT.replace(/RocketRide/g, targetName))
		: GENERIC_EXPLAIN_PROMPT.replace(/TARGET/g, targetName || 'the target');
	return (
		`${base}\n\nPROJECT: ${project}\nREPO: ${repo}\n`
		+ `TEAM FEEDBACK (context only - the verdict is already fixed from code): ${feedback || '(none provided)'}\n\n`
		+ `DETERMINISTIC EVALUATION (do not change the verdict):\n`
		+ `${JSON.stringify(payload, null, 2)}${readmeBlock}`
	);
}

function firstSentences(text: string, n = 2): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (!clean) return '';
	const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
	return parts.slice(0, n).join(' ');
}

/** Evidence-table paragraphs so the dossier always has What it is / How used. */
export function fallbackProse(result: VerifyResult): ExplainProse {
	const target = result.target_name || 'RocketRide';
	const project = result.project || result.github || 'This repository';
	const readme = firstSentences(String(result.readme_head || ''), 2);
	const description = readme
		|| `${project} is a hackathon repository verified against ${target}.`;
	if (!usesPipelineRubric(result)) {
		const hits = (result.breakdown || []).filter((b) => b.points > 0).map((b) => b.signal);
		const missing = (result.architecture || [])
			.filter((p) => p.state !== 'target' && p.state !== 'other')
			.map((p) => p.label);
		const why = [
			genericScoreMath(result),
			hits.length ? `Positive signals: ${hits.join('; ')}.` : `No positive ${target} SDK or platform signals fired.`,
			missing.length ? `Architecture panes with no hit: ${missing.join(', ')}.` : '',
			'A README deploy-domain mention is not enough for backbone Yes when tag is None or Less.',
		].filter(Boolean).join(' ');
		return {
			description,
			rocketride_usage: hits.length
				? `${target} is evidenced by: ${hits.join('; ')}.`
				: `No ${target} SDK, API, or platform usage was found in this repository.`,
			justification: why,
		};
	}
	const called = (result.pipelines || []).filter((p) => p.called);
	const sites = (called[0]?.call_sites || []).slice(0, 3)
		.map((s) => `${s.file}${s.line != null ? `:${s.line}` : ''}`).join(', ');
	const rocketride_usage = called.length
		? `${target} is used via ${called.map((p) => `${p.name} (${p.nodes ?? '?'} nodes, ${p.complexity || 'unknown'} complexity)`).join('; ')}${sites ? `, called at ${sites}` : ''}.`
		: (result.pipelines || []).length
			? `${target} pipeline files are present but none are invoked in application code.`
			: `No ${target} pipeline usage was found in this repository.`;
	return {
		description,
		rocketride_usage,
		justification: String(result.notes || result.justification || ''),
	};
}

export function mergeProse(result: VerifyResult, prose: ExplainProse): VerifyResult {
	const failed = !!result.classify_failed || result.repo_accessible === false
		|| result.status === 'unverifiable' || result.status === 'fetch_incomplete';
	if (failed) {
		return {
			...result,
			explain_failed: true,
			explain_error: prose.explain_error || result.explain_error,
			description: undefined,
			rocketride_usage: undefined,
		};
	}
	const cleaned = sanitizeExplainProse(prose);
	const llmOk = hasUsableProse({ ...cleaned, explain_failed: prose.explain_failed });
	const fb = fallbackProse(result);
	if (!llmOk) {
		const note = String(result.notes || '');
		const err = prose.explain_error || 'explanation unavailable';
		return {
			...result,
			tag: result.tag,
			backbone: result.backbone,
			score: result.score,
			explain_failed: true,
			explain_error: err,
			description: fb.description,
			rocketride_usage: fb.rocketride_usage,
			notes: note,
			justification: fb.justification || note,
		};
	}
	const repoSlug = String(result.github || '').split('/').filter(Boolean).pop()?.replace(/\.git$/i, '') || '';
	const projectFromReadme = String(cleaned.project_name || '').trim();
	const projectLooksLikeSlug = !result.project || result.project === repoSlug
		|| result.project.toLowerCase() === repoSlug.toLowerCase();
	return {
		...result,
		tag: result.tag,
		backbone: result.backbone,
		score: result.score,
		explain_failed: false,
		explain_error: undefined,
		description: cleaned.description || fb.description,
		rocketride_usage: cleaned.rocketride_usage || fb.rocketride_usage,
		justification: cleaned.justification || result.justification || fb.justification,
		project: projectFromReadme && projectLooksLikeSlug ? projectFromReadme : result.project,
		names: result.names || cleaned.team_members || result.names,
	};
}

type ChatClient = {
	chat: (opts: { token: string; question: Question }) => Promise<unknown>;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ask the explain pipeline. Never throws; missing prose falls back to the evidence table.
 *  Guardrail: the LLM cannot change tag, backbone, or score. */
export async function explainVerdict(
	client: ChatClient,
	token: string,
	result: VerifyResult,
	row: Submission,
): Promise<VerifyResult> {
	if (result.classify_failed || result.repo_accessible === false || result.status === 'unverifiable'
		|| result.status === 'fetch_incomplete') {
		return mergeProse(result, { explain_failed: true, explain_error: String(result.reason || result.status || 'unverifiable') });
	}
	const prompt = explainPrompt(
		result,
		result.project || row.project || '',
		result.github || row.github || '',
		row.feedback || '',
		String(result.readme_head || ''),
		result.target_name || 'RocketRide',
	);
	let lastError = '';
	for (let attempt = 0; attempt < 3; attempt++) {
		if (attempt) await sleep(400 * attempt);
		try {
			const question = new Question({ expectJson: attempt === 0 });
			question.addQuestion(attempt === 0
				? prompt
				: `${prompt}\n\nREMINDER: reply with ONLY the strict JSON object. Do not wrap it in markdown.`);
			const resp = await Promise.race([
				client.chat({ token, question }),
				new Promise<never>((_, reject) => {
					setTimeout(() => reject(new Error('explain timeout')), 90_000);
				}),
			]);
			const parsed = extractProseFromResponse(resp);
			if (hasUsableProse(parsed)) return mergeProse(result, parsed);
			lastError = 'LLM reply did not contain description / usage JSON';
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
	}
	return mergeProse(result, { explain_failed: true, explain_error: lastError });
}
