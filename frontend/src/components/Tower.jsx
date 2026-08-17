import { useLayoutEffect, useRef } from 'react'

// Backbone tower - port of the Phase-1 5-layer stack (spec §7/§10.4), re-skinned for the
// light liquid-glass theme. Blue = target usage, green glow = load-bearing target usage.
const TOP2BASE = ['output', 'reasoning', 'orchestration', 'retrieval', 'ingest']
const BASE2TOP = ['ingest', 'retrieval', 'orchestration', 'reasoning', 'output']
const LOAD = { reasoning: 1, orchestration: 1 }
const NAMES = {
  output: 'Output / UI', reasoning: 'AI Reasoning', orchestration: 'Orchestration',
  retrieval: 'Retrieval / RAG', ingest: 'Ingest',
}

const norm = (L) => Object.fromEntries(BASE2TOP.map(k => {
  let v = String(L?.[k] || 'none').toLowerCase()
  if (v === 'rocketride') v = 'target'          // legacy sentinel from stored Phase-1 runs
  return [k, ['target', 'other', 'none'].includes(v) ? v : 'none']
}))
const paneState = (key, raw) => raw !== 'target' ? 'off' : (LOAD[key] ? 'core' : 'rr')
const calloutInfo = (key, raw, label) => {
  const load = !!LOAD[key]
  if (raw === 'target') return { load, dot: load ? 'dot-core' : 'dot-rr', tech: label }
  if (raw === 'other') return { load, dot: 'dot-other', tech: 'other platform' }
  return { load, dot: 'dot-none', tech: 'not present' }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function layoutCallouts(scene) {
  if (!scene) return
  const svg = scene.querySelector('.leaders')
  if (!svg) return
  const sr = scene.getBoundingClientRect()
  const calloutX = sr.width - 128, pad = 14, span = sr.height - pad * 2
  svg.innerHTML = ''
  for (let i = 0; i < 5; i++) {
    const pane = scene.querySelector(`.pane[data-layer="${i}"]`)
    const el = scene.querySelector(`.callout[data-ci="${i}"]`)
    if (!pane || !el) continue
    const pr = pane.getBoundingClientRect()
    const px = pr.right - sr.left - 8, py = (pr.top + pr.bottom) / 2 - sr.top
    const cy = pad + span * i / 4
    el.style.left = `${calloutX}px`
    el.style.top = `${cy - 8}px`
    const ax = calloutX - 6, ay = cy + 4, mx = (px + ax) / 2
    const line = document.createElementNS(SVG_NS, 'polyline')
    line.setAttribute('points', `${px},${py} ${mx},${py} ${ax},${ay}`)
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', 'rgba(41,117,221,.45)')
    line.setAttribute('stroke-width', '1')
    svg.appendChild(line)
    const dot = document.createElementNS(SVG_NS, 'circle')
    dot.setAttribute('cx', px); dot.setAttribute('cy', py)
    dot.setAttribute('r', '2.4'); dot.setAttribute('fill', '#2975DD')
    svg.appendChild(dot)
  }
}

export default function Tower({ layers, backbone, label = 'RocketRide' }) {
  const ref = useRef(null)
  const L = norm(layers)
  useLayoutEffect(() => {
    const layout = () => layoutCallouts(ref.current)
    layout()
    window.addEventListener('resize', layout)
    return () => window.removeEventListener('resize', layout)
  })

  return (
    <div style={{ margin: '10px 0 4px' }}>
      <div className="readhead">
        <span className="eyebrow">Backbone read</span>
        <span className={`verdict ${backbone || 'No'}`}>{backbone || 'No'}</span>
      </div>
      <div className="scene" ref={ref}>
        <div className="tower">
          {BASE2TOP.map((k, i) => (
            <div key={k} className={`pane p${i} ${paneState(k, L[k])}`}
                 data-layer={TOP2BASE.indexOf(k)} />
          ))}
        </div>
        <svg className="leaders" />
        {TOP2BASE.map((k, ci) => {
          const info = calloutInfo(k, L[k], label)
          return (
            <div className="callout" key={k} data-ci={ci}>
              <span className={`cdot ${info.dot}`} />
              <div>
                <div className="cname">{NAMES[k]}</div>
                <div className="ctech">{info.tech}</div>
                {info.load && <span className={`lb ${L[k] === 'target' ? 'on' : 'off'}`}>Load-bearing</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="key">
        <span><i className="k-core" /> {label} · load-bearing</span>
        <span><i className="k-rr" /> {label}</span>
        <span><i className="k-off" /> not {label}</span>
      </div>
    </div>
  )
}
