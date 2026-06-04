<script lang="ts" module>
	export type ConnectSelection = { source: ReviewSource; username: string };
</script>

<script lang="ts">
	import { LIGHT_DEPTH } from '$lib/client/reviewAnalysis';
	import {
		drawLine,
		initialState,
		revealGame,
		REVEAL_BEAT_MS,
		type GameState
	} from '$lib/client/recapReveal';
	import type { GameAnalysis } from '$lib/review/analysis';
	import { toPerspective } from '$lib/review/stats/perspective';
	import { templateHeadline } from '$lib/review/headlineTemplate';
	import RecapCard, { type RecapView } from '$lib/review/RecapCard.svelte';
	import { IMPORTABLE_SOURCES, type ReviewGame, type ReviewSource } from '$lib/review/types';

	/**
	 * The one "pick a platform, type your username, watch your last game come
	 * alive" primitive. Same component in three places: the anonymous landing
	 * teaser, first-login onboarding, and "add another account" on the account
	 * page. It always runs the same live light-depth reveal; `mode` only changes
	 * what happens after — `teaser` hands the selection back to the host (which
	 * routes to sign-in), `link` shows a form that does the authoritative import.
	 */
	let {
		mode,
		initialSource = 'chesscom',
		initialUsername = '',
		/** `link` mode: the form action that imports the account (e.g. `?/addAccount`). */
		action = '?/addAccount',
		/** Pre-submit hero card (the landing's static example). */
		example = null,
		onRevealed
	}: {
		mode: 'teaser' | 'link';
		initialSource?: ReviewSource;
		initialUsername?: string;
		action?: string;
		example?: RecapView | null;
		onRevealed?: (sel: ConnectSelection) => void;
	} = $props();

	const SOURCE_LABEL: Record<ReviewSource, string> = {
		chesscom: 'Chess.com',
		lichess: 'Lichess',
		upload: 'Upload'
	};

	// The settle beat is the anonymous landing's first-impression flourish only.
	// In-app (`link` mode: onboarding / add-account) the reveal stays honest.
	// svelte-ignore state_referenced_locally
	const beatMs = mode === 'teaser' ? REVEAL_BEAT_MS : 0;

	// svelte-ignore state_referenced_locally
	let source = $state<ReviewSource>(initialSource);
	// svelte-ignore state_referenced_locally
	let username = $state(initialUsername);

	// The reveal state machine, shared with the home loader.
	let st = $state<GameState>(initialState());
	let game = $state<ReviewGame | null>(null);
	let analysis = $state<GameAnalysis | null>(null);
	// Captured at submit so editing the input afterward can't break the
	// perspective (which keys on the username that owns the game).
	let revealed = $state<ConnectSelection | null>(null);
	const seen = new Set<string>();

	function patch(p: Partial<GameState>) {
		st = { ...st, ...p };
	}

	const isAnalyzing = $derived(st.phase === 'fetching' || st.phase === 'analyzing');

	const recap = $derived.by<RecapView | null>(() => {
		if (!game || !revealed) return null;
		const p = toPerspective(game, analysis, new Set([revealed.username]));
		if (!p) return null;
		return {
			outcome: p.outcome,
			opponent: p.opponent,
			opening: p.opening,
			timeClass: p.timeClass,
			headline: templateHeadline(p),
			spark: st.spark,
			accuracy: st.accuracy,
			peakWin: st.peakWin,
			analyzed: st.phase === 'analyzed' || st.phase === 'done'
		};
	});

	async function run(e: SubmitEvent) {
		e.preventDefault();
		const user = username.trim().toLowerCase();
		if (!user || isAnalyzing) return;

		const sel: ConnectSelection = { source, username: user };
		revealed = sel;
		analysis = null;
		game = null;
		patch({ ...initialState(), phase: 'fetching' });

		let fetched: ReviewGame;
		try {
			const res = await fetch('/api/review/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(sel)
			});
			if (!res.ok) {
				const msg = await res.text();
				patch({ phase: 'error', error: msg || 'Could not load that game.' });
				return;
			}
			fetched = (await res.json()) as ReviewGame;
		} catch {
			patch({ phase: 'error', error: 'Network error — try again.' });
			return;
		}

		game = fetched;
		const result = await revealGame(fetched, {
			accounts: new Set([user]),
			depth: LIGHT_DEPTH,
			beatMs,
			onPatch: patch
		});
		if (!result.ok) return;
		analysis = result.analysis;
		patch({ phase: 'done' });
		onRevealed?.(sel);
	}

	function reset() {
		game = null;
		analysis = null;
		revealed = null;
		st = initialState();
	}
</script>

{#if game && recap}
	<RecapCard
		{recap}
		analyzing={isAnalyzing}
		progress={{ done: st.done, total: st.total }}
		{beatMs}
		lineAttach={drawLine(
			revealed ? `${revealed.source}:${revealed.username}` : '',
			st.animateGraph,
			seen
		)}
	/>

	{#if !isAnalyzing}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			{#if mode === 'link'}
				<form method="POST" {action}>
					<input type="hidden" name="source" value={revealed?.source} />
					<input type="hidden" name="username" value={revealed?.username} />
					<button
						type="submit"
						class="rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover"
					>
						Bring in my games <span aria-hidden="true">→</span>
					</button>
				</form>
			{/if}
			<button type="button" onclick={reset} class="text-sm text-text-muted hover:text-text-2">
				Try a different account
			</button>
		</div>
	{/if}
{:else}
	<!-- Action first. On a phone the example card is the tallest thing on the
	     page; leading with it pushed the username field below the fold, so you
	     were told to type with nowhere visible to do it. The input goes up top;
	     the example sits below as proof that rewards the scroll. -->
	<form onsubmit={run} class="flex flex-col gap-3">
		<div class="inline-flex w-fit rounded-lg border border-border bg-surface-1 p-1">
			{#each IMPORTABLE_SOURCES as s (s)}
				<button
					type="button"
					onclick={() => (source = s)}
					class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:py-2.5 {source ===
					s
						? 'bg-surface-3 text-text'
						: 'text-text-muted hover:text-text-2'}"
				>
					{SOURCE_LABEL[s]}
				</button>
			{/each}
		</div>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
			<input
				bind:value={username}
				placeholder="your {SOURCE_LABEL[source]} username"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				class="w-full min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-text focus:border-border-strong focus:outline-none sm:flex-1"
			/>
			<button
				type="submit"
				disabled={isAnalyzing}
				class="w-full rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-60 sm:w-auto"
			>
				See my last game <span aria-hidden="true">→</span>
			</button>
		</div>

		{#if st.phase === 'error'}
			<p class="text-sm text-bad">{st.error}</p>
		{/if}
	</form>

	{#if mode === 'teaser'}
		<p class="mt-3 text-sm text-text-muted">No sign-up to look.</p>
	{/if}

	{#if example}
		<p class="mt-8 mb-3 text-sm text-text-muted">An example — one of mine.</p>
		<div class="opacity-90">
			<RecapCard recap={example} />
		</div>
	{/if}
{/if}
