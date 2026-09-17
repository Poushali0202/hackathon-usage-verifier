import React, { useLayoutEffect, useRef } from 'react';
import type { ArchitecturePane, LayerMap } from '../types';
import { ARCHITECTURE_TEMPLATES } from '../verify/architecture';

/** Brand stack: five plates, bottom → top. Product copy only swaps the labels. */
const RAG: Array<{ id: string; label: string; load: boolean }> = [
	{ id: 'ingest', label: 'Ingest', load: false },
	{ id: 'retrieval', label: 'Retrieval / RAG', load: false },
	{ id: 'orchestration', label: 'Orchestration', load: true },
	{ id: 'reasoning', label: 'AI Reasoning', load: true },
	{ id: 'output', label: 'Output / UI', load: false },
];

/** Extra labels used to keep a 5-plate tower when a product template has fewer panes. */
function pickSkeleton(custom: ArchitecturePane[]) {
	const ids = new Set(custom.map((p) => p.id));
	const signals = new Set(custom.map((p) => String(p.signal || '')));
	if (ids.has('stream') || ids.has('cloud')) return ARCHITECTURE_TEMPLATES.data_platform.panes;
	if (ids.has('auth')) return ARCHITECTURE_TEMPLATES.api.panes;
	if (ids.has('account') || (ids.has('config') && ids.has('hosted') && !ids.has('client'))) {
		return ARCHITECTURE_TEMPLATES.deploy.panes;
	}
	if (signals.has('platform_deploy') && !signals.has('invocation')) return ARCHITECTURE_TEMPLATES.deploy.panes;
	return ARCHITECTURE_TEMPLATES.sdk.panes;
}

type Slot = { id: string; label: string; load: boolean; raw: string };

function asSlot(p: ArchitecturePane): Slot {
	return {
		id: p.id,
		label: p.label || p.id,
		load: !!p.load_bearing,
		raw: p.state === 'target' || p.state === 'other' ? p.state : 'none',
	};
}

function toFive(custom: ArchitecturePane[]): Slot[] {
	const panes = custom.filter((p) => p && p.id).slice(0, 5);
	if (panes.length >= 5) return panes.map(asSlot);
	return pickSkeleton(panes).map((slot) => {
		const hit = panes.find((p) => p.id === slot.id || p.signal === slot.signal);
		return hit ? asSlot(hit) : { id: slot.id, label: slot.label, load: !!slot.load_bearing, raw: 'none' };
	});
}

function ragState(layers: LayerMap | undefined, id: string): string {
	let v = String(layers?.[id as keyof LayerMap] || 'none').toLowerCase();
	if (v === 'rocketride') v = 'target';
	return ['target', 'other', 'none'].includes(v) ? v : 'none';
}

/** Glass plate color: load-bearing target = green, other target = blue, else off. */
export function paneTone(raw: string, load: boolean): 'core' | 'rr' | 'off' {
	if (raw !== 'target') return 'off';
	return load ? 'core' : 'rr';
}

