<script lang="ts">
	import Board from '$lib/components/Board.svelte';
	import type { Square } from '$lib/chess/types';
	import { analyzeGame, REVIEW_DEPTH } from '$lib/client/reviewAnalysis';
	import { safeEvaluate } from '$lib/client/engine';
	import { applyMove, isCheckmate, isStalemate } from '$lib/chess/rules';
	import { uciSquares, type GameAnalysis } from '$lib/review/analysis';
	import type { ReviewGame } from '$lib/review/types';
	import type { EngineEval, EngineLine } from '$lib/engine/engine';
	import { buildTurningPointFacts } from '$lib/spike/coach/facts';
	import type {
		DiscussResponse,
		DiscussTurn,
		Learning,
		TurningPointFacts
	} from '$lib/spike/coach/types';
	import { C } from '$lib/review/charts/palette';

	// --- top-level flow state -------------------------------------------------
	type Stage = 'pick' | 'analyzing' | 'discuss' | 'summary';
	let stage = $state<Stage>('pick');
	let username = $state('Timbolt123');
	let games = $state<ReviewGame[]>([]);
	let loadingGames = $state(false);
	let topError = $state<string | null>(null);

	let game = $state<ReviewGame | null>(null);
	let playerColor = $state<'w' | 'b'>('w');
	let progress = $state<{ label: string; done: number; total: number }>({
		label: '',
		done: 0,
		total: 0
	});

	// --- prepared turning points ---------------------------------------------
	type Frame = { fen: string; lastMove: { from: Square; to: Square } | null };
	type PreparedTP = {
		facts: TurningPointFacts;
		staticFen: string;
		staticLast: { from: Square; to: Square };
		bestFrames: Frame[];
		punishFrames: Frame[];
	};
	let tps = $state<PreparedTP[]>([]);
	let tpIndex = $state(0);
	const currentTP = $derived(tps[tpIndex] ?? null);

	// --- conversation state (per turning point) -------------------------------
	let messages = $state<DiscussTurn[]>([]);
	let choices = $state<string[]>([]);
	let thinking = $state(false);
	let done = $state(false);
	let freeText = $state('');
	let convError = $state<string | null>(null);

	// --- collected learnings for the summary ----------------------------------
	type Collected = { moveNumber: number; kind: 'mistake' | 'opportunity'; learnings: Learning[] };
	let collected = $state<Collected[]>([]);

	// --- board display state --------------------------------------------------
	let boardFen = $state('8/8/8/8/8/8/8/8 w - - 0 1');
	let boardLast = $state<{ from: Square; to: Square } | null>(null);
	let boardArrow = $state<{ from: Square; to: Square } | null>(null);
	let playToken = 0; // cancels in-flight playback when the TP changes

	// ==========================================================================
	// 1. find + pick game
	// ==========================================================================
	async function findGames() {
		loadingGames = true;
		topError = null;
		games = [];
		try {
			const res = await fetch(`/spike/coach/game?user=${encodeURIComponent(username.trim())}`);
			if (!res.ok) {
				topError = (await res.text()).slice(0, 200) || `error ${res.status}`;
				return;
			}
			games = (await res.json()).games as ReviewGame[];
			if (games.length === 0) topError = 'No standard games found for that user.';
		} catch (e) {
			topError = e instanceof Error ? e.message : String(e);
		} finally {
			loadingGames = false;
		}
	}

	function sideFor(g: ReviewGame): 'w' | 'b' | null {
		const u = username.trim().toLowerCase();
		if (g.white.username.toLowerCase() === u) return 'w';
		if (g.black.username.toLowerCase() === u) return 'b';
		return null;
	}

	// ==========================================================================
	// 2. analyze + prepare turning points
	// ==========================================================================
	function toLines(ev: EngineEval): EngineLine[] {
		if (ev.lines && ev.lines.length) return ev.lines;
		return [
			{ cp: ev.cp, pv: ev.pv ?? (ev.bestMoveUci ? [ev.bestMoveUci] : []), moveUci: ev.bestMoveUci }
		];
	}

	type Selector = {
		ply: number;
		kind: 'mistake' | 'opportunity';
		magnitude: number;
		setup: { opponentBlunderSan: string; opponentDropPct: number } | null;
	};
	function selectTurningPoints(a: GameAnalysis, g: ReviewGame, side: 'w' | 'b'): Selector[] {
		const opp = side === 'w' ? 'b' : 'w';
		const cands: Selector[] = [];
		for (const m of a.moves) {
			if (m.color === side && m.delta >= 8) {
				cands.push({ ply: m.ply, kind: 'mistake', magnitude: m.delta, setup: null });
			}
			if (m.color === opp && m.delta >= 12) {
				const reply = a.moves.find((x) => x.ply === m.ply + 1);
				if (reply) {
					cands.push({
						ply: reply.ply,
						kind: 'opportunity',
						magnitude: m.delta,
						setup: { opponentBlunderSan: g.moves[m.ply - 1].san, opponentDropPct: m.delta }
					});
				}
			}
		}
		const best: Record<number, Selector> = {};
		for (const c of cands) {
			const cur = best[c.ply];
			if (!cur || cur.magnitude < c.magnitude) best[c.ply] = c;
		}
		let arr = Object.values(best)
			.sort((x, y) => y.magnitude - x.magnitude)
			.slice(0, 3);
		if (arr.length === 0) {
			const mine = a.moves.filter((x) => x.color === side).sort((x, y) => y.delta - x.delta);
			if (mine[0])
				arr = [{ ply: mine[0].ply, kind: 'mistake', magnitude: mine[0].delta, setup: null }];
		}
		return arr.sort((x, y) => x.ply - y.ply);
	}

	function buildFrames(startFen: string, uci: string[], max = 8): Frame[] {
		const frames: Frame[] = [{ fen: startFen, lastMove: null }];
		let fen = startFen;
		for (const u of uci.slice(0, max)) {
			try {
				const { fen: next } = applyMove(fen, u);
				frames.push({ fen: next, lastMove: uciSquares(u) });
				fen = next;
			} catch {
				break;
			}
		}
		return frames;
	}

	async function startReview(g: ReviewGame) {
		const side = sideFor(g);
		if (!side) {
			topError = `${username} isn't a player in that game.`;
			return;
		}
		game = g;
		playerColor = side;
		stage = 'analyzing';
		tps = [];

		progress = { label: 'Running the engine over every move', done: 0, total: g.moves.length + 1 };
		const res = await analyzeGame(g, (d, t) => (progress = { ...progress, done: d, total: t }));
		if (!res.ok) {
			topError = res.error.message;
			stage = 'pick';
			return;
		}

		const selectors = selectTurningPoints(res.value, g, side);
		const prepared: PreparedTP[] = [];
		progress = { label: 'Studying the moments that mattered', done: 0, total: selectors.length };
		for (const sel of selectors) {
			const mv = g.moves[sel.ply - 1];
			const fenBefore = mv.fenBefore;
			const fenAfter = mv.fenAfter;
			const playedUci = mv.uci;

			const beforeEval = await safeEvaluate(fenBefore, { depth: REVIEW_DEPTH, multiPv: 3 });
			if (!beforeEval.ok) {
				topError = beforeEval.error.message;
				stage = 'pick';
				return;
			}
			const ended = isCheckmate(fenAfter) || isStalemate(fenAfter);
			let replyLine: EngineLine | null = null;
			if (!ended) {
				const afterEval = await safeEvaluate(fenAfter, { depth: REVIEW_DEPTH, multiPv: 1 });
				if (afterEval.ok) replyLine = toLines(afterEval.value)[0] ?? null;
			}

			const facts = buildTurningPointFacts(g, side, {
				ply: sel.ply,
				fenBefore,
				playedUci,
				kind: sel.kind,
				setup: sel.setup,
				bestLines: toLines(beforeEval.value),
				replyLine
			});

			const punishFrames: Frame[] = [{ fen: fenBefore, lastMove: null }];
			const { fen: afFen } = applyMove(fenBefore, playedUci);
			punishFrames.push({ fen: afFen, lastMove: uciSquares(playedUci) });
			let pf = afFen;
			for (const u of (replyLine?.pv ?? []).slice(0, 6)) {
				try {
					const { fen: nx } = applyMove(pf, u);
					punishFrames.push({ fen: nx, lastMove: uciSquares(u) });
					pf = nx;
				} catch {
					break;
				}
			}

			prepared.push({
				facts,
				staticFen: fenAfter,
				staticLast: uciSquares(playedUci),
				bestFrames: buildFrames(fenBefore, toLines(beforeEval.value)[0]?.pv ?? [], 8),
				punishFrames
			});
			progress = { ...progress, done: prepared.length };
		}

		if (prepared.length === 0) {
			topError = 'No clear turning points found in this game.';
			stage = 'pick';
			return;
		}

		tps = prepared;
		collected = [];
		stage = 'discuss';
		enterTP(0);
	}

	// ==========================================================================
	// 3. guided discussion
	// ==========================================================================
	function resetBoard(tp: PreparedTP) {
		playToken++;
		boardFen = tp.staticFen;
		boardLast = tp.staticLast;
		boardArrow = null;
	}

	async function playFrames(frames: Frame[]) {
		const token = ++playToken;
		for (let i = 0; i < frames.length; i++) {
			if (token !== playToken) return;
			boardFen = frames[i].fen;
			boardLast = frames[i].lastMove;
			boardArrow = frames[i].lastMove;
			await new Promise((r) => setTimeout(r, i === 0 ? 250 : 800));
		}
	}

	function applyShow(show: DiscussResponse['show']) {
		const tp = currentTP;
		if (!tp) return;
		if (show === 'best') playFrames(tp.bestFrames);
		else if (show === 'punish') playFrames(tp.punishFrames);
	}

	async function enterTP(i: number) {
		tpIndex = i;
		messages = [];
		choices = [];
		done = false;
		freeText = '';
		convError = null;
		const tp = tps[i];
		resetBoard(tp);
		await runTurn({ isFirstTurn: true });
	}

	async function runTurn(opts: { isFirstTurn: boolean; playerChoice?: string }) {
		const tp = currentTP;
		if (!tp) return;
		thinking = true;
		convError = null;
		try {
			const res = await fetch('/spike/coach/discuss', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					facts: tp.facts,
					history: messages,
					playerChoice: opts.playerChoice,
					isFirstTurn: opts.isFirstTurn
				})
			});
			if (!res.ok) {
				convError = (await res.text()).slice(0, 200) || `error ${res.status}`;
				return;
			}
			const data = (await res.json()) as DiscussResponse;
			messages = [...messages, { role: 'coach', content: data.message }];
			choices = data.choices;
			done = data.done;
			if (data.show !== 'none') applyShow(data.show);
			if (data.done && data.learnings.length) {
				collected = [
					...collected.filter((c) => c.moveNumber !== tp.facts.moveNumber),
					{ moveNumber: tp.facts.moveNumber, kind: tp.facts.kind, learnings: data.learnings }
				];
			}
		} catch (e) {
			convError = e instanceof Error ? e.message : String(e);
		} finally {
			thinking = false;
		}
	}

	async function pick(choice: string) {
		if (thinking) return;
		messages = [...messages, { role: 'player', content: choice }];
		await runTurn({ isFirstTurn: false, playerChoice: choice });
	}

	function submitFree() {
		const t = freeText.trim();
		if (!t) return;
		freeText = '';
		pick(t);
	}

	function nextMoment() {
		if (tpIndex + 1 < tps.length) enterTP(tpIndex + 1);
		else stage = 'summary';
	}

	function resetToPick() {
		playToken++;
		stage = 'pick';
		game = null;
		games = [];
		tps = [];
	}

	// --- small display helpers ------------------------------------------------
	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	function resultFor(g: ReviewGame): string {
		const side = sideFor(g);
		if (g.result === '1/2-1/2') return 'draw';
		const won = (g.result === '1-0') === (side === 'w');
		return won ? 'win' : 'loss';
	}
	function opponent(g: ReviewGame): string {
		return sideFor(g) === 'w' ? g.black.username : g.white.username;
	}
	const LEVEL_LABEL: Record<Learning['level'], string> = {
		tactical: 'Tactic',
		principle: 'Principle',
		process: 'Process'
	};
	const LEVEL_COLOR: Record<Learning['level'], string> = {
		tactical: 'var(--class-blunder)',
		principle: 'var(--brand)',
		process: 'var(--good)'
	};
	const swingPct = $derived(
		currentTP ? Math.round(currentTP.facts.winAfter - currentTP.facts.winBefore) : 0
	);

	// `winBefore` presumes the best move was found, so a found best move reads as
	// "76% → 76%" — as if nothing happened. Show the achievement (found the best
	// move, held the standing) instead, and tag the POSITION as sharp when the
	// spread supports it. Never frame it against a move the player didn't make.
	const PRECISION_GAP = 12;
	const winLine = $derived.by(() => {
		const f = currentTP?.facts;
		if (!f) return '';
		const played = Math.round(f.winAfter);
		if (f.isBest) {
			const sharp =
				f.winSecondBest !== null && f.winBefore - f.winSecondBest >= PRECISION_GAP;
			return sharp ? `best move · held ${played}% (sharp spot)` : `best move · held ${played}%`;
		}
		return `${Math.round(f.winBefore)}% → ${played}%`;
	});
