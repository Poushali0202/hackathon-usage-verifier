/**
 * Reverse index: which audience rung serves which Judge Hack version.
 * The browser resolves @me before @team — print this after every publish.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

const APP_ID = 'hackjudge.judge-hack';

function loadEnv(file) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

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
	loadEnv(path.join(workspaceRoot, '.env'));
	const uri = process.env.ROCKETRIDE_DEPLOY_URI || process.env.ROCKETRIDE_URI;
	const auth = process.env.ROCKETRIDE_DEPLOY_APIKEY || process.env.ROCKETRIDE_APIKEY;
	if (!uri || !auth) {
		console.error('Missing ROCKETRIDE_URI / ROCKETRIDE_APIKEY (or the DEPLOY pair).');
		process.exit(1);
	}
	const client = new RocketRideClient({ uri, auth });
	await client.connect();
	try {
		await printWhereApp(client);
	} finally {
		await client.disconnect();
	}
}
