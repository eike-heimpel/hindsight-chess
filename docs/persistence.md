# Per-user persistence — the move-state layer

**Status:** built through Phase 4 (substrate + marks + notes + snapshots +
coach-thread persistence); Phase 5 (SRS + cross-game analytics) deferred — see
the delivery section. The framing below is the original design against the
pre-build state, kept because the model still holds; the **Problem it solved:**
the app persisted only _global, game-keyed_ caches (`reviewGames`,
`reviewAnalysis`, `reviewExplanations`, `reviewHeadlines`) plus a thin per-user
identity layer (`userReviewAccounts`, `userSettings`), with **no per-user review
state** — no mark-for-review, notes, saved explanations, resume, or coach memory.
This doc designs the layer that fills that gap, built so every current _and_
foreseeable feature reads from one substrate.

> This plan was adversarially verified against the real code and stress-tested
> against 11 invented future features. The corrections from that pass are folded
> in and called out inline as **[verified]**.

## Core idea: a move is the atom; features attach facets

The unit of per-user state is **a move you've touched**, identified by
`{source, gameId, ply}` — the exact key `explainId` builds in
`blunders/+page.svelte`, the same key `reviewExplanations` and the coach
`discuss` route already use. Every feature reads and writes a different **facet**
of that one move record. No feature owns the move; features own facets.

| Facet      | Written by                    | Read by                                                      | What it is                                                                           |
| ---------- | ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `mark`     | blunder trainer, review board | blunder queue (skip done / filter starred), home, future SRS | `'star' \| 'done' \| 'dismissed'`                                                    |
| `note`     | anywhere a position is shown  | everywhere                                                   | the user's own text                                                                  |
| `snapshot` | "save this explanation"       | shortlist, revisit, future share-cards                       | a **frozen, structured** copy of the LLM explanation + the engine facts at save time |
| `thread`   | coach                         | coach resume, learnings rollup, pattern detection            | the saved conversation + captured learnings                                          |

The coach writes `thread`, the trainer writes `mark`, you write `note` — all on
the same record. The Shortlist, home rail, and future weakness analytics just
_read across_ them.

## Data model

### `userMoveState` — one doc per touched move

Mirrors the `userSettings.ts` pattern exactly (`collectionAccessor`, `_id`,
`updatedAt`, defaults-when-missing). **[verified]** The four key fields are stored
as **separate indexed fields**, not only baked into the `_id` string — this is
what lets future cross-user / cross-position features (share-cards,
compare-with-a-friend) query a position without parsing `_id`.

```ts
// _id = `${userId}:${source}:${gameId}:${ply}` — composite, for uniqueness only.
type MoveStateDoc = {
	_id: string;
	userId: string; // ← indexed field, not just an _id segment
	source: string;
	gameId: string;
	ply: number;
	side: Side; // [verified] DERIVED server-side, never trusted from body
	mark?: 'star' | 'done' | 'dismissed';
	note?: { text: string; updatedAt: Date };
	snapshot?: {
		// [verified] facts are STRUCTURED + re-derived server-side
		text: string; //   the explanation prose, re-read from getExplanation()
		facts: SnapshotFacts; //   { fenBefore, playedSan, bestSan, bestUci, evalBefore, classification }
		from: 'explain' | 'coach';
		frozenAt: Date;
	};
	thread?: {
		// coach conversation (Phase 4)
		messages: DiscussTurn[]; //   reused verbatim from coach/types.ts
		learnings: Learning[]; //   cumulative wrapped set (coach/types.ts), not just last turn
		choices: string[]; //   the last coach turn's chips, so resume comes back with its next-steps
		status: 'open' | 'wrapped';
		updatedAt: Date;
	};
	updatedAt: Date;
};
```

Indexes (created via the `collectionAccessor` `init` hook):

- `{ userId, source, gameId }` — the hot per-game overlay read. **[verified]** This
  is strictly _better_ than the unindexed `listExplanations` it mirrors: the
  per-game slice is a contiguous index range.
