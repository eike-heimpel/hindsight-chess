// Single source of truth for the operator's legal identity, referenced by the
// Impressum / privacy / terms pages and the footer. Facts verified against the
// agentur moog GmbH commercial register entry.
export const company = {
	name: 'agentur moog GmbH',
	product: 'Hindsight',
	managingDirector: 'Tobias Heimpel',
	street: 'Magirusstraße 33',
	city: '89077 Ulm',
	country: 'Germany',
	email: 'info@agenturmoog.de',
	register: 'HRB Ulm 734140',
	registerCourt: 'Amtsgericht Ulm',
	vatId: 'DE308309857'
} as const;

// Shown on every legal page. Bump when the substance of a page changes.
export const LEGAL_UPDATED = '6 June 2026';