/** Original 5-callout layout (spec §10.4): labels track the five plates, stay inside the scene. */
function layoutCallouts(scene: HTMLElement | null) {
	if (!scene) return;
	const svg = scene.querySelector('.leaders');
	if (!svg) return;
	if (window.innerWidth <= 680) {
		svg.innerHTML = '';
		scene.querySelectorAll('.callout').forEach((el) => {
			(el as HTMLElement).style.left = '';
			(el as HTMLElement).style.top = '';
		});
		return;
	}
	const sr = scene.getBoundingClientRect();
	const W = sr.width;
	const H = sr.height;
	const calloutX = Math.max(W - 168, W * 0.52);
	const pad = 22;
	const SVG_NS = 'http://www.w3.org/2000/svg';
	svg.innerHTML = '';
	const els = Array.from({ length: 5 }, (_, i) =>
		scene.querySelector(`.callout[data-ci="${i}"]`) as HTMLElement | null,
	);
	const heights = els.map((el) => Math.max(el?.offsetHeight || 28, 28));
	const leftover = Math.max(0, H - pad * 2 - heights.reduce((s, h) => s + h, 0));
	const gap = leftover / 4;
	let y = pad;
	for (let i = 0; i < 5; i++) {
		const pane = scene.querySelector(`.pane[data-layer="${i}"]`);
		const el = els[i];
		if (!pane || !el) continue;
		const pr = pane.getBoundingClientRect();
		const px = pr.right - sr.left - 8;
		const py = (pr.top + pr.bottom) / 2 - sr.top;
		el.style.left = `${calloutX}px`;
		el.style.top = `${y}px`;
		const ax = calloutX - 6;
		const ay = y + Math.min(12, heights[i] / 2);
		const mx = (px + ax) / 2;
		const line = document.createElementNS(SVG_NS, 'polyline');
		line.setAttribute('points', `${px},${py} ${mx},${py} ${ax},${ay}`);
		line.setAttribute('fill', 'none');
		line.setAttribute('stroke', 'rgba(41,117,221,.45)');
		line.setAttribute('stroke-width', '1');
		svg.appendChild(line);
		const dot = document.createElementNS(SVG_NS, 'circle');
		dot.setAttribute('cx', String(px));
		dot.setAttribute('cy', String(py));
		dot.setAttribute('r', '2.4');
		dot.setAttribute('fill', '#2975DD');
		svg.appendChild(dot);
		y += heights[i] + gap;
	}
}

export default function Tower({ layers, architecture, backbone, label = 'RocketRide' }: {
	layers?: LayerMap;
	architecture?: ArchitecturePane[];
	backbone?: string;
	label?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const custom = (architecture || []).filter((p) => p && p.id);
	const stack: Slot[] = custom.length
		? toFive(custom)
		: RAG.map((r) => ({ id: r.id, label: r.label, load: r.load, raw: ragState(layers, r.id) }));
	const topFirst = [...stack].reverse();
	const sig = topFirst.map((p) => `${p.id}:${p.load}:${p.raw}:${p.label}`).join('|');

	useLayoutEffect(() => {
		const layout = () => layoutCallouts(ref.current);
		layout();
		const id = requestAnimationFrame(layout);
		window.addEventListener('resize', layout);
		return () => {
			cancelAnimationFrame(id);
			window.removeEventListener('resize', layout);
		};
	}, [sig, label, backbone]);

	return (
		<div className="towerblock">
			<div className="readhead">
				<span className="eyebrow">Backbone read</span>
				<span className={`verdict ${backbone || 'No'}`}>{backbone || 'No'}</span>
			</div>
			<div className="scene" ref={ref}>
				<div className="tower">
					{stack.map((p, i) => (
						<div
							key={p.id}
							className={`pane p${i} ${paneTone(p.raw, p.load)}`}
							data-layer={4 - i}
							data-pane={p.id}
						/>
					))}
				</div>
				<svg className="leaders" />
				{topFirst.map((p, ci) => {
					const info = p.raw === 'target'
						? { load: p.load, dot: p.load ? 'dot-core' : 'dot-rr', tech: label }
						: p.raw === 'other'
							? { load: p.load, dot: 'dot-other', tech: 'other platform' }
							: { load: p.load, dot: 'dot-none', tech: 'not present' };
					return (
						<div className="callout" key={p.id} data-ci={ci}>
							<span className={`cdot ${info.dot}`} />
							<div>
								<div className="cname">{p.label}</div>
								<div className="ctech">
									{info.tech}
									{info.load && <span className={`lb ${p.raw === 'target' ? 'on' : 'off'}`}>Load-bearing</span>}
								</div>
							</div>
						</div>
					);
				})}
			</div>
			<div className="key">
				<span><i className="k-core" /> {label} · load-bearing</span>
				<span><i className="k-rr" /> {label}</span>
				<span><i className="k-off" /> not {label}</span>
			</div>
		</div>
	);
}
