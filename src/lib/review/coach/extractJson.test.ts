import { describe, it, expect } from 'vitest';
import { extractJson } from './extractJson';

describe('extractJson', () => {
	it('parses a plain JSON object', () => {
		expect(extractJson('{"pass": true, "reason": "ok"}')).toEqual({ pass: true, reason: 'ok' });
	});

	it('parses JSON wrapped in ```json fences', () => {
		const raw = 'here you go:\n```json\n{"show": "best", "choices": []}\n```';
		expect(extractJson(raw)).toEqual({ show: 'best', choices: [] });
	});

	it('parses JSON with prose before and after', () => {
		const raw = 'My verdict is the following object. {"pass": false} — done.';
		expect(extractJson(raw)).toEqual({ pass: false });
	});

	it('returns the LAST top-level object when an example precedes the real one', () => {
		const raw =
			'Example: {"pass": true, "reason": "example"}. Real answer: {"pass": false, "reason": "real"}';
		expect(extractJson(raw)).toEqual({ pass: false, reason: 'real' });
	});

	it('prefers the last fenced block over an earlier fenced example', () => {
		const raw =
			'```json\n{"message": "example"}\n```\nand the real one:\n```json\n{"message": "final"}\n```';
		expect(extractJson(raw)).toEqual({ message: 'final' });
	});

	it('does not break on braces inside string values', () => {
		const raw = '{"reason": "consider {this} and {that}", "pass": true}';
		expect(extractJson(raw)).toEqual({ reason: 'consider {this} and {that}', pass: true });
	});

	it('throws when there is no JSON object in the reply', () => {
		expect(() => extractJson('no object here at all')).toThrow('no JSON object in reply');
	});
});
