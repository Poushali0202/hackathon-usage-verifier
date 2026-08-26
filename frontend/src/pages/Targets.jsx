import { useEffect, useState } from 'react'
import Shell from '../components/Shell.jsx'
import { ProModal } from '../components/bits.jsx'
import { listTargets, createTarget, updateTarget, deleteTarget, extractTarget, testTarget } from '../api.js'
import { TagPill } from '../components/bits.jsx'
import { getPlan } from '../store.js'

const TYPES = [['code', '⌨ Code SDK / library'], ['platform', '☁ Platform / deployment'], ['api', '🔌 API / service']]

const CODE_FIELDS = [
  ['dependency_names', 'Package / dependency names', 'found in project manifests', 'e.g. yourlib, @you/sdk'],
  ['artifacts', 'Product artifacts', 'files that represent work built with the product', 'e.g. *.pipe, config JSON shape'],
  ['invocation', 'Usage patterns', 'how code actually calls the product', 'e.g. client.run | YourClient'],
  ['hosted_markers', 'API & environment markers', 'env keys, API hosts', 'e.g. YOURLIB_*, api.you.dev'],
  ['cli_verbs', 'CLI commands', '', 'e.g. yourlib deploy'],
  ['competitors', 'Competing products', 'presence demotes "backbone"', 'e.g. rival-sdk'],
  ['neutral', 'Neutral tools', 'never demote', 'e.g. supabase, firebase'],
]
// generic-engine rubric: keys must match eval/target.py GENERIC_WEIGHTS / GENERIC_THRESHOLDS
const RUBRIC_WEIGHTS = [
  ['dependency', 'Installed your package', 1.0,
   'Your SDK is listed in their manifest. Proves install, not use. Raise if install alone matters to you.'],
  ['invocation', 'Calls it in code (3+ places)', 1.5,
   'Their code invokes your SDK at least 3 times. The core proof of real use. Raise for SDK-first products.'],
  ['invocation_deep', 'Uses it everywhere (8+ places)', 1.0,
   'Bonus when calls run through the whole codebase instead of one demo file.'],
  ['api_usage', 'Hits your API at runtime', 1.5,
   'Live calls to your API hosts, with or without the SDK. Raise for API-first products.'],
  ['hosted', 'Configured your keys', 0.5,
   'Your env vars / API keys are wired up. Setup is not usage, so this stays small.'],
  ['file_spread', 'Present in 2+ files', 0.5,
   'Your product appears across files, not in a single pasted example.'],
  ['artifact', 'Committed your config files', 1.0,
   'Files your tooling writes (a dotfolder, an ignore file) are checked into their repo.'],
  ['platform_deploy', 'Shipped on your platform', 1.5,
   'A live deployment on your domains. Raise heavily if "they launched on us" is the point.'],
]
const RUBRIC_THRESHOLDS = [
  ['significant', 'Significant', 4.0],
  ['moderate', 'Moderate', 2.0],
  ['less', 'Less', 1.0],
]
// strictness presets move the BAR (thresholds); weights stay whatever you set - the two
// questions "what counts as proof" and "how high is the bar" are kept independent
const STRICTNESS = {
  lenient: { label: 'Lenient', thresholds: { significant: 3, moderate: 1.5, less: 0.5 } },
  balanced: { label: 'Balanced (default)', thresholds: { significant: 4, moderate: 2, less: 1 } },
  strict: { label: 'Strict', thresholds: { significant: 5.5, moderate: 3, less: 1.5 } },
}

const PLATFORM_FIELDS = [
  ['platform_domains', 'Platform domains & deploy URLs', 'links found in code or README', 'e.g. *.yourplatform.app'],
  ['platform_files', 'Deployment / config files', 'files that only exist when the platform is used', 'e.g. yourplatform.yaml'],
  ['platform_markers', 'Account & workspace markers', 'env keys, tokens, project ids', 'e.g. YOURPLATFORM_TOKEN'],
  ['platform_badges', 'README & badge evidence', 'claims backed by links/badges', 'e.g. "Deployed on ..." badge'],
]

