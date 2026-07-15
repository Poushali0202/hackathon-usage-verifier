# Glass Strata UI — Design Spec & Wiring Guide

**For:** the agent wiring this into the existing Hackathon Usage Verifier web app
(`app/main.py`, `app/verifier_service.py`, `app/static/index.html`, `run_batch.py`).
**Scope:** replace the current `app/static/index.html` front-end with the **Glass Strata** UI, plus
**one additive backend change** (a `layers` field on the classifier output). Nothing else about the
pipeline changes. The Excel output and both existing endpoints stay as they are.

**Status of the repo right now:** unchanged. This document was produced in a design-only channel; no
code was committed. The backend snippets in §6 are *proposed* edits for you to apply deliberately.

**Interactive prototypes (visual source of truth):**
- Final approved UI (batch view + detail + Option‑B tower + info architecture): https://claude.ai/code/artifact/844d7fb7-27ec-4359-86b8-bba92ed7a20a
- Tower‑label A/B comparison (why we chose Option B): https://claude.ai/code/artifact/ec340861-665c-4c86-b3e3-cfe12bf08775
- Liquid‑glass concept set (incl. the original Strata idea): https://claude.ai/code/artifact/2e5917aa-fe8d-4498-abf0-2470b2be793d

> The prototypes use **representative sample data**. Wire the real endpoints (§5) and the real `layers`
> field (§6). Two mockup fields are *not real* and must be dropped/replaced — see §9.

---

## 1. The design direction

**Glass Strata** — a committed **dark, liquid‑glass** interface. The signature idea: the tool's most
important verdict, *"Is RocketRide the backbone?"*, is answered by looking **through a stack of glass
layers**. Each project's architecture is drawn as five stacked glass panes; the RocketRide‑powered
layers glow. If the two **load‑bearing** panes (orchestration + reasoning) light up gold, the spine is
intact and the backbone is **Yes**.

