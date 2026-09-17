import { describe, expect, it } from 'vitest';
import { paneTone } from '../src/components/Tower';
import {
	ARCHITECTURE_TEMPLATES,
	inferArchitectureTemplate,
	isStockArchitecture,
	scoringConfigForPlan,
	withoutUserRubric,
} from '../src/verify/architecture';

describe('paneTone', () => {
	it('paints load-bearing target plates green on first render', () => {
		expect(paneTone('target', true)).toBe('core');
		expect(paneTone('target', false)).toBe('rr');
		expect(paneTone('none', true)).toBe('off');
		expect(paneTone('other', true)).toBe('off');
	});
});

describe('inferArchitectureTemplate', () => {
	it('honors an explicit template id', () => {
		expect(inferArchitectureTemplate(['platform'], 'sdk')).toBe('sdk');
	});
	it('maps types the same way extract.py does', () => {
		expect(inferArchitectureTemplate(['code'])).toBe('sdk');
		expect(inferArchitectureTemplate(['api'])).toBe('api');
		expect(inferArchitectureTemplate(['platform'])).toBe('deploy');
		expect(inferArchitectureTemplate(['code', 'platform'])).toBe('data_platform');
		expect(inferArchitectureTemplate(['platform', 'api'])).toBe('data_platform');
	});
});

describe('isStockArchitecture', () => {
	it('detects stock vs custom pane labels', () => {
		expect(isStockArchitecture(ARCHITECTURE_TEMPLATES.sdk.panes, 'sdk')).toBe(true);
		expect(isStockArchitecture(
			ARCHITECTURE_TEMPLATES.sdk.panes.map((p, i) => (i === 2 ? { ...p, label: 'Laser SDK' } : p)),
			'sdk',
		)).toBe(false);
	});
});

describe('scoringConfigForPlan', () => {
	const custom = { types: ['code'], weights: { dependency: 9 }, thresholds: { significant: 9 } };
	it('keeps per-target weights on Company and Organizers', () => {
		expect(scoringConfigForPlan(custom, 'company').weights).toEqual({ dependency: 9 });
		expect(scoringConfigForPlan(custom, 'organizers').thresholds).toEqual({ significant: 9 });
	});
	it('strips weights on Developer so the engine uses team defaults', () => {
		expect(withoutUserRubric(custom)).toEqual({ types: ['code'] });
		expect(scoringConfigForPlan(custom, 'developer').weights).toBeUndefined();
	});
});
