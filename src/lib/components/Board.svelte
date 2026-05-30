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
	};

	let {
		fen,
		selected,
		legalDestinations,
		lastMove,
		opponentArrow = null,
		onSquareClick,
		orientation = 'white'
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

	const PIECE_NAMES_DE: Record<string, string> = {
		k: 'König',
		q: 'Dame',
		r: 'Turm',
		b: 'Läufer',
		n: 'Springer',
		p: 'Bauer'
	};
	function pieceLabel(c: string): string {
		const color = c === c.toUpperCase() ? 'Weißer' : 'Schwarzer';
		return `${color} ${PIECE_NAMES_DE[c.toLowerCase()] ?? ''}`.trim();
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

	// A single filled arrow polygon (Lichess-style: straight shaft + triangular
	// head), in board-square units. The tip lands just inside the to-square so
	// the move clearly "arrives"; the shaft starts at the from-square centre.
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

		const shaftW = 0.17;
		const headW = 0.42;
		const headL = 0.34;
		const tipGap = 0.12; // stop just short of the to-square centre

		const tipX = b.x - ux * tipGap;
		const tipY = b.y - uy * tipGap;
		const baseX = tipX - ux * headL;
		const baseY = tipY - uy * headL;

		const p = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
		const points = [
			p(a.x + nx * shaftW * 0.5, a.y + ny * shaftW * 0.5),
			p(baseX + nx * shaftW * 0.5, baseY + ny * shaftW * 0.5),
			p(baseX + nx * headW * 0.5, baseY + ny * headW * 0.5),
			p(tipX, tipY),
			p(baseX - nx * headW * 0.5, baseY - ny * headW * 0.5),
			p(baseX - nx * shaftW * 0.5, baseY - ny * shaftW * 0.5),
			p(a.x - nx * shaftW * 0.5, a.y - ny * shaftW * 0.5)
		].join(' ');
		return { points };
	});
</script>

<!--
  grid-rows-8 ensures every cell is genuinely square on an aspect-square parent.
  Light/dark squares use the modern muted Lichess palette (#ebecd0 / #779556).
-->
<div
	class="relative mx-auto grid aspect-square w-full max-w-[min(80svh,95svw)] grid-cols-8 grid-rows-8 overflow-hidden rounded-2xl shadow-sm ring-1 ring-stone-200 select-none"
>
	{#each renderedRanks as rank (rank)}
		{#each renderedFiles as file (file)}
			{@const sq = squareName(file, rank)}
			{@const piece = pieceMap[sq]}
			{@const isSel = selected === sq}
			{@const isDest = legalDestinations.includes(sq)}
			{@const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq)}
			{@const light = isLight(file, rank)}
			<button
				type="button"
				aria-label={piece ? `${sq} – ${pieceLabel(piece)}` : sq}
				class="relative flex items-center justify-center transition-colors duration-100 {light
					? 'bg-[#ebecd0]'
					: 'bg-[#779556]'} {isSel ? 'bg-amber-300/60' : ''} {isLast && !isSel
					? 'bg-amber-200/55'
					: ''}"
				onclick={() => onSquareClick(sq)}
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
							? 'inset-[6%] border-[5px] border-stone-900/25 bg-transparent'
							: 'h-[28%] w-[28%] bg-stone-900/22'}"
					></span>
				{/if}

				{#if rankLabelOn(file)}
					<span
						class="pointer-events-none absolute top-1 left-1.5 text-[0.65rem] font-semibold {light
							? 'text-[#779556]'
							: 'text-[#ebecd0]'}">{rank}</span
					>
				{/if}
				{#if fileLabelOn(rank)}
					<span
						class="pointer-events-none absolute right-1.5 bottom-0.5 text-[0.65rem] font-semibold {light
							? 'text-[#779556]'
							: 'text-[#ebecd0]'}">{file}</span
					>
				{/if}
			</button>
		{/each}
	{/each}

	{#if arrowGeom}
		<svg
			class="opp-arrow pointer-events-none absolute inset-0 h-full w-full text-amber-600/85"
			viewBox="0 0 8 8"
			aria-hidden="true"
		>
			<polygon
				points={arrowGeom.points}
				fill="currentColor"
				stroke="currentColor"
				stroke-width="0.03"
				stroke-linejoin="round"
			/>
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