Design principles that must survive implementation:
- **Committed dark.** This is a deliberate single‑world choice (you don't read an x‑ray on white). Do
  not add a light theme; the current app's light mode is intentionally dropped.
- **Meaning encoded in form.** Gold = RocketRide on a load‑bearing layer; teal = RocketRide elsewhere;
  faint = not RocketRide. Colour carries the verdict, not just decoration.
- **The local → cloud hand‑off stays visible** (it's the app's core story) — keep the Pipeline A → B →
  Output ribbon and the per‑repo fetch → classify staging.

---

## 2. Information architecture — three tiers

Project data is **layered**, so the 40+‑repo wall stays scannable while nothing is lost:

| Tier | Surface | Shows |
|---|---|---|
| **Triage** | mini‑strata **card** (always visible) | name · the backbone glyph · tag · backbone · tiny GH/VID/URL link flags |
| **Peek** | **hover** a card | one‑line project description (native `title` tooltip is fine) |
| **Record** | **detail panel** (on click) | the full dossier = every column of the exported Excel (§8) + the labelled backbone tower |

---

## 3. Screen layout & the 40‑repo scaling model

```
┌───────────────────────────────────────────────────────────────────┐
│ APP BAR   Usage Verifier   [ Live | Batch ]      progress · elapsed │
├───────────────────────────────────────────────────────────────────┤
│ SUB BAR   counts (Backbone Yes/Partial/No · Needs review)  filters  │
├──────────────────────────────────┬────────────────────────────────┤
│  MINI‑STRATA GRID (scrollable)    │  DETAIL PANEL (sticky)          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐      │  Project · Team · Tag           │
│  │glyph│ │glyph│ │busy│ │rev.│    │  Links: GitHub · Demo · Deployed│
│  └────┘ └────┘ └────┘ └────┘      │  Description                    │
│  … one card per repo …            │  How RocketRide helped          │
│                                   │  BACKBONE READ  (Option‑B tower)│
│                                   │  Why this classification        │
│                                   │  Additional notes               │
└──────────────────────────────────┴────────────────────────────────┘
  Architecture ribbon (Pipeline A · Local  →  Pipeline B · Cloud  →  Output) sits above the workspace.
```

- **Overview + detail.** The grid is the primary scan surface; clicking a card fills the sticky detail
  panel. This is the answer to "how do 40+ repos fit under a 15‑minute SLA" — you scan glyphs, filter,
  and only drill when needed.
- **Streaming.** Cards appear as the NDJSON stream arrives. A repo is a **busy** card (skeleton +
  "classifying…") during fetch/classify, then becomes a finished glyph on its `result` event. Both
  **Live** and **Batch** stream the *same* events into the *same* grid.
- **Two special card states:**
  - **busy** — while streaming, before the result arrives (shimmer skeleton).
  - **needs‑review** — an inaccessible/failed repo (dashed border, "inaccessible", no glyph). Detect via
    `repo_accessible !== true || classify_failed` (requires the §6 `_public` additions).
- **Detail column width matters.** Option‑B callouts need room beside the tower — widen the detail
  column (prototype uses workspace `grid-template-columns: 1.2fr 1fr` and app `min-width: 960px`).

---

## 4. Component specs

### 4.1 Mini‑strata card (grid)
- **Content:** repo name; the 5‑pane **spine glyph** (see §7); tag pill; `BB <Yes|Partial|No>`; a row of
  tiny `GH / VID / URL` flags (lit when that link exists).
- **Glyph:** five thin slabs stacked base→top (`flex-direction: column-reverse`), coloured by layer state
  (`core`=gold glow, `rr`=teal, `off`=faint). A short **gold bracket** runs beside the two load‑bearing
  slabs so "the spine" is obvious.
- **States:** default · hover (lift + `title` peek) · selected (cyan ring) · busy (skeleton) ·
  needs‑review (dashed).
- **Behaviour:** click / Enter / Space → select into detail. `role="button"`, `tabindex="0"`, visible
  focus ring.

### 4.2 Detail panel (the record)
Sticky, scrolls internally if long. Sections top→bottom (each maps to an Excel column, §8):
1. **Header** — project name · team (`names` / `emails`) · tag pill.
2. **Links** — GitHub / Demo‑Video / Deployed as buttons; greyed "No demo / Not deployed" when absent.
3. **Project description** — `description`.
4. **How RocketRide was used & how it helped** — `rocketride_usage`.
5. **Backbone read** — the **Option‑B tower** (§4.3).
6. *(optional)* **Evidence handed to Cloud** — the `stage.classify` digest + `evidence[]` chips (nice for
   the hand‑off story; keep if space allows).
7. **Why this classification** — `justification`.
8. **Additional notes** — `notes`.

### 4.3 Backbone Read tower — **Option B (leader‑line callouts)** — FINAL
This is the finalised treatment (we compared it head‑to‑head against a plain legend and chose B because
its meaning reads at a glance). See the comparison prototype above.

- A 3D glass tower of 5 panes; **each pane is labelled by a callout pinned beside it with a leader
  line**, not by text baked on the tilted pane (that was illegible — the reason we redesigned).
- Callout content per layer: colour **dot** (gold/teal/neutral/faint) · layer **name** · a tech line
  (`RocketRide` / `other platform` / `not present`) · a gold **"Load‑bearing"** badge on
  orchestration + reasoning.
- A compact 3‑item **colour key** sits under the tower (RocketRide load‑bearing · RocketRide · not
  RocketRide).
- **The leaders are computed live** against each pane's real on‑screen box (after the 3D transform) and
  **must be recomputed on every repo select and on window resize** — see the algorithm in §10.4.

### 4.4 Filters & counts
- **Counts:** Backbone `Yes` / `Partial` / `No` + `Needs review`, derived from results as they stream.
- **Filters:** `All` · `Backbone Yes` · `Partial` · `Needs review` — show/hide cards by a `data-group`
  attribute. Group = `review` (inaccessible/failed) → else by backbone (`yes`/`part`/`no`).

### 4.5 Progress / SLA / elapsed
- Show `X / N classified` (from `start.total` and `result` events) + a progress bar + **elapsed timer**.
- The mockup's "SLA 02:47 countdown" was a **visual flourish, not real data** — replace with an honest
  count‑up elapsed timer (optionally against a static 15:00 target label). Do **not** fake a countdown.

### 4.6 Excel download
- On the `done` event, if `download` is set, show a **Download Excel** button linking to it
  (`/api/download/{job}`). This is the tool's headline output — always surface it in Batch, and in Live
  too (the backend builds a sheet for both). Same styled 11‑column workbook as today.

### 4.7 Inputs
- **Live tab:** textarea of GitHub URLs (one per line) + Run. POST body `{repos:[{github:url}]}`.
- **Batch tab:** file input (`.csv/.xlsx/.xls`) + Run. `multipart/form-data`, field name **`file`**.

---

## 5. Data contract (existing backend — do not change except §6)

**Endpoints** (`app/main.py`):

| Method · Path | Accepts | Returns |
|---|---|---|
| `GET /` | — | the HTML page (`static/index.html`) |
| `POST /api/verify/stream` | JSON `{repos:[{github, project?, feedback?, demo?, deployed?}]}` | **NDJSON** stream |
| `POST /api/batch` | `multipart/form-data`, field **`file`** | **NDJSON** stream |
| `GET /api/download/{job}` | path `job` | `FileResponse` → `RocketRide_Hackathon_Usage.xlsx` |
| `GET /api/health` | — | `{ok:true, classifier_ready:bool}` |

**NDJSON events** (one JSON object per `\n`‑terminated line; read with a `fetch` + `ReadableStream`
reader, *not* EventSource — the current file already does this and it works):

```jsonc
{"event":"start","total": <int>}

{"event":"stage","index":<1-based>,"stage":"fetch","engine":"local",
 "project":<str>,"message":"Fetching GitHub evidence — local Pipeline A"}

{"event":"stage","index":<1-based>,"stage":"classify","engine":"cloud",
 "project":<str>,"message":"Classifying on RocketRide Cloud — Pipeline B",
 "digest":{ "accessible":bool, "file_count":int, "pipe_files":[..],
            "rocketride_dependencies":[..], "source_signals":[..], "other_platforms":[..] }}

{"event":"result","index":<int>,"total":<int>,"result":{ ...public result (below)... }}

{"event":"done","count":<int>,"download":"/api/download/<job>"|null,
 "summary":{"tags":{<tag>:<count>}, "backbone":{<verdict>:<count>}}}
```

**Public result object** (today, from `_public()`), all **snake_case**:

```
project, github, tag, backbone, description, rocketride_usage,
justification, notes, evidence[], seconds, demo, deployed
```

- `tag ∈ {Significant, Moderate, Less, None}`
- `backbone ∈ {Yes, Partial, No}`
- `seconds` = classify time (use this instead of the mockup's fake "confidence").

After the §6 change, the result additionally carries: **`layers`**, `names`, `emails`,
`repo_accessible`, `classify_failed`.

---

## 6. Backend change required — the `layers` field (additive)

**Why:** the classifier currently returns only a flat `tag` + `backbone` + `justification`. The Glass
Strata tower needs a **per‑layer** breakdown, and the tool's ethos is "evidence‑based, never fabricated"
— so the layer map must come from the classifier reasoning over the same evidence, not a UI guess. We
chose **"extend the classifier"** over deriving it heuristically.

### 6a. `run_batch.py` — add `layers` to the `RUBRIC` schema

Insert this block **immediately before** the `"Output ONLY one strict JSON object …"` line:

```python
    "ARCHITECTURE LAYERS. Also decompose the project into five architectural layers and say what "
    "powers each, so a reviewer can see WHERE RocketRide sits:\n"
    " - ingest: how source data/content enters (upload, fetch, webhook, connectors).\n"
    " - retrieval: RAG / vector search / knowledge lookup (or 'none' if the project has none).\n"
    " - orchestration: what sequences the steps and runs the pipeline / agent logic.\n"
    " - reasoning: what makes the LLM / model calls (the AI engine).\n"
    " - output: how results are delivered (UI, API, file, message).\n"
    "For EACH layer emit exactly one of: 'rocketride' (RocketRide powers this layer), 'other' (a "
    "non-RocketRide tool powers it), or 'none' (the project has no such layer). orchestration and "
    "reasoning are the LOAD-BEARING layers and MUST stay consistent with backbone: backbone 'Yes' "
    "requires BOTH orchestration and reasoning = 'rocketride'; 'Partial' = exactly ONE of them "
    "'rocketride'; 'No' = neither.\n\n"
```

And add `layers` to the JSON key list (in the same `RUBRIC`, right after the `justification (…)`
clause and before `notes (…)`):

```python
    "layers (an object with EXACTLY the keys ingest, retrieval, orchestration, reasoning, output — "
    "each set to 'rocketride', 'other', or 'none' as defined above), "
```

`verify_usage.pipe` has no schema of its own (it's a `chat → llm_anthropic → response_answers`
passthrough), so **no `.pipe` change is needed** — the whole contract lives in `RUBRIC`.

### 6b. `app/main.py` — expose `layers` (+ team + status), with a safe fallback

`verifier_service.verify_row` already merges `{**row, **parsed}`, so `layers` flows through
automatically once the classifier emits it. Only `_public()` needs widening. Replace it with:

```python
_LAYER_KEYS = ("ingest", "retrieval", "orchestration", "reasoning", "output")
_LAYER_VALUES = {"rocketride", "other", "none"}


def _layers_from_backbone(backbone) -> dict:
    """Fallback layer map when the classifier didn't emit one — keep the load-bearing
    spine consistent with the backbone verdict so the UI tower never lies."""
    bb = backbone.strip().lower() if isinstance(backbone, str) else ""
    if bb == "yes":
        orch, reason = "rocketride", "rocketride"
    elif bb == "partial":
        orch, reason = "rocketride", "other"          # one load-bearing pillar
    else:
        orch, reason = "none", "none"
    return {"ingest": "none", "retrieval": "none",
            "orchestration": orch, "reasoning": reason, "output": "none"}


def _layers(r: dict) -> dict:
    """Normalise the classifier's layer map to exactly 5 keys / 3 values, falling back to a
    backbone-derived spine for any missing or invalid value."""
    raw = r.get("layers")
    derived = _layers_from_backbone(r.get("backbone"))
    if not isinstance(raw, dict):
        return derived
    return {k: (v if (v := str(raw.get(k, "")).strip().lower()) in _LAYER_VALUES else derived[k])
            for k in _LAYER_KEYS}


def _public(r: dict) -> dict:
    """Trim a result to the fields the UI renders (all snake_case, matching the wire)."""
    out = {k: r.get(k) for k in (
        "project", "github", "tag", "backbone", "description", "rocketride_usage",
        "justification", "notes", "evidence", "seconds", "demo", "deployed",
        "names", "emails", "repo_accessible", "classify_failed")}
    out["layers"] = _layers(r)
    return out
```

The fallback means: **if `layers` is ever missing or malformed** (old response, parse hiccup, the
short‑circuit paths for no‑repo/404/incomplete), the UI still gets a valid 5‑key object whose spine
agrees with `backbone`. The tower degrades gracefully instead of breaking.

### 6c. Excel — no change required
The workbook stays at its **11 columns**. `layers` is a UI concept. (Optional future: a 12th "Layer
map" column in `run_batch.write_sheet` — not needed for this UI.)

---

## 7. Layer → visual mapping (the heart of the UI)

`layers` = `{ ingest, retrieval, orchestration, reasoning, output }`, each `rocketride | other | none`.

- **Order, top → base:** `Output/UI · AI Reasoning · Orchestration · Retrieval/RAG · Ingest`.
- **Load‑bearing (the spine):** `orchestration` + `reasoning`.
- **Pane / slab state:**
  - a **load‑bearing** layer that is `rocketride` → **`core`** (gold glow)
  - any **other** layer that is `rocketride` → **`rr`** (teal)
  - anything else (`other` or `none`) → **`off`** (faint)
- **Backbone reads from the spine:** both core panes gold → **Yes**; one → **Partial**; none → **No**.
  (`backbone` from the result is authoritative for the verdict text; the tower is driven by `layers`,
  which the classifier is instructed to keep consistent.)
- **Callout dot + tech line** use the *raw* value so `other` is distinguishable from `none`:

| raw value | load‑bearing? | pane/slab | callout dot | tech line |
|---|---|---|---|---|
| `rocketride` | yes | `core` (gold) | gold | `RocketRide` |
| `rocketride` | no | `rr` (teal) | teal | `RocketRide` |
| `other` | either | `off` | neutral outline | `other platform` |
| `none` | either | `off` | faint | `not present` |

Reference JS:

```js
const TOP2BASE = ['output','reasoning','orchestration','retrieval','ingest']; // index 0..4
const LOAD = { reasoning:1, orchestration:1 };
const NAMES = { output:'Output / UI', reasoning:'AI Reasoning',
                orchestration:'Orchestration', retrieval:'Retrieval / RAG', ingest:'Ingest' };

function paneState(key, raw){                       // 'core' | 'rr' | 'off'
  if (raw !== 'rocketride') return 'off';
  return LOAD[key] ? 'core' : 'rr';
}
// glyph / tower panes iterate TOP2BASE; tower panes render bottom→top (reverse).
```

---

## 8. Field → UI mapping (all 11 Excel columns are represented)

| Excel column | Result field | Where in the UI |
|---|---|---|
| Project Name | `project` | card + detail header |
| Team Details (Names / Emails) | `names`, `emails` | detail header |
| Project Description | `description` | detail · "Project description" |
| How RocketRide Was Used & How It Helped | `rocketride_usage` | detail · "How RocketRide was used…" |
| RocketRide Usage Tag | `tag` | card pill + detail |
| RocketRide = Backbone? | `backbone` (+ `layers`) | card glyph + detail tower/readout |
| GitHub Link | `github` | detail links + card `GH` flag |
| Additional Notes | `notes` (+ `evidence[]`) | detail · "Additional notes" |
| Why This Classification | `justification` | detail · "Why this classification" |
| Demo / Presentation / Video | `demo` | detail links + card `VID` flag |
| Deployed URL | `deployed` | detail links + card `URL` flag |

---

## 9. Reconciliation — mockup vs. real data (must‑fix)

1. **`confidence` (e.g. `0.94`) does NOT exist.** Drop it. Use **`seconds`** (classify time) where the
   mockup showed confidence.
2. **Team** isn't on the wire today → add `names`/`emails` via §6b, then render in the detail header.
3. **Needs‑review** state → detect with `repo_accessible !== true || classify_failed` (added in §6b),
   not by string‑matching notes.
4. **SLA countdown** was decorative → replace with a real elapsed timer + `X / N` progress (§4.5).
5. **`layers`** is new (§6) — everything else in §5 already exists.

---

## 10. Visual design tokens & key CSS

### 10.1 Palette (committed dark)
```
Background base      #060d14
  glow top-left      radial rgba(20,184,166,.20)   (teal)
  glow bottom-right  radial rgba(56,189,248,.12)   (cyan)
Teal   (rr)          #2dd4bf → #0ea5b5
Gold   (core)        #facc15 → #f59e0b
Cyan   (labels)      #7fe3d0
Ink / strong ink     #dff1f5 / #eafcf7
Muted (dim)          #7fa0ab
Glass fill / border  rgba(255,255,255,.05) / rgba(255,255,255,.12)

Tag Significant      text #0a2b26 on gradient #67e8d3→#facc15
Tag Moderate         text #2b2103 on #fbbf24
Tag Less             text #cfe0e6 on rgba(255,255,255,.09)
Tag None             text #3a0d0d on #f2a08f
Needs-review accent  #f6a58f
```

### 10.2 Typography
- UI: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Data/paths/tech: `ui-monospace, "Cascadia Code", Menlo, Consolas, monospace`.
- Eyebrows/labels: 9–11px, `letter-spacing:.12–.16em`, uppercase, cyan.
- No web fonts (avoid CDN dependency).

### 10.3 Glass + tower CSS (core pieces)
```css
.glass{ background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.12);
  -webkit-backdrop-filter:blur(16px) saturate(150%); backdrop-filter:blur(16px) saturate(150%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.28), 0 18px 38px -24px rgba(0,0,0,.7); border-radius:16px; }
@supports not ((-webkit-backdrop-filter:blur(2px)) or (backdrop-filter:blur(2px))){
  .glass{ background:rgba(16,26,36,.9); } }            /* fallback where blur is unsupported */

.scene{ position:relative; height:272px; perspective:1400px; }
.tower{ position:absolute; left:28%; top:53%; width:180px; height:118px;
  transform:translate(-50%,-50%) rotateX(56deg) rotateZ(-42deg); transform-style:preserve-3d; }
.pane{ position:absolute; inset:0; border-radius:14px; background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.16); -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22), 0 26px 26px -18px rgba(0,0,0,.65); }
.pane.rr{   background:linear-gradient(135deg,rgba(45,212,191,.42),rgba(20,160,180,.28));
  border-color:rgba(140,255,235,.55); box-shadow:0 0 28px rgba(45,212,191,.36),
  inset 0 1px 0 rgba(255,255,255,.55), 0 26px 26px -16px rgba(0,0,0,.6); }
.pane.core{ background:linear-gradient(135deg,rgba(250,204,21,.5),rgba(245,158,11,.32));
  border-color:rgba(255,224,130,.72); box-shadow:0 0 34px rgba(250,204,21,.42),
  inset 0 1px 0 rgba(255,255,255,.62), 0 26px 26px -14px rgba(0,0,0,.6); }
.p0{transform:translateZ(0)} .p1{transform:translateZ(26px)} .p2{transform:translateZ(52px)}
.p3{transform:translateZ(78px)} .p4{transform:translateZ(104px)}   /* p0=Ingest(base) … p4=Output(top) */

.leaders{ position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
.callout{ position:absolute; width:126px; }
```

Mini‑glyph on the card: five `.slab` (7px tall) in a `flex-direction:column-reverse` column, classed
`core`/`rr`/`off`; a 3px gold `.core-bracket` overlays the two load‑bearing slabs.

### 10.4 Leader‑line layout algorithm (Option B) — run on select + resize
Panes are 3D‑transformed, so read their real screen boxes and distribute callouts evenly (avoids
overlap); draw an SVG polyline from each pane's right edge to its callout.

```js
function layoutCallouts(scene){
  if(!scene) return;
  const svg = scene.querySelector('.leaders'); if(!svg) return;
  const sr = scene.getBoundingClientRect(), W = sr.width, H = sr.height;
  const calloutX = W - 128, pad = 14, span = H - pad*2;
  svg.innerHTML = '';
  for(let i=0;i<5;i++){
    const pane = scene.querySelector(`.pane[data-layer="${i}"]`);  // i = index into TOP2BASE
    const el   = scene.querySelector(`.callout[data-ci="${i}"]`);
    if(!pane||!el) continue;
    const pr = pane.getBoundingClientRect();
    const px = pr.right - sr.left - 8;                 // pane right edge (scene coords)
    const py = (pr.top + pr.bottom)/2 - sr.top;        // pane vertical centre
    const cy = pad + span * i/4;                       // callouts spread evenly, no overlap
    el.style.left = calloutX+'px'; el.style.top = (cy-8)+'px';
    const ax = calloutX-6, ay = cy+4, mx = (px+ax)/2;
    const line = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    line.setAttribute('points', `${px},${py} ${mx},${py} ${ax},${ay}`);
    line.setAttribute('fill','none'); line.setAttribute('stroke','rgba(127,227,208,.55)'); line.setAttribute('stroke-width','1');
    svg.appendChild(line);
    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',px); dot.setAttribute('cy',py); dot.setAttribute('r','2.4'); dot.setAttribute('fill','#7fe3d0');
    svg.appendChild(dot);
  }
}
// call: requestAnimationFrame(()=>requestAnimationFrame(()=>layoutCallouts(scene)))  after innerHTML;
//       and window.addEventListener('resize', ()=>layoutCallouts(currentScene))
```

Tower panes carry `data-layer="<0..4>"` (index into `TOP2BASE`); render them bottom→top as
`p0..p4 = [ingest, retrieval, orchestration, reasoning, output]`. Callouts carry `data-ci="<0..4>"` in
top→base order.

---

## 11. Accessibility & robustness (required)
- `@media (prefers-reduced-motion: reduce)` → disable the busy‑card shimmer and any drift.
- Visible keyboard focus on cards, tabs, filters, links; cards operable with Enter/Space.
- `backdrop-filter` `@supports` fallback (above) so panes stay legible without blur support.
- Escape all interpolated strings (project names, notes, justification) before `innerHTML`.
- Wide content (the workspace) lives in an `overflow-x:auto` container so the page body never scrolls
  sideways; the grid scrolls vertically (`max-height` + `overflow-y:auto`).
- Never assume `layers` exists — always read the normalised object (the §6b fallback guarantees it).

---

## 12. Build checklist
- [ ] Apply §6a (`RUBRIC` `layers`) and §6b (`_public` + normaliser) — test with a couple of known repos.
- [ ] Confirm a real `result` event now includes a valid `layers` object; verify the fallback by
      temporarily stripping it.
- [ ] Replace `app/static/index.html` with the Glass Strata UI (keep it self‑contained, no external JS/CSS).
- [ ] Wire the 5 endpoints (§5) with the existing `fetch`+`ReadableStream` reader.
- [ ] Grid (mini‑strata) + sticky detail (Option‑B tower) + filters + counts + elapsed/progress.
- [ ] Excel **Download** button on `done.download` (Live and Batch).
- [ ] Busy + needs‑review card states; hover `title` peek; GH/VID/URL flags.
- [ ] Drop `confidence`; render team from `names`/`emails`; needs‑review via `repo_accessible`/`classify_failed`.
- [ ] Verify reduced‑motion, focus states, blur fallback, no horizontal page scroll.
- [ ] Sanity‑check the tower on all four verdict mixes (Yes / Partial / None / inaccessible).

---

## 13. Known limitations / open questions
- **Callout legibility** on the narrow detail panel is ~11px — fine, but if the client wants larger text,
  shrink the tower a touch more to buy width.
- **Callouts spread evenly** rather than sitting exactly at each pane's height (prevents overlap); the
  leader line ties label→pane. Intentional.
- **`other` vs `none`** both render as faint panes; only the callout dot/tech line distinguishes them. If
  you want `other` visually marked on the pane too, add a thin neutral outline variant.
- **Excel** has no layer column — decide later if judges want it exported.
- **Committed dark only** — confirm that's acceptable (the old UI had light mode).
```
