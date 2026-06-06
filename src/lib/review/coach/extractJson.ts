/**
 * Pull a JSON object out of a model reply. Reasoning models (the coach runs on
 * Gemini Flash, which mandates reasoning) routinely wrap the answer in ``` fences
 * or surround it with prose, and may emit an *example* object before the real
 * one. So: prefer the last fenced block, then take the last COMPLETE top-level
 * `{...}` object in it — the answer, not an earlier example or a stray brace in
 * the reasoning. Shared by `coach.ts` and `gate.ts` so the two extractors can't
 * drift.
 */

/** The last balanced top-level `{...}` object in `s`, or null. String literals
 *  (incl. escaped quotes) are respected so braces inside strings don't count. */
function lastBalancedObject(s: string): string | null {
	let result: string | null = null;
	let depth = 0;
	let start = -1;
	let inStr = false;
	let esc = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === '\\') esc = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') inStr = true;
		else if (ch === '{') {
			if (depth === 0) start = i;
			depth++;
		} else if (ch === '}' && depth > 0) {
			depth--;
			if (depth === 0 && start !== -1) result = s.slice(start, i + 1);
		}
	}
	return result;
}

export function extractJson(raw: string): unknown {
	const fences = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
	const body = fences.length ? fences[fences.length - 1]![1]! : raw;
	const obj = lastBalancedObject(body) ?? lastBalancedObject(raw);
	if (!obj) throw new Error('no JSON object in reply');
	return JSON.parse(obj);
}