- `{ userId, updatedAt }` — cross-game lists (shortlist, recently-touched,
  pattern detection).

**[verified] `_id` is collision-safe only because `ply` is appended last and is
a pure integer, and `userId`/`source` are delimiter-free** — a `gameId` _can_
contain a colon (`chesscom.ts` URL-derived ids), but it cannot shift the `ply`
boundary or collide across users. This is load-bearing: **never reorder the
segments.**

**Why doc-per-move** (not per-user or per-game): the dream features query
_across_ games (shortlist, weakness rollup, pattern threads). Doc-per-move
indexes cleanly for both that and the per-game read, and sidesteps the 16MB /
write-contention ceiling a coach-transcript-bearing per-user blob would hit. The
cost is N small docs — which is what indexes are for.

### `userReviewState` — one general per-user doc

`_id = userId`. **[verified]** Deliberately a _general per-user review-session
doc_, not a cursor-only collection — that framing is what makes it justified
rather than over-engineered, because foreseeable features (the "since last time"
digest, the forgiving streak) fill it with more scalars:

```ts
type ReviewStateDoc = {
	_id: string; // userId
	cursors: Record<string, MoveRef>; // { blunders: {source,gameId,ply}, coach: {...} } — Resume
	// future, additive: lastSeenAt, lastNudgeAt, streak — no migration when added
	updatedAt: Date;
};
```

## Trust & ownership — **[verified], this is where the first plan was wrong**

These are per-user writes guarded by `requireUser` (`auth.ts`). They do **not**
write the global game-keyed caches, so they don't need the engine re-derivation
the `analyze`/`explain`/`discuss` routes do — **but three holes had to close:**

1. **Ownership gate.** `getReviewGame` is a _global_ lookup with no ownership
   filter; `requireUser` only proves a session exists. Without a gate, any signed-in
   user could attach state to games they never played. **Every write** does
   `getReviewGame(source, gameId)` then asserts the user owns it (compare
   `user.reviewAccounts` against `game.white/black.username`, lowercased — via the
   shared `ownedSide` helper, which `explain` and `discuss` also use); reject with
   403 otherwise.
2. **`side` is derived, never trusted.** Compute it server-side from the stored
   game + the user's account, exactly as `discuss` does. It is not a body field.
3. **`gameId` is hardened.** Reuse `parseEngineRequestBase` (`explainRequest.ts`)
   so `source`/`ply` validate identically, and cap `gameId` length + charset before
   it ever enters a Mongo `_id`.

### Per-facet trust (not a blanket rule)

