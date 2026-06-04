/**
 * Mobile screenshot harness. Logs in via the dev-only /dev-login route, then
 * captures each route at phone viewports into shots/. Read the PNGs to review
 * mobile layout. Requires a running dev server (npm run dev).
 *
 *   node scripts/shots.mjs                 # all routes, iPhone 13 + narrow 360px
 *   BASE=http://localhost:5173 node scripts/shots.mjs
 *
 * Files are named <route>@<width>.png. The game-replay route is discovered by
 * scraping the first game link off /review, so it captures a real game.
 */
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE ?? 'http://localhost:5173';
// Two widths: iPhone 13 (390, the common case) and a narrow 360 (worst-case
// overflow — most Android + small iPhones land at or below this).
const VIEWPORTS = [
	['390', { width: 390, height: 844 }],
	['360', { width: 360, height: 800 }]
];

await mkdir('shots', { recursive: true });
const browser = await chromium.launch();

async function shoot(label, width, height) {
	const context = await browser.newContext({
		...devices['iPhone 13'],
		viewport: { width, height },
		isMobile: true
	});
	const page = await context.newPage();

	// Establish the session cookie; lands on home.
	await page.goto(`${BASE}/dev-login`, { waitUntil: 'networkidle' });

	// Discover a real game-replay URL from the games list.
	await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
	const gameHref = await page
		.locator('a[href*="/review/chesscom/"], a[href*="/review/lichess/"]')
		.first()
		.getAttribute('href');

	const routes = [
		['home', '/'],
		['review', '/review'],
		['blunders', '/review/blunders'],
		['stats', '/review/stats'],
		['stats-winnable', '/review/stats/winnable'],
		['account', '/account']
	];
	if (gameHref) routes.push(['game', gameHref]);

	for (const [name, path] of routes) {
		await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(800);
		await page.screenshot({ path: `shots/${name}@${label}.png`, fullPage: true });
		console.log('shot:', `${name}@${label}`, '->', page.url());
	}
	await context.close();
}

for (const [label, { width, height }] of VIEWPORTS) {
	await shoot(label, width, height);
}

await browser.close();
