/**
 * Run the evaluator's stage-1 tests from wherever the app lives: eval/ beside the app
 * (inside the verifier repo) or under Projects/hackathon-usage-verifier (workspace layout).
 * Mirrors the lookup in build_restricted_bundle.py so the two never disagree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
	path.resolve(appRoot, '..', 'eval'),
	path.resolve(appRoot, '..', '..', 'Projects', 'hackathon-usage-verifier', 'eval'),
];
const evalRoot = candidates.find((dir) => fs.existsSync(path.join(dir, 'test_stage1.py')));
if (!evalRoot) {
	console.error(`stage-1 tests not found; looked in:\n  ${candidates.join('\n  ')}`);
	process.exit(1);
}
const bins = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
for (const bin of bins) {
	const args = bin === 'py' ? ['-3', '-I', path.join(evalRoot, 'test_stage1.py')] : ['-I', path.join(evalRoot, 'test_stage1.py')];
	const proc = spawnSync(bin, args, { stdio: 'inherit', cwd: path.dirname(evalRoot) });
	if (proc.error) continue;
	process.exit(proc.status ?? 1);
}
console.error('No Python interpreter found for the stage-1 tests');
process.exit(1);
