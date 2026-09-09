import type { Submission } from '../types';
import { usesPipelineRubric } from '../format';

const GH_RE = /github\.com[/:]([^/\s#?]+)\/([^/\s#?]+)/i;
const FIELD_ALIASES: Record<string, string[]> = {
	project: ['projecttitle', 'projectname', 'project', 'name', 'title'],
	names: ['teammembersnamesall', 'teammembersnames', 'names', 'teammembers', 'teamname'],
	github: ['githubrepo', 'githuburl', 'githublink', 'github', 'gitlink', 'gitrepo',
		'gitrepository', 'gitrepolink', 'repository', 'repolink', 'repositoryurl', 'repo', 'codelink'],
	demo: ['videodemopresentation', 'demopresentation', 'demovideo', 'demo', 'presentation', 'video'],
	deployed: ['deployedprojecturl', 'deployedurl', 'liveappurl', 'liveapp', 'livelink', 'liveurl',
		'hostedurl', 'deployment'],
};

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function normalizeGithub(raw: string): string | null {
	const m = String(raw || '').match(GH_RE);
	if (!m) return null;
	const owner = m[1];
	const repo = m[2].replace(/\.git$/i, '').replace(/[?#].*$/, '').replace(/\.+$/, '').replace(/\/+$/, '');
	if (!owner || !repo) return null;
	return `https://github.com/${owner}/${repo}`;
}

export function urlsFromText(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of String(text || '').split(/\s+/)) {
		const url = normalizeGithub(part);
		if (url && !seen.has(url.toLowerCase())) {
			seen.add(url.toLowerCase());
			out.push(url);
		}
	}
	return out;
}

function parseCsvLine(line: string, delim: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQ = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (inQ) {
			if (c === '"') {
				if (line[i + 1] === '"') { cur += '"'; i++; }
				else inQ = false;
			} else cur += c;
		} else if (c === '"') inQ = true;
		else if (c === delim) { out.push(cur); cur = ''; }
		else cur += c;
	}
	out.push(cur);
	return out;
}

function detectDelim(header: string): string {
	const counts = [',', '\t', ';'].map((d) => ({ d, n: header.split(d).length }));
	counts.sort((a, b) => b.n - a.n);
	return counts[0].n > 1 ? counts[0].d : ',';
}

function resolveHeaders(headers: string[]): Record<string, number> {
	const idx: Record<string, number> = {};
	const used = new Set<number>();
	const claim = (canon: string, pred: (nh: string) => boolean) => {
		for (let j = 0; j < headers.length; j++) {
			if (used.has(j)) continue;
			if (pred(norm(headers[j]))) {
				idx[canon] = j;
				used.add(j);
				return;
			}
		}
	};
	for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) {
		claim(canon, (nh) => aliases.includes(nh));
	}
	for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) {
		if (canon in idx) continue;
		const longs = aliases.filter((a) => a.length >= 5);
		claim(canon, (nh) => longs.some((a) => nh.includes(a)));
	}
	return idx;
}

function parseTable(rows: string[][]): Submission[] {
	if (!rows.length) return [];
	const headers = rows[0].map((h) => String(h || '').trim());
	const map = resolveHeaders(headers);
	const data = rows.slice(1);
	if (!('github' in map)) {
		const hits = headers.map((_, j) => data.filter((r) => GH_RE.test(String(r[j] || ''))).length);
		const j = hits.indexOf(Math.max(0, ...hits));
		if (j >= 0 && hits[j] > 0) map.github = j;
	}
	const cell = (r: string[], key: string) => {
		const j = map[key];
		return j == null ? '' : String(r[j] || '').trim();
	};
	const out: Submission[] = [];
	const seen = new Set<string>();
	for (const r of data) {
		const github = normalizeGithub(cell(r, 'github')) || urlsFromText(r.join(' '))[0];
		if (!github || seen.has(github.toLowerCase())) continue;
		seen.add(github.toLowerCase());
		out.push({
			project: cell(r, 'project'),
			github,
			names: cell(r, 'names'),
			demo: cell(r, 'demo'),
			deployed: cell(r, 'deployed'),
		});
	}
	return out;
}

export function parseCsv(text: string): Submission[] {
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return [];
	const delim = detectDelim(lines[0]);
	return parseTable(lines.map((l) => parseCsvLine(l, delim)));
}

async function parseExcel(file: File): Promise<Submission[]> {
	const XLSX = await import('xlsx');
	const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
	const sheet = wb.Sheets[wb.SheetNames[0]];
	if (!sheet) return [];
	const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as string[][];
	return parseTable(rows.map((r) => r.map((c) => String(c ?? ''))));
}

export async function submissionsFromFile(file: File): Promise<Submission[]> {
	const name = file.name.toLowerCase();
	let rows: Submission[] = [];
	if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
		rows = await parseExcel(file);
	} else {
		rows = parseCsv(await file.text());
	}
	if (!rows.length) {
		const text = name.endsWith('.xlsx') || name.endsWith('.xls') ? '' : await file.text();
		const urls = urlsFromText(text);
		if (urls.length) return urls.map((github) => ({ project: '', github }));
		throw new Error('No GitHub repository URLs found in that file.');
	}
	return rows;
}

const EXCEL_HEADERS = [
	'Project Name', 'Team Details (Names / Emails)', 'Project Description',
	'How the target was used', 'Usage Tag',
	'Target = Backbone?', 'GitHub Link', 'Additional Notes',
	'Why This Classification (Justification)',
	'Demo / Presentation / Video', 'Deployed URL',
	'Score', 'Scoring path / evidence', 'Ground truth',
];

export async function exportResultsExcel(results: Array<Record<string, unknown>>, filename: string) {
	const XLSX = await import('xlsx');
	const aoa: (string | number)[][] = [EXCEL_HEADERS];
	for (const r of results) {
		const pc = r.pipelines_called;
		const pt = r.pipelines_total;
		const pipeline = usesPipelineRubric({ scoring: r.scoring, target_name: String(r.target_name || '') });
		const pathLabel = pipeline
			? (pt != null ? `pipeline rubric · ${pc ?? 0} / ${pt} called` : 'pipeline rubric')
			: 'SDK & platform rubric';
		const evidence = Array.isArray(r.evidence) ? r.evidence.map(String).join('\n') : '';
		aoa.push([
			String(r.project || ''),
			String(r.names || ''),
			String(r.description || ''),
			String(r.rocketride_usage || ''),
			String(r.tag || ''),
			String(r.backbone || ''),
			String(r.github || ''),
			String(r.notes || ''),
			String(r.justification || ''),
			String(r.demo || ''),
			String(r.deployed || ''),
			typeof r.score === 'number' ? r.score : '',
			pathLabel,
			evidence,
		]);
	}
	const ws = XLSX.utils.aoa_to_sheet(aoa);
	ws['!cols'] = EXCEL_HEADERS.map((_, i) => ({ wch: i === 13 ? 60 : i === 2 || i === 3 || i === 8 ? 40 : 22 }));
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, 'Results');
	const name = filename.replace(/\.csv$/i, '.xlsx').replace(/\.xlsx$/i, '') + '.xlsx';
	XLSX.writeFile(wb, name);
}

export function exportResultsCsv(results: Array<Record<string, unknown>>, filename: string) {
	void exportResultsExcel(results, filename);
}