| Facet                  | Trust                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark`, `note`, cursor | user opinion — trust the body (after ownership gate)                                                                                                                                                                                                                                                                                                                                                                                   |
| `snapshot.text`        | **re-read server-side** via `getExplanation(source,gameId,ply)`; 404 if absent. Never trust body prose.                                                                                                                                                                                                                                                                                                                                |
| `snapshot.facts`       | **[verified] re-derived, not copied.** `reviewExplanations` stores _only_ `text` — there are no facts in the cache to copy. The snapshot route accepts the engine numbers (like `explain` does), validates `fenBefore`/`playedUci` against the stored move, and rebuilds facts via the same validate-then-rebuild path as `explain` (`explain/+server.ts`). For `from:'coach'`, defer to Phase 4 and freeze from the persisted thread. |
| `thread`               | `messages` are user/coach prose; `learnings`/`show` were already LLM-gated server-side by `discuss`; `choices` (the last turn's chips) is shape/cap-validated like the prose. Persisting the returned thread is fine.                                                                                                                                                                                                                  |

## Server surface — `src/lib/server/userMoveState.ts`

All take `userId` first; fail-fast house style; defaults-when-missing.

```ts
getGameMoveStates(userId, source, gameId): Promise<Record<ply, MoveState>>  // per-game overlay, mirrors listExplanations()
getMoveStatesByRefs(userId, refs: MoveRef[]): Promise<Record<key, MoveState>> // [verified] batch read for shortlist / study-sets
listShortlist(userId): Promise<MoveState[]>
getMoveState / setMark / setNote / saveThread(userId, ref, …)
freezeSnapshot(userId, game, side, body): copies text from getExplanation + rebuilds facts (validate-then-rebuild)
clearMove(userId, ref) / clearAllMoveState(userId)
// userReviewState.ts: getReviewState(userId) / setCursor(userId, queue, ref|null)
```

**Routes:** `POST/GET/DELETE /api/review/moves`, `POST /api/review/snapshot`
(needs the engine-number body), `GET /api/review/shortlist`,
`POST /api/review/cursor`, `DELETE /api/review/state` (full reset). Each guards
`requireUser` → ownership gate → write.

## Read models (no new storage — just queries)

- **Shortlist** = `find({ userId, $or: [{mark:'star'}, {note:{$exists}}, {snapshot:{$exists}}] })`
  sorted by `updatedAt`. **[verified]** Only the `mark` branch is index-covered;
  the `note`/`snapshot` branches fall back to a per-user scan — bounded by the
  user's touched-move count (small), so accepted and documented rather than
  denormalized.
- **Resume** = `userReviewState.cursors[queue]` → resolve the `MoveRef`.
- **Per-game overlay** = `getGameMoveStates`, seeded onto board surfaces.
- **Weakness rollup** = aggregate `thread.learnings` across docs (Phase 5).

## Integration points (against the current code)

1. **Blunders loader** `blunders/+page.server.ts` — add one
   `getGameMoveStates` per game in the existing `byGame` loop, seed
   `mark`/`note`/`hasThread`/`snapshot` onto entries exactly the way
   `cachedExplanation` is seeded today; return the `blunders` cursor.
2. **`BlunderEntry`** (`review/stats/types.ts`) — add optional `mark?`, `note?`,
   `hasThread?`, `snapshot?` next to `cachedExplanation`, same "seeded by the
   loader" comment.
3. **Blunders page** `blunders/+page.svelte` — **[verified] Resume is net-new, not
   a bug fix** (nothing is persisted today; the page's `index` is ephemeral). At
   mount, resolve the initial `index` by matching the saved cursor against the
   _filtered_ `entries` derived list; fail-soft to the worst blunder
   **only** when the referenced move isn't in the current view (an expected state —
   recency window / time-class filter), letting any actual read failure surface.
   Star/done/note buttons POST from their **event handlers** (not `$effect`); `go()`
   persists the cursor fire-and-forget; a "Starred" chip joins the segmented filter.
   New controls carry the 44px coarse-pointer treatment the existing `.btn`/`.seg`
   use.
4. **Coach** `coachThread.svelte.ts` — **[done].** The thread keys off a `Subject`
   (a real move, or an explored "what if" line — see the `MoveRef` `line` field), not
   a bare ply. On open it asks the injected `loadThread` for a saved thread and, when
   one exists, **seeds** `messages`/`choices`/`learnings`/`wrapUpReady` from it and
   **skips** the opening `runTurn` so resume doesn't re-bill the LLM. The injected
   `persist` (sibling of `discuss`/`evaluate`) fires after each response fold and in
   `finish()` _before_ state clears. `thread.learnings` is stored flat as `Learning[]`;
   on hydrate it re-wraps into the per-subject `{key, moveNumber, learnings}` tray.
5. **Review board** `/review/[source]/[gameId]` — note + star on any move; reads the
   same overlay.
6. **Home** — "pick up where you left off" rail (cursor) + "your shortlist (N)".

## Delivery — phased on one substrate

- **Phase 0 — substrate (no UI):** `userMoveState` + `userReviewState` stores,
  `/api/review/moves` + `/api/review/cursor` + `/api/review/state`, the per-game
  overlay read, indexes, ownership gate. The keystone; everything below is wiring.
- **Phase 1 — kills the complaint:** resume cursor + star/done in the trainer.
- **Phase 2 — what you asked for:** note field + "save this explanation" snapshot
  (`/api/review/snapshot`) on the blunder card and review board. _Mark + note +
  stored LLM_, delivered.
- **Phase 3 — moat seed:** the Shortlist view + nav entry.
- **Phase 4 — coach memory _[done: persist + resume]_:** coach threads autosave
  per turn via the `thread` facet (`/api/review/moves` `facet:'thread'`) and resume
  on return; a per-move entry links review → coach. The single monetization seam
  (`assertCanDiscuss`, allow-all) gates opening a conversation. The learnings
  _rollup_ across games is the Phase 5 aggregate. See `docs/learning-model.md`.
- **Phase 5 — deferred:** an SRS `dueAt` facet + cross-game weakness analytics
  (the `thread.learnings` rollup — the "Aggregate" stage), built only once usage
  shows people return to saved positions.

## Reset / trace / revisit

- **Trace:** `db.userMoveState.find({ userId })` shows every touched move and which
  facets. The `_id` _is_ the trace.
- **Revisit:** the Shortlist and per-game overlay surface saved state inline; coach
  threads reopen verbatim.
- **Reset:** per-facet `$unset`; per-move `deleteOne`; full
  `deleteMany({ userId })` + clear the `userReviewState` doc. No cross-references,
  so reset is atomic and complete.

## Future-feature fit — the stress test

11 invented features were mapped onto this substrate. **9 require zero schema
churn.** This is the evidence the move-as-atom bet holds.

| Future feature                    | Fits as            | Schema impact                                              |
| --------------------------------- | ------------------ | ---------------------------------------------------------- |
| Pin / Saved Positions             | clean-read         | none (composes `mark`+`note`+`snapshot`)                   |
| Coach Memory (resume + callback)  | new-facet          | the `thread` facet (Phase 4)                               |
| Leak Ledger (SRS)                 | new-facet          | additive `srs` field + one index                           |
| Weakness Drills                   | read model         | none — derived from cached games + `detectPrinciples`      |
| You Fixed This Leak               | read model         | none — per-game fold over analyses                         |
| Pattern Threads                   | read model         | additive `thread.kind`/fingerprint sub-fields              |
| The Carryover ("since last time") | mostly read model  | a `lastSeenAt` scalar on `userReviewState`                 |
| The Forgiving Streak              | cursor-extension   | scalars on `userReviewState`                               |
| Best Save card (shareable)        | **new collection** | `reviewShareCards` (public short-code) — reads `snapshot`  |
| Exportable study set              | **new collection** | `userStudySets` (ordered member list) — reads moves by ref |
| Compare-with-a-friend             | **new collection** | `moveAttempt` + `sharedMoment` — _not_ private move-state  |

### Cheap future-proofing to do _now_ (do-now, not build-now)

These keep the deferred features purely additive instead of forcing a migration:

1. **Store the four key fields separately + indexed** (done above) — unlocks
   cross-user/position queries (share-cards, compare-with-a-friend) without `_id`
   parsing.
2. **`userReviewState` is a general per-user doc**, not cursor-only — absorbs the
   digest watermark and streak scalars later.
3. **`snapshot.facts` is structured** (board + best move + eval + classification),
   not just prose — makes it the single source of truth a standalone share-card
   renders from.
4. **Add `getMoveStatesByRefs`** alongside `getGameMoveStates` — the batch read
   shortlist and study-sets both need.
5. _Documented for later (not built):_ an optional stable `theme` tag on `Learning`
   and a pure `themesFor(move, analysis, game)` helper would make the weakness
   read-models clean; defer until Phase 5.

### Genuinely new objects (correctly _not_ move-facets)

Share-cards, study-sets, and the compare-with-a-friend attempt/shared-moment are
new _things_ a user creates, with their own lifecycle (public links, ordering,
cross-user reads). They get their own collections when built — and they read move
content off this substrate for free. The substrate doesn't need to anticipate
them beyond the four do-now adjustments.
