<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Back link carries a runtime ?user query and the game URL is an external
	 * chess.com link; resolve() doesn't apply cleanly to either. */
	import { untrack } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import type { Square, Side } from '$lib/chess/types';
	import { createReviewSession } from '$lib/client/reviewSession.svelte';
	import { createExploreLine } from '$lib/client/exploreLine.svelte';
	import { createCoachThread } from '$lib/client/coachThread.svelte';
	import { selectTurningPoints } from '$lib/review/coach/moments';
	import { applyMove } from '$lib/chess/rules';
	import type { GameAlternative, MoveRef, MoveState } from '$lib/server/userMoveState';
	import { type MoveAnalysis } from '$lib/review/analysis';
	import { C } from '$lib/review/charts/palette';
	import {
		indexByPly,
		whiteWinAt,
		bestArrowAt,
		dotColorAt,
		currentMoveAt
	} from '$lib/review/replayView';
	import BackLink from '$lib/components/BackLink.svelte';
	import Disclosure from '$lib/components/Disclosure.svelte';
	import PromotionPicker from '$lib/components/PromotionPicker.svelte';
	import ReplayControls from '$lib/components/ReplayControls.svelte';
	import EvalBar from '$lib/review/EvalBar.svelte';
	import MoveVerdict from '$lib/review/MoveVerdict.svelte';
	import MoveList from '$lib/review/MoveList.svelte';
	import ExplorePanel from '$lib/review/ExplorePanel.svelte';
	import CoachPanel from '$lib/review/coach/CoachPanel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	const game = $derived(data.game);
	const moves = $derived(game.moves);
	const plyCount = $derived(moves.length);

	// These seed once from `data` (untrack = "capture the initial value on
	// purpose"): the page always mounts fresh per game — every in-app link to it
	// comes from another route (home, blunders, winnable), never game→game on this
	// route — so there's no stale state to reset. State changes live in the event
	// handlers below, never in an $effect that copies `data` back into local state.
	// ply 0 = start position; ply k = the position after move k.
	let ply = $state(untrack(() => data.initialPly));
	let orientation = $state<'white' | 'black'>(untrack(() => data.orientation));

	// Analyze + explain orchestration (analysis, explanations, in-flight/error
	// flags) lives in a rune module — see reviewSession.svelte.ts. Seeded once from
	// the cached server load. `onAnalyzed` rebuilds the coach thread because the
	// thread captures `analysis` by value (R1) — an event, never a state→state effect.
	const session = createReviewSession({
		game: untrack(() => data.game),
		analysis: untrack(() => data.analysis),
		explanations: untrack(() => data.explanations),
		onAnalyzed: () => (thread = makeThread())
	});

	// Per-user move-state overlay (mark/note/…), seeded once. Optimistic writes
	// patch this map so the controls reflect without a reload.
	let moveStates = $state<Record<number, MoveState>>(untrack(() => data.moveStates));
	const currentState = $derived<MoveState | undefined>(ply >= 1 ? moveStates[ply] : undefined);

	// Star / note write straight from the event handler (never an $effect), against
	// the move currently in view. Both patch `moveStates` optimistically first.
	function moveRef(p: number): MoveRef {
		return { source: game.source, gameId: game.gameId, ply: p };
	}

	/** Is this ref (real move or explored alternative) starred? */
	function isStarred(ref: MoveRef): boolean {
		return ref.line
			? altMarks[altKey(ref.ply, ref.line)] === 'star'
			: moveStates[ref.ply]?.mark === 'star';
	}

	/** Toggle the star on any ref — a real move (`moveStates`) or an explored
	 *  alternative (`altMarks`). Optimistic, then fire-and-forget the write; a
	 *  toggle-off clears just the mark facet so a coexisting note/thread survives. */
	function toggleStarRef(ref: MoveRef) {
		const starred = isStarred(ref);
		if (ref.line) {
			const k = altKey(ref.ply, ref.line);
			altMarks = { ...altMarks, [k]: starred ? undefined : 'star' };
		} else {
			moveStates = {
				...moveStates,
				[ref.ply]: { ...moveStates[ref.ply], mark: starred ? undefined : 'star' }
			};
		}
		void fetch('/api/review/moves', {
			method: starred ? 'DELETE' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(starred ? { ref, facet: 'mark' } : { ref, facet: 'mark', value: 'star' })
		});
	}

	function writeNote(p: number, text: string) {
		const trimmed = text.trim();
		if (trimmed === (moveStates[p]?.note?.text ?? '')) return;
		moveStates = {
			...moveStates,
			[p]: {
				...moveStates[p],
				note: trimmed ? { text: trimmed, updatedAt: new Date() } : undefined
			}
		};
		// Emptying the note unsets the facet (DELETE) rather than storing "".
		if (trimmed)
			void fetch('/api/review/moves', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ref: moveRef(p), facet: 'note', value: trimmed })
			});
		else
			void fetch('/api/review/moves', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ref: moveRef(p), facet: 'note' })
			});
	}

	let fen = $derived(ply === 0 ? (moves[0]?.fenBefore ?? START_FEN) : moves[ply - 1].fenAfter);
	let lastMove = $derived.by(() => {
		if (ply === 0) return null;
		const uci = moves[ply - 1].uci;
		return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
	});

	// --- the coach thread (the review surface IS the coach) -------------------
	// Voice-first (variant 'B'): the player states their read before the reveal,
	// and the coach's show-line playback routes through the same `explore` branch
	// the board uses. The thread captures `analysis` by value, so `onAnalyzed`
	// (above) rebuilds it when a fresh analysis lands — an event, not an $effect.
	const explore = createExploreLine();
	// The real game ply the live explore branch was entered at — the branch point
	// for any "what if" line the player plays out and then coaches / stars.
	let exploreFromPly = $state(0);

	// Resume a saved conversation on open: hand the thread the persisted facet for
	// the subject's ref. Real moves key by ply (`data.moveStates`); explored
	// alternatives key by `${ply}:${line}` (`data.alternatives`). Both seed once per
	// mount; the default persist transport handles the write-back.
	const savedThreads = untrack(() => data.moveStates ?? {});
	const altKey = (ply: number, line: string[]) => `${ply}:${line.join('-')}`;
	const savedAltThreads = untrack(() => {
		const out: Record<string, NonNullable<MoveState['thread']>> = {};
		for (const a of data.alternatives ?? []) {
			if (a.state.thread) out[altKey(a.ply, a.line)] = a.state.thread;
		}
		return out;
	});
	const loadThread = (ref: MoveRef) => {
		const t = ref.line ? savedAltThreads[altKey(ref.ply, ref.line)] : savedThreads[ref.ply]?.thread;
		return t
			? { messages: t.messages, learnings: t.learnings, choices: t.choices ?? [], status: t.status }
			: undefined;
	};
	const makeThread = () =>
		createCoachThread({ game, analysis: session.analysis, variant: 'B', explore, loadThread });
	let thread = $state(makeThread());
	const active = $derived(thread.currentPly !== null);

	// Explored alternatives the player has saved (starred / talked through), shown
	// as a revisitable list. Mark state is tracked locally (keyed by `${ply}:${line}`)
	// for optimistic star toggles; seeded from the load.
	let alternatives = $state<GameAlternative[]>(untrack(() => data.alternatives ?? []));
	let altMarks = $state<Record<string, MoveState['mark']>>(
		untrack(() => {
			const out: Record<string, MoveState['mark']> = {};
			for (const a of data.alternatives ?? [])
				if (a.state.mark) out[altKey(a.ply, a.line)] = a.state.mark;
			return out;
		})
	);

	// The coached side — derived from the board orientation the loader resolved for
	// `me` (white-on-bottom ⇒ we're White). Turning points are auto-flagged over the
	// cached analysis and surface as markers on the move list + eval bar.
	const side = $derived<Side>(orientation === 'white' ? 'w' : 'b');
	const moments = $derived(
		session.analysis ? selectTurningPoints(session.analysis, game, side) : []
	);
	const momentPlies = $derived(new Set(moments.map((m) => m.ply)));
	const momentBarPips = $derived(
		moments
			.map((m) => session.analysis?.moves[m.ply - 1])
			.filter((x): x is MoveAnalysis => !!x)
			.map((x) => ({ at: x.color === 'w' ? x.winAfter : 100 - x.winAfter }))
	);

	function goTo(n: number) {
		if (explore.active) explore.exit(); // leaving the branch returns to the game
		if (active) thread.finish(); // close any open conversation before navigating
		ply = Math.max(0, Math.min(plyCount, n));
	}
	function onKey(e: KeyboardEvent) {
		if (active) return; // the coach panel owns input while discussing
		if (explore.active) {
			// In the branch, arrows take back / play the engine's move; no game nav.
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				explore.undo();
			}
			return;
		}
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			goTo(ply - 1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			goTo(ply + 1);
		} else if (e.key === 'Home') {
			goTo(0);
		} else if (e.key === 'End') {
			goTo(plyCount);
		}
	}

	// "Talk it through" — hand this move to the coach. Exit any live branch first so
	// the coach's own show-line playback (which uses `explore`) starts clean (R3).
	function talkItThrough() {
		if (explore.active) explore.exit();
		thread.open(ply);
	}

	// Enter the throwaway analysis branch from the current position, remembering the
	// ply we branched at so any line we keep is anchored to it.
	function enterExplore() {
		exploreFromPly = ply;
		explore.enter(fen, moveLabel(ply));
	}

	// "Talk through this move" from inside the explore branch: hand the deepest
	// explored move to the coach as a 'what if' line anchored to the branch ply.
	// Exit the branch first — the coach now owns the board (inline playback), so
	// staying in `explore` would let the player keep mutating the line being coached.
	function talkThroughExplore() {
		const subj = explore.coachSubject;
		if (!subj) return;
		const branchPly = exploreFromPly;
		ensureAlternative(branchPly, subj.line);
		explore.exit();
		thread.openExplore({ ply: branchPly, ...subj });
	}

	// Reopen a saved alternative: replay its UCI line from the branch position to
	// rebuild the discussed move, then coach it (its saved conversation resumes via
	// `loadThread`). Pure chess.js replay — the server re-validates on the next turn.
	function reopenAlternative(alt: { ply: number; line: string[] }) {
		if (explore.active) explore.exit();
		if (active) thread.finish();
		let fenCur = alt.ply === 0 ? (moves[0]?.fenBefore ?? START_FEN) : moves[alt.ply - 1].fenAfter;
		let fenBefore = fenCur;
		let san = '';
		for (const uci of alt.line) {
			fenBefore = fenCur;
			const applied = applyMove(fenCur, uci);
			fenCur = applied.fen;
			san = applied.move.san;
		}
		thread.openExplore({
			ply: alt.ply,
			line: alt.line,
			fenBefore,
			fenAfter: fenCur,
			playedUci: alt.line[alt.line.length - 1],
			san
		});
	}

	// The live explored line's ref (anchored to the branch ply) and its star state,
	// for the explore panel's star control.
	const exploreLineRef = $derived<MoveRef | null>(
		explore.coachSubject
			? {
					source: game.source,
					gameId: game.gameId,
					ply: exploreFromPly,
					line: explore.coachSubject.line
				}
			: null
	);
	const exploreStarred = $derived(exploreLineRef ? isStarred(exploreLineRef) : false);
	function starExplore() {
		if (!exploreLineRef) return;
		ensureAlternative(exploreLineRef.ply, exploreLineRef.line!);
		toggleStarRef(exploreLineRef);
	}

	/** Add an explored line to the in-session list if it isn't there yet, so a line
	 *  the player just kept shows up without a reload (the server already has it). */
	function ensureAlternative(p: number, line: string[]) {
		const k = altKey(p, line);
		if (alternatives.some((a) => altKey(a.ply, a.line) === k)) return;
		alternatives = [...alternatives, { ply: p, line, state: {} }];
	}

	// Label an alternative for the saved-lines list: "12… Bxh7 (+2 more)".
	function altLabel(alt: { ply: number; line: string[] }): string {
		const fromN = Math.ceil(alt.ply / 2);
		const branch = alt.ply === 0 ? 'start' : `${fromN}${alt.ply % 2 === 1 ? '.' : '…'}`;
		return `from ${branch} · ${alt.line.length} move${alt.line.length === 1 ? '' : 's'}`;
	}

	function clockAt(color: 'w' | 'b'): string {
		for (let k = ply - 1; k >= 0; k--) {
			if (moves[k].color === color) return fmtClock(moves[k].clockMs);
		}
		return '—';
	}
	function fmtClock(ms?: number): string {
		if (ms == null) return '—';
		const s = Math.round(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const resultLabel = $derived(
		game.result === '1-0' ? '1–0' : game.result === '0-1' ? '0–1' : '½–½'
	);

	const topPlayer = $derived(orientation === 'white' ? game.black : game.white);
	const bottomPlayer = $derived(orientation === 'white' ? game.white : game.black);
	const topColor = $derived<'w' | 'b'>(orientation === 'white' ? 'b' : 'w');
	const bottomColor = $derived<'w' | 'b'>(orientation === 'white' ? 'w' : 'b');

	function playerLine(p: { username: string; rating?: number }): string {
		return p.rating ? `${p.username} (${p.rating})` : p.username;
	}

	// Per-ply view derivations (shared with the coach board — see replayView.ts).
	// The better move arrow is shown alongside the actual move (highlighted via
	// `lastMove`) so you see both on one screen, matching the verdict below.
	const analysisByPly = $derived(indexByPly(session.analysis));
	const whiteWin = $derived(whiteWinAt(session.analysis, analysisByPly, ply));
	const bestArrow = $derived(bestArrowAt(analysisByPly, ply));
	function dotColor(p: number): string | null {
		return dotColorAt(analysisByPly, p);
	}
	const currentMove = $derived(currentMoveAt(analysisByPly, moves, ply));
	function accuracyFor(color: 'w' | 'b'): number | null {
		if (!session.analysis) return null;
		return color === 'w' ? session.analysis.accuracy.white : session.analysis.accuracy.black;
	}

	function moveLabel(p: number): string {
		if (p === 0) return 'the starting position';
		const n = Math.ceil(p / 2);
		return `${n}${p % 2 === 1 ? '.' : '…'} ${moves[p - 1].san}`;
	}

	// The board, eval bar and best-move arrow read from: the live explore branch
	// while it's active; else the coach thread while it's coaching an explored line
	// (`ownsBoard` — inline playback, the branch is exited); else the game replay.
	// For real-move coaching the thread's show-lines enter `explore`, so that path
	// is covered by the first branch.
	const boardFen = $derived(
		explore.active ? explore.currentFen : thread.ownsBoard ? thread.boardFen : fen
	);
	const boardLastMove = $derived(
		explore.active ? explore.lastMove : thread.ownsBoard ? thread.boardLast : lastMove
	);
	const boardArrow = $derived(
		explore.active ? explore.bestArrow : thread.ownsBoard ? thread.boardArrow : bestArrow
	);
	const boardWhiteWin = $derived(
		explore.active ? explore.whiteWin : thread.ownsBoard ? thread.whiteWin : whiteWin
	);
</script>

<svelte:head><title>{game.white.username} vs {game.black.username}</title></svelte:head>
<svelte:window onkeydown={onKey} />

<div class="min-h-dvh" style="background: var(--bg);">
	<main class="mx-auto max-w-6xl px-4 py-5">
		<header class="mb-4">
			<div class="mb-1">
				<BackLink href="/review{data.me ? `?user=${data.me}` : ''}" label="Games" />
			</div>
			<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h1 class="font-display text-2xl font-semibold tracking-tight" style="color: {C.ink};">
					{game.white.username}<span class="px-1.5 font-normal" style="color: {C.muted};">vs</span
					>{game.black.username}
					<span class="ml-1.5 text-lg font-semibold tabular-nums" style="color: {C.muted};"
						>{resultLabel}</span
					>
				</h1>
				{#if session.analysis}
					<span class="chip-meta">Analyzed · depth {session.analysis.depth}</span>
				{/if}
			</div>
			<p class="mt-0.5 text-sm" style="color: {C.muted};">
				{game.opening ?? 'Unknown opening'} · <span class="capitalize">{game.timeClass}</span>
				{game.timeControl} · {dateFmt.format(new Date(game.playedAt))}
				{#if game.url}
					· <a
						href={game.url}
						target="_blank"
						rel="noreferrer"
						class="underline-offset-2 hover:underline">chess.com ↗</a
					>
				{/if}
			</p>
		</header>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
			<!-- Board column -->
			<div>
				<div class="mx-auto w-full" style="max-width: min(66svh, 40rem, 100%);">
					{@render playerRow(topPlayer, topColor, clockAt(topColor))}

					<div class="mt-1.5 flex gap-2">
						<EvalBar
							whiteWin={boardWhiteWin}
							pulse={explore.evaluating || thread.evaluating}
							moments={!active ? momentBarPips : undefined}
						/>
						<div class="relative min-w-0 flex-1">
							<Board
								fen={boardFen}
								interactive={explore.active}
								selected={explore.active ? explore.selected : null}
								legalDestinations={explore.active ? explore.legalDests : []}
								lastMove={boardLastMove}
								opponentArrow={boardArrow}
								onSquareClick={explore.active ? explore.onSquareClick : () => {}}
								{orientation}
							/>
							{#if explore.pendingPromotion}
								<PromotionPicker
									color={explore.promotionColor === 'w' ? 'w' : 'b'}
									onSelect={(piece) => explore.completePromotion(piece)}
									onCancel={() => explore.cancelPromotion()}
								/>
							{/if}
						</div>
					</div>

					<div class="mt-1.5">
						{@render playerRow(bottomPlayer, bottomColor, clockAt(bottomColor))}
					</div>

					<ReplayControls
						{ply}
						{plyCount}
						{goTo}
						onFlip={() => (orientation = orientation === 'white' ? 'black' : 'white')}
						exploring={explore.active}
						canUndo={explore.nodes.length > 0}
						onUndo={() => explore.undo()}
						onExitExplore={() => explore.exit()}
						navHidden={active}
					/>

					{#if !explore.active && !active}
						<div class="mt-2 flex justify-center">
							<button class="branch-enter" onclick={enterExplore}> Play it out from here ↪ </button>
						</div>
					{/if}
				</div>

				<!-- Move verdict — the branch panel takes over while exploring; hidden while
				     the coach is open (the conversation is the focus then). -->
				{#if explore.active}
					<ExplorePanel
						baseLabel={explore.baseLabel}
						nodes={explore.nodes}
						evaluating={explore.evaluating}
						starred={exploreStarred}
						onStar={starExplore}
						onTalk={talkThroughExplore}
					/>
				{:else if currentMove && !active}
					<div class="mt-4">
						<MoveVerdict
							classification={currentMove.classification}
							mover={currentMove.color}
							san={currentMove.san}
							bestSan={currentMove.bestMoveSan}
						/>
					</div>
				{/if}

				<!-- The move's reveal + actions. Hidden while the coach panel is open: the
				     explanation moves to a peek above the panel and the note goes read-only. -->
				{#if ply >= 1 && !explore.active && !active}
					<div class="card mt-3">
						{#if session.explanations[ply]}
							<div class="eyebrow mb-1.5">What happened</div>
							<p class="leading-relaxed whitespace-pre-line" style="color: {C.body};">
								{session.explanations[ply]}
							</p>
							<!-- Re-run through the grounded+gated pipeline, overwriting a stale or
							     wrong cached explanation. -->
							<button
								class="regen mt-2 text-xs"
								onclick={() => session.runExplain(ply, true)}
								disabled={session.explaining}
							>
								{session.explaining ? 'Regenerating…' : '↻ Regenerate'}
							</button>
							{#if session.explainError}
								<p class="mt-2 text-xs" style="color: {C.bad};">{session.explainError}</p>
							{/if}
						{:else}
							<button
								class="btn w-full"
								onclick={() => session.runExplain(ply)}
								disabled={session.explaining}
							>
								{session.explaining ? 'Thinking…' : 'Explain this move'}
							</button>
							{#if session.explaining}
								<p class="mt-2 text-xs" style="color: {C.muted};">
									Running the engine on this position…
								</p>
							{/if}
							{#if session.explainError}
								<p class="mt-2 text-xs" style="color: {C.bad};">{session.explainError}</p>
							{/if}
						{/if}

						<!-- The core move: talk it through with the coach, on this ply, same side. -->
						<button class="talk mt-3" onclick={talkItThrough}>Talk it through ↪</button>

						<!-- Per-move star + note, against the move currently in view. The note
						     textarea is re-seeded per ply via {#key}; it saves from blur. -->
						<div class="mt-3 flex items-center gap-2">
							<button
								class="icon-btn {currentState?.mark === 'star' ? 'icon-on' : ''}"
								aria-pressed={currentState?.mark === 'star'}
								title={currentState?.mark === 'star' ? 'Remove star' : 'Star this move'}
								onclick={() => toggleStarRef(moveRef(ply))}>★ Star</button
							>
						</div>
						{#key ply}
							<div class="mt-2">
								<label class="eyebrow mb-1 block" for="move-note">Your note</label>
								<textarea
									id="move-note"
									class="note"
									rows="2"
									placeholder="What were you thinking here?"
									value={currentState?.note?.text ?? ''}
									onblur={(e) => writeNote(ply, e.currentTarget.value)}
								></textarea>
							</div>
						{/key}
					</div>
				{/if}
			</div>

			<!-- Side panel: the coach conversation, or the analyze CTA + move list when idle. -->
			<aside
				class="flex flex-col gap-3 lg:sticky lg:top-4"
				style="max-height: calc(100svh - 2rem);"
			>
				{#if active}
					{#if thread.ownsBoard}
						<!-- Coaching a hypothetical "what if" line — the real move's explanation /
						     note don't describe it, so we show its own banner + star instead. -->
						<div class="alt-head flex items-center justify-between gap-2 py-2.5">
							<span class="text-sm" style="color: {C.body};">
								A line you explored — not the actual game.
							</span>
							{#if thread.currentRef}
								<button
									class="icon-btn {isStarred(thread.currentRef) ? 'icon-on' : ''}"
									aria-pressed={isStarred(thread.currentRef)}
									title={isStarred(thread.currentRef) ? 'Remove star' : 'Star this line'}
									onclick={() => toggleStarRef(thread.currentRef!)}>★</button
								>
							{/if}
						</div>
					{:else}
						<!-- Coach open: the reveal collapses to a peek above the conversation so the
						     player can check it without losing their place; the note goes read-only. -->
						{#if session.explanations[ply]}
							<Disclosure
								storageKey="review:reveal-peek"
								showLabel="What happened"
								hideLabel="Hide what happened"
							>
								<p class="text-sm leading-relaxed whitespace-pre-line" style="color: {C.body};">
									{session.explanations[ply]}
								</p>
							</Disclosure>
						{/if}
						{#if currentState?.note?.text}
							<div class="card py-2.5">
								<div class="eyebrow mb-1">Your note</div>
								<p class="text-sm whitespace-pre-line" style="color: {C.body};">
									{currentState.note.text}
								</p>
							</div>
						{/if}
					{/if}
					{#key thread.currentPly}
						<CoachPanel {thread} />
					{/key}
				{:else}
					{#if !session.analysis}
						<div class="card">
							<button class="btn w-full" onclick={session.runAnalysis} disabled={session.analyzing}>
								{session.analyzing ? 'Analyzing…' : 'Analyze game'}
							</button>
							{#if session.analyzing}
								<div class="mt-3">
									<div
										class="h-1.5 w-full overflow-hidden rounded-full"
										style="background: {C.track};"
									>
										<div
											class="h-full rounded-full transition-[width] duration-150"
											style="width: {session.progress.total
												? (session.progress.done / session.progress.total) * 100
												: 0}%; background: {C.good};"
										></div>
									</div>
									<p class="mt-1.5 text-xs" style="color: {C.muted};">
										{session.progress.done} / {session.progress.total} positions
									</p>
								</div>
							{/if}
							{#if session.analyzeError}
								<p class="mt-2 text-xs" style="color: {C.bad};">{session.analyzeError}</p>
							{/if}
						</div>
					{:else if session.cacheNote}
						<div class="card py-2.5">
							<p class="text-xs" style="color: var(--warn);">{session.cacheNote}</p>
						</div>
					{/if}

					<!-- Saved "what if" lines — the alternatives the player explored and kept
					     (starred or talked through). Click to replay the line and reopen its
					     coach conversation. -->
					{#if alternatives.length}
						<div class="card py-2.5">
							<div class="eyebrow mb-1.5">Lines you explored</div>
							<ul class="grid gap-1.5">
								{#each alternatives as alt (altKey(alt.ply, alt.line))}
									<li>
										<button class="alt-row" onclick={() => reopenAlternative(alt)}>
											<span class="flex items-center gap-1.5">
												{#if altMarks[altKey(alt.ply, alt.line)] === 'star'}<span class="alt-star"
														>★</span
													>{/if}
												<span class="text-sm" style="color: {C.ink};">{alt.line.join(' ')}</span>
											</span>
											<span class="text-xs" style="color: {C.muted};">{altLabel(alt)}</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<!-- The notation table is the second layer: the transport controls under
					     the board drive navigation, so this only hides the move *list*, never
					     the ability to step through the game. Remembered across visits. -->
					<Disclosure
						storageKey="review:details"
						showLabel="Show the moves"
						hideLabel="Hide the moves"
					>
						<MoveList {moves} activePly={ply} {dotColor} onSelect={goTo} {momentPlies} />
					</Disclosure>
				{/if}
			</aside>
		</div>
	</main>
</div>

{#snippet playerRow(p: { username: string; rating?: number }, color: 'w' | 'b', clock: string)}
	<div class="flex items-center justify-between gap-2">
		<span class="flex items-center gap-2">
			<span class="chip-color {color === 'w' ? 'chip-w' : 'chip-b'}"></span>
			<span class="text-sm font-semibold" style="color: {C.ink};">{playerLine(p)}</span>
			{#if accuracyFor(color) !== null}
				<span class="acc-badge tabular-nums">{accuracyFor(color)!.toFixed(1)}%</span>
			{/if}
		</span>
		<span class="text-sm tabular-nums" style="color: {C.muted};">{clock}</span>
	</div>
{/snippet}

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

	.chip-meta {
		border-radius: 9999px;
		background: var(--surface-2);
		padding: 0.2rem 0.7rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-2);
	}

	.chip-color {
		display: inline-block;
		height: 0.8rem;
		width: 0.8rem;
		border-radius: 9999px;
		border: 1px solid var(--border-strong);
	}
	.chip-w {
		background: var(--piece-white);
	}
	.chip-b {
		background: var(--piece-black);
		border-color: var(--piece-black);
	}
	.acc-badge {
		border-radius: 9999px;
		background: var(--surface-2);
		padding: 0.05rem 0.45rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-2);
	}

	/* Branch affordance — the quiet "play it out" entry below the controls. */
	.branch-enter {
		border-radius: 9999px;
		padding: 0.35rem 0.85rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.branch-enter:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	/* Header strip above the coach when discussing an explored "what if" line. */
	.alt-head {
		border-radius: 0.85rem;
		border: 1px dashed var(--border-strong);
		background: var(--surface-1);
		padding-inline: 0.85rem;
	}

	/* A saved explored line in the "Lines you explored" list. */
	.alt-row {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border-radius: 0.6rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.4rem 0.6rem;
		text-align: left;
		font-variant-numeric: tabular-nums;
		transition: background var(--dur-fast);
	}
	.alt-row:hover {
		background: var(--surface-2);
	}
	.alt-star {
		color: var(--rating);
	}

	@media (pointer: coarse) {
		.branch-enter,
		.talk,
		.regen,
		.btn,
		.icon-btn,
		.alt-row {
			min-height: 2.75rem;
		}
	}

	/* Quiet "regenerate this explanation" control under the prose. */
	.regen {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--text-muted);
		transition: color var(--dur-fast);
	}
	.regen:hover {
		color: var(--text);
	}
	.regen:disabled {
		opacity: 0.6;
		cursor: default;
	}

	/* The primary move action — hand it to the coach. */
	.talk {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		border-radius: 0.6rem;
		border: 1px solid transparent;
		background: var(--brand);
		padding: 0.55rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--bg);
		transition: filter var(--dur);
	}
	.talk:hover {
		filter: brightness(1.05);
	}

	.icon-btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.4rem 0.8rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur),
			color var(--dur);
	}
	.icon-btn:hover {
		background: var(--surface-2);
	}
	.icon-on {
		background: var(--surface-3);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}

	.note {
		width: 100%;
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.5rem 0.7rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text);
		resize: vertical;
	}
	.note::placeholder {
		color: var(--text-muted);
	}
	.note:focus {
		outline: none;
		border-color: var(--rating);
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
		cursor: default;
		opacity: 0.6;
	}
</style>