</script>

<svelte:head><title>Coach spike</title></svelte:head>

<div class="min-h-screen" style="background: var(--bg);">
	<main class="mx-auto max-w-5xl px-4 py-6">
		<header class="mb-5 flex items-baseline justify-between">
			<h1 class="text-xl font-bold tracking-tight" style="color: {C.ink};">
				Guided review <span class="ml-1 text-xs font-normal" style="color: {C.muted};">spike</span>
			</h1>
			{#if game}
				<button class="link" onclick={resetToPick}>← New game</button>
			{/if}
		</header>

		<!-- ============================ PICK ============================ -->
		{#if stage === 'pick'}
			<div class="card max-w-xl">
				<label class="eyebrow" for="user">chess.com username</label>
				<div class="mt-1.5 flex gap-2">
					<input
						id="user"
						class="input flex-1"
						bind:value={username}
						onkeydown={(e) => e.key === 'Enter' && findGames()}
						placeholder="username"
					/>
					<button class="btn" onclick={findGames} disabled={loadingGames}>
						{loadingGames ? 'Finding…' : 'Find games'}
					</button>
				</div>
				{#if topError}<p class="mt-2 text-sm" style="color: var(--bad);">{topError}</p>{/if}
			</div>

			{#if games.length}
				<ul class="mt-4 grid gap-2">
					{#each games as g (g.gameId)}
						{@const r = resultFor(g)}
						<li>
							<button class="game-row" onclick={() => startReview(g)}>
								<span
									class="result-dot"
									style="background: {r === 'win'
										? 'var(--good)'
										: r === 'loss'
											? 'var(--bad)'
											: 'var(--draw)'};"
								></span>
								<span class="font-semibold" style="color: {C.ink};">vs {opponent(g)}</span>
								<span class="text-sm capitalize" style="color: {C.muted};">{r}</span>
								<span class="ml-auto text-xs" style="color: {C.muted};">
									{g.opening ?? 'Unknown'} · {dateFmt.format(new Date(g.playedAt))}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<!-- ========================== ANALYZING ========================= -->
		{#if stage === 'analyzing'}
			<div class="card max-w-xl">
				<p class="text-sm font-semibold" style="color: {C.ink};">{progress.label}…</p>
				<div class="mt-3 h-1.5 w-full overflow-hidden rounded-full" style="background: {C.track};">
					<div
						class="h-full rounded-full transition-[width] duration-150"
						style="width: {progress.total
							? (progress.done / progress.total) * 100
							: 0}%; background: {C.good};"
					></div>
				</div>
				<p class="mt-1.5 text-xs" style="color: {C.muted};">
					{progress.done} / {progress.total}
				</p>
				<p class="mt-3 text-xs" style="color: {C.muted};">
					Loading Stockfish in your browser — the first pass takes a moment.
				</p>
			</div>
		{/if}

		<!-- =========================== DISCUSS ========================== -->
		{#if stage === 'discuss' && currentTP}
			<div class="mb-3 flex items-center gap-2 text-xs" style="color: {C.muted};">
				{#each tps as tp, i (tp.facts.ply)}
					<span
						class="h-1.5 flex-1 rounded-full"
						style="background: {i < tpIndex
							? 'var(--good)'
							: i === tpIndex
								? 'var(--brand)'
								: 'var(--surface-3)'};"
					></span>
				{/each}
				<span class="tabular-nums">moment {tpIndex + 1} / {tps.length}</span>
			</div>

			<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<!-- Board -->
				<div>
					<div class="mx-auto w-full" style="max-width: min(58svh, 100%);">
						<Board
							fen={boardFen}
							selected={null}
							legalDestinations={[]}
							lastMove={boardLast}
							opponentArrow={boardArrow}
							onSquareClick={() => {}}
							orientation={playerColor === 'w' ? 'white' : 'black'}
						/>
					</div>
					<div class="mt-3 flex flex-wrap justify-center gap-2">
						<button class="chip-btn" onclick={() => resetBoard(currentTP)}>↺ Position</button>
						{#if currentTP.bestFrames.length > 1}
							<button class="chip-btn" onclick={() => playFrames(currentTP.bestFrames)}
								>▶ Better line</button
							>
						{/if}
						{#if currentTP.punishFrames.length > 1}
							<button class="chip-btn" onclick={() => playFrames(currentTP.punishFrames)}
								>▶ What it allowed</button
							>
						{/if}
					</div>
				</div>

				<!-- Conversation -->
				<div class="flex flex-col gap-3">
					<div class="moment-head">
						<span
							class="badge"
							style="background: color-mix(in srgb, {swingPct < 0
								? 'var(--bad)'
								: 'var(--good)'} 15%, transparent); color: {swingPct < 0
								? 'var(--bad)'
								: 'var(--good)'};"
						>
							{currentTP.facts.kind === 'opportunity' ? 'Opportunity' : 'Your move'}
						</span>
						<span class="text-sm" style="color: {C.body};">
							Move {currentTP.facts.moveNumber}:
							<strong style="color: {C.ink};">{currentTP.facts.playedSan}</strong>
							· {winLine}
						</span>
					</div>

					<div class="convo">
						{#each messages as m, i (i)}
							{#if m.role === 'coach'}
								<div class="bubble coach"><p class="whitespace-pre-line">{m.content}</p></div>
							{:else}
								<div class="bubble player">{m.content}</div>
							{/if}
						{/each}
						{#if thinking}
							<div class="bubble coach"><span class="dots">Thinking…</span></div>
						{/if}
						{#if convError}
							<p class="text-xs" style="color: var(--bad);">{convError}</p>
						{/if}
					</div>

					{#if !done && !thinking && choices.length}
						<div class="grid gap-2">
							{#each choices as c (c)}
								<button class="choice" onclick={() => pick(c)}>{c}</button>
							{/each}
							<div class="flex gap-2">
								<input
									class="input flex-1"
									bind:value={freeText}
									placeholder="Something else…"
									onkeydown={(e) => e.key === 'Enter' && submitFree()}
								/>
								<button class="btn" onclick={submitFree}>Send</button>
							</div>
						</div>
					{/if}

					{#if done}
						<button class="btn w-full" onclick={nextMoment}>
							{tpIndex + 1 < tps.length ? 'Next moment →' : 'See takeaways →'}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<!-- =========================== SUMMARY ========================== -->
		{#if stage === 'summary'}
			<div class="card max-w-2xl">
				<h2 class="text-lg font-bold" style="color: {C.ink};">What to carry to the next game</h2>
				{#if collected.length === 0}
					<p class="mt-2 text-sm" style="color: {C.muted};">No takeaways were captured.</p>
				{/if}
				{#each collected as c (c.moveNumber)}
					<div class="mt-4">
						<div class="eyebrow">
							Move {c.moveNumber} · {c.kind === 'opportunity' ? 'opportunity' : 'your move'}
						</div>
						<ul class="mt-1.5 grid gap-1.5">
							{#each c.learnings as l (l.point)}
								<li class="flex gap-2">
									<span
										class="badge"
										style="background: color-mix(in srgb, {LEVEL_COLOR[
											l.level
										]} 16%, transparent); color: {LEVEL_COLOR[l.level]};"
									>
										{LEVEL_LABEL[l.level]}
									</span>
									<span class="text-sm" style="color: {C.body};">{l.point}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
				<button class="btn mt-5" onclick={resetToPick}>Review another game</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 1rem;
		box-shadow: var(--shadow-1);
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.input {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
		color: var(--text);
	}
	.btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.5rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		transition: background var(--dur);
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.link {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	.link:hover {
		color: var(--text);
	}

	.game-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		border-radius: 0.7rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.6rem 0.85rem;
		transition: background var(--dur-fast);
	}
	.game-row:hover {
		background: var(--surface-2);
	}
	.result-dot {
		height: 0.7rem;
		width: 0.7rem;
		border-radius: 9999px;
		flex-shrink: 0;
	}

	.moment-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
		border-radius: 0.85rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.7rem 0.9rem;
	}
	.badge {
		display: inline-block;
		border-radius: 9999px;
		padding: 0.1rem 0.55rem;
		font-size: 0.68rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.convo {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		max-height: 48svh;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.bubble {
		border-radius: 0.85rem;
		padding: 0.6rem 0.8rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.bubble.coach {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
	}
	.bubble.player {
		background: var(--brand);
		color: var(--bg);
		align-self: flex-end;
		font-weight: 600;
		max-width: 85%;
	}
	.dots {
		color: var(--text-muted);
	}

	.choice {
		text-align: left;
		border-radius: 0.7rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.55rem 0.8rem;
		font-size: 0.88rem;
		color: var(--text);
		transition: background var(--dur-fast);
	}
	.choice:hover {
		background: var(--surface-2);
	}

	.chip-btn {
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-2);
		transition: background var(--dur-fast);
	}
	.chip-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}
</style>