export default function Targets() {
  const [targets, setTargets] = useState(null)
  const [sel, setSel] = useState(null)          // selected target object, or {isNew:true}
  const [form, setForm] = useState({})          // editable copy: {name, types, ...config}
  const [tab, setTab] = useState('code')
  const [pro, setPro] = useState(false)
  const isPro = getPlan() === 'pro'
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  // "Prefill" assist (repo URL / docs URL / package name / uploaded files)
  const [xUrl, setXUrl] = useState('')
  const [xDocs, setXDocs] = useState('')
  const [xPkg, setXPkg] = useState('')
  const [xFiles, setXFiles] = useState([])
  const [xBusy, setXBusy] = useState(false)
  const [xInfo, setXInfo] = useState(null)      // {repo, warnings, suggestions}
  // "Test on a sample repo" loop
  const [tUrl, setTUrl] = useState('')
  const [tBusy, setTBusy] = useState(false)
  const [tRes, setTRes] = useState(null)
  const [tCloud, setTCloud] = useState(false)   // run the engine inside the RocketRide pipeline

  const load = () => listTargets().then(ts => {
    setTargets(ts)
    const cur = sel && ts.find(t => t.id === sel.id)
    pick(cur || ts[0])
  }).catch(e => setMsg(`API unreachable: ${e.message}`))
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function pick(t) {
    if (!t) return
    setSel(t)
    setForm({ name: t.name, types: t.config.types || ['code'], ...t.config })
    setMsg(null)
  }
  function startNew() {
    setSel({ isNew: true })
    setForm({ name: '', types: ['code'] })
    setTab('code')
    setMsg(null)
  }

  const readOnly = !!sel?.is_preset
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleType = (k) => !readOnly &&
    set('types', form.types?.includes(k) ? form.types.filter(x => x !== k) : [...(form.types || []), k])

  async function save() {
    if (!form.name?.trim()) { setMsg('Give the target a name.'); return }
    setBusy(true); setMsg(null)
    const { name, ...config } = form
    try {
      if (sel?.isNew) await createTarget(name, config)
      else await updateTarget(sel.id, name, config)
      await load()                       // reload FIRST - pick() clears msg, so set it after
      setMsg('Saved ✓ - this target is live for new runs')
      setTimeout(() => setMsg(m => (m?.startsWith('Saved') ? null : m)), 3500)
    } catch (e) { setMsg(String(e.message || e)) }
    setBusy(false)
  }
  async function remove() {
    setBusy(true)
    try { await deleteTarget(sel.id); setSel(null); await load() }
    catch (e) { setMsg(String(e.message || e)) }
    setBusy(false)
  }

  const hasSource = xUrl.includes('github.com') || xDocs.trim() || xPkg.trim() || xFiles.length > 0

  async function prefill() {
    setXBusy(true); setXInfo(null); setMsg(null)
    try {
      const res = await extractTarget({
        githubUrl: xUrl.trim() || null, docsUrl: xDocs.trim() || null,
        pkg: xPkg.trim() || null, files: xFiles,
      })
      const c = res.config || {}
      setForm(f => ({
        ...f,
        name: f.name?.trim() ? f.name : (c.name || f.name),
        types: c.types?.length ? c.types : f.types,
        ...Object.fromEntries(
          ['dependency_names', 'artifacts', 'invocation', 'hosted_markers', 'cli_verbs',
           'platform_domains', 'platform_files', 'platform_markers']
            .filter(k => c[k]).map(k => [k, c[k]])),
      }))
      setXInfo({ repo: res.repo, warnings: res.warnings || [], suggestions: res.suggestions || {} })
    } catch (e) { setMsg(String(e.message || e)) }
    setXBusy(false)
  }

  // chips toggle: click adds the token to the field below, click again removes it
  const hasSuggestion = (field, value) =>
    (form[field] || '').split(',').map(s => s.trim().toLowerCase()).includes(value.toLowerCase())
  const addSuggestion = (field, value) => {
    const items = (form[field] || '').split(',').map(s => s.trim()).filter(Boolean)
    const i = items.findIndex(x => x.toLowerCase() === value.toLowerCase())
    if (i >= 0) items.splice(i, 1); else items.push(value)
    set(field, items.join(', '))
  }

  async function runTest() {
    setTBusy(true); setTRes(null)
    try {
      const { name, ...config } = form
      setTRes(await testTarget(tUrl.trim(), name || 'Target', config, tCloud ? 'cloud' : 'local'))
    } catch (e) { setTRes({ error: String(e.message || e) }) }
    setTBusy(false)
  }

  const Field = ([key, label, hint, ph]) => (
    <div className="field" key={key}>
      <label>{label} {hint && <span className="muted">({hint})</span>}</label>
      <input type="text" value={form[key] || ''} placeholder={ph} readOnly={readOnly}
             onChange={e => set(key, e.target.value)} />
    </div>
  )

  return (
    <Shell title="Targets">
      <p className="muted" style={{ margin: '-8px 0 18px', fontSize: 13 }}>
        A <b>target</b> describes the product teams are judged on - it's the question every
        check asks. Your org's targets are stored server-side; one custom target is included
        in Free.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, maxWidth: 820 }}>
        {(targets || []).map(t => (
          <button key={t.id} className={`btn sm ${sel?.id === t.id ? '' : 'ghost'}`} onClick={() => pick(t)}>
            {t.name}{t.is_preset ? ' (preset)' : ''}
          </button>
        ))}
        <button className="btn ghost sm" onClick={startNew}>+ New target</button>
      </div>

      <div className="glass" style={{ padding: 24, maxWidth: 820 }}>
        {!readOnly && (
          <div className="altpath" style={{ marginTop: 0, marginBottom: 18 }}>
            <span className="altico">✨</span>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13 }}>Prefill from the product's public surface</b>
              <div className="help" style={{ marginTop: 2 }}>Any combination works - repo,
                docs site, package name, or files (manifest, README, .env.example, API spec).
                Only signals verified in the provided material are filled.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <input className="xin" type="text" placeholder="repo: https://github.com/vendor/product"
                       value={xUrl} onChange={e => setXUrl(e.target.value)} />
                <input className="xin" type="text" placeholder="docs: https://docs.product.com"
                       value={xDocs} onChange={e => setXDocs(e.target.value)} />
                <input className="xin" type="text" placeholder="package: @vendor/sdk or product-name"
                       value={xPkg} onChange={e => setXPkg(e.target.value)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <label className="btn ghost sm" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    📎 {xFiles.length ? `${xFiles.length} file(s)` : 'Attach files'}
                    <input type="file" multiple hidden
                           accept=".json,.toml,.md,.txt,.yaml,.yml,.example,.sample,.py,.ts,.js,.env"
                           onChange={e => setXFiles([...e.target.files])} />
                  </label>
                  <button className="btn sm" style={{ flex: 1 }} disabled={xBusy || !hasSource}
                          onClick={prefill}>{xBusy ? 'Extracting…' : 'Prefill'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {xInfo && (
          <div className="detailbox" style={{ fontSize: 12.5, marginBottom: 16 }}>
            <b>Extracted from {xInfo.repo}</b> - review before saving.
            {(xInfo.suggestions.competitors || xInfo.suggestions.neutral) && (
              <div style={{ marginTop: 6 }}>
                {xInfo.suggestions.competitors && (
                  <div>Suggested competitors (not verified, click to add):{' '}
                    {xInfo.suggestions.competitors.split(',').map(s => s.trim()).filter(Boolean).map(s => (
                      <button key={s} type="button"
                              className={`techchip${hasSuggestion('competitors', s) ? ' target' : ''}`}
                              style={{ cursor: 'pointer' }}
                              title={hasSuggestion('competitors', s) ? 'Added to Competing products - click to remove' : 'Add to Competing products'}
                              onClick={() => addSuggestion('competitors', s)}>
                        {hasSuggestion('competitors', s) ? '✓ ' : ''}{s}</button>
                    ))}</div>
                )}
                {xInfo.suggestions.neutral && (
                  <div style={{ marginTop: 4 }}>Suggested neutral tools:{' '}
                    {xInfo.suggestions.neutral.split(',').map(s => s.trim()).filter(Boolean).map(s => (
                      <button key={s} type="button"
                              className={`techchip${hasSuggestion('neutral', s) ? ' target' : ''}`}
                              style={{ cursor: 'pointer' }}
                              title={hasSuggestion('neutral', s) ? 'Added to Neutral tools - click to remove' : 'Add to Neutral tools'}
                              onClick={() => addSuggestion('neutral', s)}>
                        {hasSuggestion('neutral', s) ? '✓ ' : ''}{s}</button>
                    ))}</div>
                )}
              </div>
            )}
            {xInfo.warnings.length > 0 && (
              <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
                {xInfo.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
          </div>
        )}
        <div className="field" style={{ maxWidth: 340 }}>
          <label>Target name</label>
          <input type="text" value={form.name || ''} placeholder="e.g. Butterbase" readOnly={readOnly}
                 onChange={e => set('name', e.target.value)} />
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>How do teams use this product?</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            {TYPES.map(([k, l]) => (
              <span key={k} onClick={() => toggleType(k)} className="pill" style={{
                padding: '7px 14px', cursor: readOnly ? 'default' : 'pointer', fontWeight: 700, fontSize: 12.5,
                background: form.types?.includes(k) ? 'var(--navy)' : 'rgba(255,255,255,.6)',
                color: form.types?.includes(k) ? '#FAFBF8' : 'var(--muted)',
                border: '1.5px solid ' + (form.types?.includes(k) ? 'var(--navy)' : 'var(--bd)'),
              }}>{l}</span>
            ))}
          </div>
          <div className="help">Each type enables its own group of checks below.</div>
        </div>

        <div className="tabs">
          <button className={`tabbtn ${tab === 'code' ? 'cur' : ''}`} onClick={() => setTab('code')}>Code signals</button>
          <button className={`tabbtn ${tab === 'platform' ? 'cur' : ''}`} onClick={() => setTab('platform')}>Platform &amp; deployment signals</button>
          <button className={`tabbtn ${tab === 'rubric' ? 'cur' : isPro ? '' : 'locked'}`}
                  onClick={() => (isPro ? setTab('rubric') : setPro(true))}>
            Rubric &amp; weights{isPro ? '' : ' 🔒 PRO'}</button>
        </div>

        {tab === 'code' && (
          <div>
            {CODE_FIELDS.slice(0, 3).map(Field)}
            <div className="inline">{CODE_FIELDS.slice(3, 5).map(Field)}</div>
            <div className="inline">{CODE_FIELDS.slice(5, 7).map(Field)}</div>
          </div>
        )}
        {tab === 'platform' && (
          <div>
            <div className="detailbox" style={{ fontSize: 12.5 }}>
              For products that are <b>platforms or deployment tools</b>, usage may not appear
              as code at all. Detection depth is being expanded (M3b research).
            </div>
            {PLATFORM_FIELDS.map(Field)}
          </div>
        )}
        {tab === 'rubric' && (
          readOnly ? (
            <div className="detailbox" style={{ fontSize: 12.5 }}>
              The RocketRide preset scores with the fixed, battle-tested rubric from
              SCORING_SPEC - its weights are not editable. Custom targets get a fully
              tunable rubric here.
            </div>
          ) : (
            <div>
              <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 12px' }}>
                Every signal the engine finds adds its points; the total decides the tag.
                Pick a strictness, fine-tune if needed, then confirm with "Test on a sample
                repo" below.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 6px' }}>
                <span className="eyebrow" style={{ marginRight: 4 }}>Judging strictness</span>
                {Object.entries(STRICTNESS).map(([key, p]) => {
                  const active = RUBRIC_THRESHOLDS.every(([k, , dflt]) =>
                    Number(form.thresholds?.[k] ?? dflt) === p.thresholds[k])
                  return (
                    <button key={key} className={`btn sm ${active ? '' : 'ghost'}`}
                            onClick={() => setForm(f => ({ ...f, thresholds: { ...p.thresholds } }))}>
                      {p.label}</button>
                  )
                })}
                <button className="btn ghost sm" style={{ marginLeft: 'auto' }}
                        title="Restore all weights and cut-offs to the calibrated defaults"
                        onClick={() => setForm(f => { const { weights, thresholds, ...rest } = f; return rest })}>
                  ↺ Reset to defaults</button>
              </div>

              <div className="eyebrow" style={{ margin: '12px 0 2px' }}>Signal weights</div>
              <div>
                {RUBRIC_WEIGHTS.map(([k, label, dflt, desc]) => {
                  const val = form.weights?.[k] ?? dflt
                  const changed = Number(val) !== dflt
                  return (
                    <div className="rrow" key={k}>
                      <div className="rl">
                        <b>{label}</b>
                        <div className="rd">{desc}</div>
                      </div>
                      {changed && (
                        <button className="rrev" title={`Back to default (${dflt})`}
                                onClick={() => setForm(f => ({ ...f, weights: { ...(f.weights || {}), [k]: dflt } }))}>↺</button>
                      )}
                      <input className="rnum" type="number" min="0" step="0.5" value={val}
                             onChange={e => setForm(f => ({ ...f, weights: { ...(f.weights || {}), [k]: e.target.value } }))} />
                      <span className="rpts">pts</span>
                    </div>
                  )
                })}
              </div>

              <div className="eyebrow" style={{ margin: '14px 0 2px' }}>Tag cut-offs
                <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}> (score needed)</span></div>
              <div className="rthres">
                {RUBRIC_THRESHOLDS.map(([k, label, dflt]) => {
                  const val = form.thresholds?.[k] ?? dflt
                  const changed = Number(val) !== dflt
                  return (
                    <span className="titem" key={k}>
                      <TagPill tag={label} />
                      <span className="rpts" style={{ width: 'auto' }}>≥</span>
                      <input className="rnum" type="number" min="0" step="0.5" value={val}
                             onChange={e => setForm(f => ({ ...f, thresholds: { ...(f.thresholds || {}), [k]: e.target.value } }))} />
                      {changed && (
                        <button className="rrev" title={`Back to default (${dflt})`}
                                onClick={() => setForm(f => ({ ...f, thresholds: { ...(f.thresholds || {}), [k]: dflt } }))}>↺</button>
                      )}
                    </span>
                  )
                })}
              </div>
              {(() => {
                const wv = (k, d) => { const v = parseFloat(form.weights?.[k]); return Number.isFinite(v) ? v : d }
                const tv = (k, d) => { const v = parseFloat(form.thresholds?.[k]); return Number.isFinite(v) ? v : d }
                const typical = wv('dependency', 1) + wv('invocation', 1.5) + wv('api_usage', 1.5) + wv('hosted', .5)
                const sig = tv('significant', 4); const mod = tv('moderate', 2); const less = tv('less', 1)
                const tag = typical >= sig ? 'Significant' : typical >= mod ? 'Moderate' : typical >= less ? 'Less' : 'None'
                return (
                  <div className="livecall" style={{ marginTop: 4 }}>
                    <span className="altico">∑</span>
                    <div style={{ fontSize: 12.5 }}>
                      With these values, a typical genuine project (dependency + regular
                      call-sites + runtime API usage + env wiring) scores{' '}
                      <b className="scorecell">{typical.toFixed(1)}</b> →{' '}
                      <TagPill tag={tag} />{tag === 'None' || tag === 'Less'
                        ? ' - that bar is likely too high for real projects to clear.' : ''}
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
          {msg && <span className={/✓/.test(msg) ? undefined : 'flagcell'}
                        style={{ fontSize: 12.5, ...(/✓/.test(msg) ? { color: 'var(--green-strong)', fontWeight: 700 } : {}) }}>{msg}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {!readOnly && !sel?.isNew && sel &&
              <button className="btn ghost sm" disabled={busy} onClick={remove}>Delete</button>}
            {!readOnly &&
              <button className="btn sm" disabled={busy} onClick={save}>
                {sel?.isNew ? 'Create target' : 'Save target'}
              </button>}
          </span>
        </div>

        {!readOnly && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--bd-subtle)' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Test on a sample repo</div>
            <div className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              Paste a repo you KNOW used this product - if the checks fire, the definition
              detects. Deterministic only, takes seconds.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="xin" style={{ flex: 1 }} type="text"
                     placeholder="https://github.com/known-consumer/project"
                     value={tUrl} onChange={e => setTUrl(e.target.value)} />
              <button className="btn ghost sm" disabled={tBusy || !tUrl.includes('github.com')}
                      onClick={runTest}>{tBusy ? 'Testing…' : '⚙ Test'}</button>
            </div>
            <label className="help" style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={tCloud} onChange={e => setTCloud(e.target.checked)} />
              ☁ Run the engine inside the RocketRide Cloud pipeline (needs a deployed instance;
              falls back to local)
            </label>
            {tRes && (
              <div className="detailbox" style={{ marginTop: 10, fontSize: 12.5 }}>
                {tRes.error ? <span className="flagcell">{tRes.error}</span> : (
                  <>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <TagPill tag={tRes.tag} />
                      <b className="scorecell">{Number(tRes.score).toFixed(1)}</b>
                      <span className="muted">backbone {tRes.backbone}</span>
                      {tRes.engine_used && (
                        <span className={`techchip ${tRes.engine_used === 'rocketride-node' ? 'target' : ''}`}
                              style={{ margin: 0 }}>
                          {tRes.engine_used === 'rocketride-node' ? '☁ ran on RocketRide' : tRes.engine_used}
                        </span>
                      )}
                    </span>
                    <div style={{ marginTop: 8 }}>
                      {(tRes.breakdown || []).length === 0
                        ? <span className="flagcell">No signals fired - this definition does not
                            detect that repo. Check dependency names and invocation patterns.</span>
                        : (tRes.breakdown || []).map((b, i) => (
                            <span key={i} className={`bdchip ${b.points < 0 ? 'neg' : 'pos'}`}>
                              {b.points > 0 ? '+' : ''}{b.points} {b.signal}</span>
                          ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          {readOnly
            ? 'The RocketRide preset is read-only - it mirrors the engine\'s pipeline-scoring path.'
            : 'Saved per-organization and live: picking this target in a run makes every check (dependency, invocation, API usage, artifacts, deploy domains) verify against it.'}
        </p>
      </div>

      <ProModal open={pro} onClose={() => setPro(false)} title="Custom rubric is a Pro feature">
        <p>The Free plan scores with the default, battle-tested rubric. <b>Pro</b> lets you tune
          the weights, tag thresholds and labels your judges score against.</p>
      </ProModal>
    </Shell>
  )
}
