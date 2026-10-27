/**
 * Render-level guard for QA D8: the "Load-bearing" badge is a claim about the
 * target in THIS repo, so it must never appear on an absent layer, and never
 * at all when the dossier's backbone read is No. The unit test on
 * loadBearingMark() covers the rule; this one proves the rendered markup obeys it.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Tower from '../src/components/Tower';
import type { ArchitecturePane } from '../src/types';

function badges(html: string): number {
	return (html.match(/Load-bearing/g) || []).length;
}

describe('Tower render (D8)', () => {
	it('shows no badge when backbone is No, even on present RocketRide layers', () => {
		const html = renderToStaticMarkup(
			createElement(Tower, {
				layers: { ingest: 'rocketride', orchestration: 'rocketride', reasoning: 'none', output: 'rocketride' },
				backbone: 'No',
			}),
		);
		expect(html).toContain('not present');
		expect(badges(html)).toBe(0);
	});

	it('badges only the present load-bearing layer when backbone is Yes', () => {
		const html = renderToStaticMarkup(
			createElement(Tower, {
				layers: { orchestration: 'rocketride', reasoning: 'none' },
				backbone: 'Yes',
			}),
		);
		// Orchestration and AI Reasoning are the two load-bearing slots; only Orchestration is present.
		expect(badges(html)).toBe(1);
	});

	it('custom architecture: absent panes never carry the badge, present ones do under Partial', () => {
		const architecture: ArchitecturePane[] = [
			{ id: 'a', label: 'Ingest', load_bearing: true, state: 'none' },
			{ id: 'b', label: 'Storage', load_bearing: true, state: 'target' },
			{ id: 'c', label: 'Query', load_bearing: true, state: 'other' },
			{ id: 'd', label: 'API', load_bearing: false, state: 'target' },
			{ id: 'e', label: 'UI', load_bearing: true, state: 'target' },
		];
		const partial = renderToStaticMarkup(createElement(Tower, { architecture, backbone: 'Partial' }));
		expect(badges(partial)).toBe(2);
		const no = renderToStaticMarkup(createElement(Tower, { architecture, backbone: 'No' }));
		expect(badges(no)).toBe(0);
	});
});
