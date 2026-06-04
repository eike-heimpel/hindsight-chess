<!--
  Pure presentational chess board. All state (selection, legal moves, last move)
  is owned by the parent — this component just renders + emits clicks.

  Designed tablet-first per project_ux_constraints.md:
    - Tap-to-select interaction (no drag).
    - Square sizing scales with viewport (square aspect ratio enforced).
    - No hover-only affordances; selection/legality are state-driven.

  Pieces: cburnett SVG set served from /pieces/{wK,wQ,...}.svg. CC-BY-SA-3.0,
  by Colin M.L. Burnett — same set Lichess and Wikipedia use. Inlined as <img>
  so the browser caches each piece once.
-->
<script lang="ts">
	import type { Square } from '$lib/chess/types';

	type Props = {
		fen: string;
		selected: Square | null;
		legalDestinations: Square[];
		lastMove: { from: Square; to: Square } | null;
		/** Trajectory overlay for the opponent's refutation after a mistake.
		 *  The player sees the post-state via `lastMove`; the arrow shows the
		 *  path. */
		opponentArrow?: { from: Square; to: Square } | null;
		onSquareClick: (sq: Square) => void;
		orientation?: 'white' | 'black';
		/** When false (review/replay), squares render as decorative cells — no
		 *  focusable no-op buttons, no per-square labels (the move list is the
		 *  screen-reader representation). Defaults true for the play surface. */
		interactive?: boolean;
	};

	let {
		fen,
		selected,
		legalDestinations,
		lastMove,
		opponentArrow = null,
		onSquareClick,
		orientation = 'white',
		interactive = true
	}: Props = $props();

	const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
	const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

	let pieceMap = $derived(parseFenPieces(fen));
	let renderedFiles = $derived(orientation === 'white' ? FILES : [...FILES].reverse());
	let renderedRanks = $derived(orientation === 'white' ? RANKS : [...RANKS].reverse());

	function squareName(file: string, rank: number): Square {
		return `${file}${rank}` as Square;
	}

	function isLight(file: string, rank: number): boolean {
		return ('abcdefgh'.indexOf(file) + rank) % 2 === 1;
	}

	function pieceSrc(c: string): string {
		const color = c === c.toUpperCase() ? 'w' : 'b';
		return `/pieces/${color}${c.toUpperCase()}.svg`;
	}

	const PIECE_NAMES: Record<string, string> = {
		k: 'king',
		q: 'queen',
		r: 'rook',
		b: 'bishop',
		n: 'knight',
		p: 'pawn'
	};
	function pieceLabel(c: string): string {
		const color = c === c.toUpperCase() ? 'White' : 'Black';
		return `${color} ${PIECE_NAMES[c.toLowerCase()] ?? ''}`.trim();
	}

	function parseFenPieces(fen: string): Record<string, string> {
		const out: Record<string, string> = {};
		const ranks = fen.split(' ')[0].split('/');
		for (let r = 0; r < 8; r++) {
			let fileIdx = 0;
			for (const c of ranks[r]) {
				if (/[1-8]/.test(c)) {
					fileIdx += parseInt(c, 10);
				} else {
					const sq = `${'abcdefgh'[fileIdx]}${8 - r}`;
					out[sq] = c;
					fileIdx++;
				}
			}
		}
		return out;
	}

	function rankLabelOn(file: string): boolean {
		return file === (orientation === 'white' ? 'a' : 'h');
	}
	function fileLabelOn(rank: number): boolean {
		return rank === (orientation === 'white' ? 1 : 8);
	}

	function squareToXY(sq: Square): { x: number; y: number } {
		const fileIdx = 'abcdefgh'.indexOf(sq[0]);
		const rankIdx = 8 - parseInt(sq[1], 10);
		const x = orientation === 'white' ? fileIdx + 0.5 : 7.5 - fileIdx;
		const y = orientation === 'white' ? rankIdx + 0.5 : 7.5 - rankIdx;
		return { x, y };
	}

	// Arrow as a rounded-cap shaft line + a triangular head (not one flat polygon),
	// in board-square units. The shaft starts a touch off the from-square centre so
	// its rounded tail lifts cleanly off the origin piece instead of sitting blunt
	// on top of it; the tip lands just inside the to-square so the move "arrives".
	let arrowGeom = $derived.by(() => {
		if (!opponentArrow) return null;
		const a = squareToXY(opponentArrow.from);
		const b = squareToXY(opponentArrow.to);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		const ux = dx / len;
		const uy = dy / len;
		const nx = -uy; // unit normal
		const ny = ux;

		const shaftW = 0.16;
		const headW = 0.4;
		const headL = 0.32;
		const tipGap = 0.1; // stop just short of the to-square centre
		const startGap = 0.22; // lift the rounded tail off the origin piece

		const sx = a.x + ux * startGap;
		const sy = a.y + uy * startGap;
		const tipX = b.x - ux * tipGap;
		const tipY = b.y - uy * tipGap;
		const baseX = tipX - ux * headL;
		const baseY = tipY - uy * headL;

		const p = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
		const head = [
			p(tipX, tipY),
			p(baseX + nx * headW * 0.5, baseY + ny * headW * 0.5),
			p(baseX - nx * headW * 0.5, baseY - ny * headW * 0.5)
		].join(' ');
		return { sx, sy, baseX, baseY, head, shaftW };
	});
