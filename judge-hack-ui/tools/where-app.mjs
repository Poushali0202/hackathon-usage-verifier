/**
 * Reverse index: which audience rung serves which Judge Hack version.
 * The browser resolves @me before @team — print this after every publish.
 *
 * Reads what is live, so it uses the DEPLOY pair and never the dev pair.
 * Read-only, so it does not require --target; the host is printed instead.
 *
 *   node tools/where-app.mjs [--app-id <id>]
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveAppId } from './app-id.mjs';
import { deployPair, findWorkspaceRoot, hostOf, loadWorkspaceEnv, targetOf } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = findWorkspaceRoot(appRoot);
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

const APP_ID = resolveAppId();

export async function printWhereApp(client, appId = APP_ID) {
	const pins = await client.whereApp(appId);
	if (!pins?.length) {
		console.log(`whereApp ${appId}: (no rungs)`);
		return pins || [];
	}
	console.log(`whereApp ${appId}:`);
	for (const row of pins) {
		const when = row.deployedAt ? new Date(row.deployedAt).toISOString() : '';
		console.log(`  ${row.rung}\t${row.handle}\tv${row.version}\t${row.state}${when ? `\t${when}` : ''}`);
	}
	return pins;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	loadWorkspaceEnv(path.join(workspaceRoot, '.env'));
	const { uri, auth } = deployPair();
	console.log(`[deploy] host=${hostOf(uri)} target=${targetOf(uri) || 'unrecognised'}`);
	const client = new RocketRideClient({ uri, auth });
	await client.connect();
	try {
		await printWhereApp(client);
	} finally {
		await client.disconnect();
	}
}
