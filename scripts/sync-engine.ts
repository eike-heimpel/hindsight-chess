/**
 * Copy the Stockfish browser engine into static/ so SvelteKit serves it as
 * a public asset. Run automatically on `npm install` (postinstall) and via
 * `npm run sync:engine`.
 *
 * We use the lite-single flavor: ~7 MB total, runs in any browser without
 * cross-origin isolation headers.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules/stockfish/bin');
const DST = join(ROOT, 'static/stockfish');

const FILES = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

if (!existsSync(SRC)) {
	console.error(`sync-engine: ${SRC} not found — did npm install run?`);
	process.exit(1);
}
mkdirSync(DST, { recursive: true });

for (const f of FILES) {
	const from = join(SRC, f);
	const to = join(DST, f);
	if (!existsSync(from)) {
		console.error(`sync-engine: missing ${from}`);
		process.exit(1);
	}
	copyFileSync(from, to);
	console.log(`sync-engine: ${f} → ${to}`);
}