</script>

<!--
  grid-rows-8 ensures every cell is genuinely square on an aspect-square parent.
  Square / highlight / arrow colours come from board tokens (docs/design/system.md).
-->
<div
	class="relative mx-auto grid aspect-square w-full max-w-[min(80svh,95svw)] grid-cols-8 grid-rows-8 overflow-hidden rounded-2xl shadow-sm ring-1 ring-[var(--border)] select-none"
>
	{#each renderedRanks as rank (rank)}
		{#each renderedFiles as file (file)}
			{@const sq = squareName(file, rank)}
			{@const piece = pieceMap[sq]}
			{@const isSel = selected === sq}
			{@const isDest = legalDestinations.includes(sq)}
			{@const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq)}
			{@const light = isLight(file, rank)}
			<svelte:element
				this={interactive ? 'button' : 'div'}
				type={interactive ? 'button' : undefined}
				role={interactive ? 'button' : undefined}
				aria-label={interactive ? (piece ? `${sq} – ${pieceLabel(piece)}` : sq) : undefined}
				class="relative flex items-center justify-center transition-colors duration-100 {light
					? 'bg-[var(--board-light)]'
					: 'bg-[var(--board-dark)]'}"
				style={isSel
					? 'background-image: linear-gradient(var(--board-select), var(--board-select))'
					: isLast
						? 'background-image: linear-gradient(var(--board-last), var(--board-last))'
						: ''}
				onclick={interactive ? () => onSquareClick(sq) : undefined}
			>
				{#if piece}
					<img
						src={pieceSrc(piece)}
						alt=""
						draggable="false"
						class="pointer-events-none h-[88%] w-[88%] drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)] {lastMove?.to ===
						sq
							? 'piece-pop'
							: ''}"
					/>
				{/if}

				{#if isDest}
					<span
						class="pointer-events-none absolute rounded-full {piece
							? 'inset-[6%] border-[5px] border-[var(--board-marker)] bg-transparent'
							: 'h-[28%] w-[28%] bg-[var(--board-marker)]'}"
					></span>
				{/if}

				{#if rankLabelOn(file)}
					<span
						class="pointer-events-none absolute top-1 left-1.5 text-[0.65rem] font-semibold {light
							? 'text-[var(--board-dark)]'
							: 'text-[var(--board-light)]'}">{rank}</span
					>
				{/if}
				{#if fileLabelOn(rank)}
					<span
						class="pointer-events-none absolute right-1.5 bottom-0.5 text-[0.65rem] font-semibold {light
							? 'text-[var(--board-dark)]'
							: 'text-[var(--board-light)]'}">{file}</span
					>
				{/if}
			</svelte:element>
		{/each}
	{/each}

	{#if arrowGeom}
		<svg
			class="opp-arrow pointer-events-none absolute inset-0 h-full w-full text-[var(--arrow-best)]"
			viewBox="0 0 8 8"
			aria-hidden="true"
		>
			<!-- One group opacity so the shaft/head overlap doesn't double-darken. -->
			<g opacity="0.82">
				<line
					x1={arrowGeom.sx}
					y1={arrowGeom.sy}
					x2={arrowGeom.baseX}
					y2={arrowGeom.baseY}
					stroke="currentColor"
					stroke-width={arrowGeom.shaftW}
					stroke-linecap="round"
				/>
				<polygon
					points={arrowGeom.head}
					fill="currentColor"
					stroke="currentColor"
					stroke-width="0.06"
					stroke-linejoin="round"
				/>
			</g>
		</svg>
	{/if}
</div>

<style>
	@keyframes piece-pop {
		from {
			transform: scale(0.7);
			opacity: 0.4;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	.piece-pop {
		animation: piece-pop 180ms ease-out;
	}
	@keyframes opp-arrow-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.opp-arrow {
		animation: opp-arrow-in 220ms ease-out;
	}
</style>
