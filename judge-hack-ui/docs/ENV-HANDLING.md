# How Judge Hack handles environment variables

State as of 2026-10-01, written from the code, after aligning with Converge's
`ENV-HANDLING-CURRENT.md` (production v11). Sections 1–5 describe where every
variable lives; section 6 is the comparison against Converge and what is still
different on purpose.

---

## The short version

- **The app itself reads no environment variables.** Nothing under `src/` reads
  `process.env` or `import.meta.env`, and `rsbuild.config.mts` defines none —
  no `source.define`, no `publicVars`. Verified by search, not by assumption.
- **The pipelines carry exactly one secret name,** `${ROCKETRIDE_ANTHROPIC_KEY}`,
  resolved server-side from the org overlay. It is the app owner's own model
  credential, never a judge's. There is no GitHub token in any `.pipe`.
- **Each judge's GitHub token is their own.** It lives encrypted in that
  judge's user-scope platform vault, which only ever decrypts for its owner.
  There is no shared or fallback token. A run borrows it into page memory,
  hands it to the HTTP node one request at a time, and loses it with the page
  — nothing is cached or written. Removing that borrow is blocked on one
  platform fix, not on an app decision (§3).
- **The only `.env` is the developer's**, at the repository root. The App
  Builder extension writes it, it is gitignored, and only `tools/` reads it.
  `apps/judge-hack-ui/.env.example` is a reference list of names, not a
  template — it must never become a `.env`.
- **A write names its target.** Any tool that deploys or publishes refuses
  unless `--target cloud|staging|local` matches the configured host.

---

## Latest changes, newest first

| Date | Change |
|---|---|
| 2026-10-01 | **`tools/env.mjs`.** One module owns `.env` loading, the two connection pairs, the target guard and the audience parser, so they cannot drift between scripts. |
| 2026-10-01 | **A write names its target.** `stage2-publish.mjs` and `sql-probe.mjs` require `--target`, and refuse when the configured host disagrees. The check runs before the generators, so a refusal costs nothing. |
| 2026-10-01 | **Deploy tools use the deploy pair only.** `where-app.mjs` no longer falls back to the dev pair; `team-share.mjs` publishes over the deploy pair instead of the dev pair. |
| 2026-10-01 | **Identity comes from the instance being written to.** `stage2-publish.mjs` reads `developerId`, `devTeam` and the team list from the deploy connection, not the dev connection, and rejects a `ROCKETRIDE_DEPLOY_TEAM` that belongs to another instance. |
| 2026-10-01 | **The audience is named, never inferred.** `team-share.mjs` takes `--audience @me \| @public \| @team/<name>`, always pins `@me` alongside it, and refuses to guess when the two pairs point at different instances. `--publish-only` is retired. |
| 2026-10-01 | **`.env.example` rewritten** so it cannot be mistaken for a template, and warns that `setEnv` replaces a whole scope. |
| 2026-10-01 | **Token model decided: keep the user-scope vault** (§3, §6). Measured that `tool_http_request` ignores config-level auth, which is the real cause of the browser hop and the one platform fix that would remove it. |
| 2026-09-29 | `tools/app-id.mjs`: one tree serves both instances. The id is patched into the manifest, descriptor, entitlement and `.rrapp` for the length of the pack, then restored. `--app-id` / `ROCKETRIDE_APP_ID` override the default `hackjudge.judge-hack`. |
| 2026-09-?? | Per-judge GitHub token. Each judge saves their own PAT at user scope; no shared org credential, and a failed read is fail-closed rather than "no token". |

---

## 1. The developer's `.env` (repository root, gitignored)

Written by the App Builder extension every time it connects to a backend. Read
only by `apps/judge-hack-ui/tools/*`.

| Variable | What it is for | Read by |
|---|---|---|
| `ROCKETRIDE_URI`, `ROCKETRIDE_APIKEY` | The **development** connection: run, validate, read | `stage2-publish.mjs` (validate only), `team-share.mjs` (probe only), `sql-probe.mjs`, `org-census.mjs` |
| `ROCKETRIDE_DEPLOY_URI`, `ROCKETRIDE_DEPLOY_APIKEY` | The **deployment target**: deploy, publish, read what is live | `stage2-publish.mjs`, `team-share.mjs` (publish), `where-app.mjs` |
| `ROCKETRIDE_TARGET` (optional) | Names the target instead of `--target` | everything that writes |
| `ROCKETRIDE_APP_ID` (optional) | Overrides the app id; default `hackjudge.judge-hack` | `stage2-publish.mjs`, `team-share.mjs`, `where-app.mjs` |
| `ROCKETRIDE_DEPLOY_TEAM` (optional) | Which team receives the pipes | `stage2-publish.mjs`, `sql-probe.mjs` |

Both pairs currently point at **staging**. The extension rewrites them together
when it is repointed, so both move at once — that is the moment every script
here changes instance.

## 2. The platform's server-side environment (org, team, user)

RocketRide's own secret store, set in the Environment overlay or with
`account.setEnv`.

| Name | Scope | Who sets it | Who reads it |
|---|---|---|---|
| `ROCKETRIDE_ANTHROPIC_KEY` | **org** | the app owner, in Account → Environment | the engine, substituting `${…}` in the three pipes |
| `ROCKETRIDE_GITHUB_TOKEN` | **user** | each judge, from Settings → GitHub access | the app, via `getEnv('user')`, at the start of each run |

`getEnv(scope)` returns that scope's dict alone — it does not merge org into
user — so a token at org scope cannot silently become a fallback for the
app. `getEnvironmentKeys()` **is** merged, but returns names only and is used
only to report which pipe secrets exist.

Judge Hack needs exactly one org-level variable. Staging's org still carries a
leftover `ROCKETRIDE_GITHUB_TOKEN`; the app never reads it, and
`team-share.mjs` now prints a warning when it finds one at org or team scope.

## 3. The judge's GitHub token

**Decided 1 Oct 2026: this model stays.** It is deliberate, it is ahead of
Converge's (§6), and it is the model the production move ships on.

`src/verify/githubToken.ts` is the only place that touches the value.

### How a run uses it, step by step

1. A judge hits **Run** in their signed-in session.
2. **The app asks the vault for the value.** It calls the platform's
   environment API; the platform checks that the request is authenticated as
   the owner of that user layer, decrypts, and returns the PAT to that judge's
   session over HTTPS. The vault only ever decrypts for its owner — which is
   why no other judge can obtain it.
3. **The value sits in a variable in the judge's page.** Memory only; nothing
   is written to `localStorage`, to the store, or anywhere else. This is the
   browser-handling moment, and it is the one the planned fix removes.
4. **The scoring loop spends it, one request at a time.** The Python node has
   no internet, so it replies "I need these 83 files". For each file at a
   genuine GitHub address the app calls the HTTP node and hands the token along
   with that call; the node puts it in the `Authorization` header and fetches.
   Anything not on GitHub — vendor docs, registries — is fetched with no token
   attached. `githubBearerUrl` is the gate, and it rejects userinfo in the URL,
   non-https and host spoofs.
5. **The run ends and the token evaporates.** Responses feed the next Python
   round, the verdict comes out, and the page variable goes with the page. The
   next run starts again at step 2.

So the app uses it in the most literal sense: borrowed from the vault for the
duration of one run, handed to the courier one errand at a time, never kept.

### The rest of the lifecycle

- **Write:** read-modify-write of the judge's **own** user scope only —
  `getEnv('user')` then `setEnv('user', { ...env, TOKEN })`. The same operation
  the shell's Account → Environment page performs. Org and team are never
  written from the app.
- **Missing or unreadable:** fail-closed. A failed `getEnv` raises
  `GithubEnvReadError`, deliberately distinct from a successful empty read — a
  broken read must not look like "this judge never saved a PAT".
- **Verification:** one browser `fetch` to `api.github.com/user` when the token
  is saved. It stores nothing.
- **Audit:** `{ action: 'set' | 'clear', at }` — never the value, not even
  masked.

### Known discrepancy with step 4

The app **also** interpolates `TOKEN = "<the PAT>"` into the Python payload of
every evaluator call (`buildCode` in `src/verify/pythonInvoke.ts`). The Python
side never reads it: `choose_fetcher` only uses the token when `HAVE_URLLIB`
is true, and the engine blocks the import outright —
`ImportError: Import of 'urllib.request' is not allowed`, confirmed against
staging on 1 Oct regardless of what the pipe's `allowedModules` says. So the
value crosses the wire as tool input on every call and is never used.

It is a one-line removal and it buys back one of the two transmissions without
waiting on the platform. Not done yet; nothing depends on it.

### The planned future

Steps 2 and 3 collapse. The pipe config names the key, the engine resolves it
server-side from the judge's user layer and attaches it itself, and the app's
involvement in the token drops to zero — exactly how the Anthropic key already
works.

**The only blocker is that `tool_http_request` does not read auth from config.**
Measured against staging on 1 Oct, with a literal invalid token so no real
secret was involved:

| What was tried | Result |
|---|---|
| `bearer_token` in node **config** | GitHub returned `200`, rate limit `60` — anonymous. Ignored. |
| `headers.Authorization` in node **config** | same — ignored |
| the same token as a **per-call** input | `401` — applied |
| `validate()` on any of them | accepted, including a deliberately nonsensical field, so validation proves nothing here |

`${…}` substitution in pipe config is not the problem — it already works for
`${ROCKETRIDE_ANTHROPIC_KEY}`. The node simply has nowhere to put a credential.

The platform ask is therefore: **config-level auth on `tool_http_request` that
honours `${ROCKETRIDE_*}`**, ideally with a host allowlist on the node — a
configured bearer would otherwise be attached to *every* URL the node fetches,
including third-party docs pages, which is worse than today. Without an
allowlist the app-side equivalent is two HTTP nodes, one authenticated for
GitHub and one bare, with the app choosing by URL as it already decides.

Converge is blocked on the same node limitation, so one fix serves both apps.

## 4. Platform-injected, not ours

The engine injects `ROCKETRIDE_CLIENT_ID` and `ROCKETRIDE_DB_DSN` into its own
pipeline processes so the cloud DB nodes resolve the right tenant database.
Nothing a client sends can set them. When a server is missing
`ROCKETRIDE_DB_BROKER_URL` / `_TOKEN`, every store call fails with
"ROCKETRIDE_CLIENT_ID is not set" — platform configuration, not an app defect.
`classifySqlError` in `src/verify/sqlStore.ts` recognises that string and
degrades to the workspace blob rather than losing the run.

## 5. Legacy, unused

| Variable | Where | Note |
|---|---|---|
| Personal Postgres connection strings | retired with `hackjudge_sql_v1.external.pipe` | the `storeVariant=external` path is not deployed |

---

## 6. Converge compared, rule by rule

Converge's `ENV-HANDLING-CURRENT.md` is the reference. Each row is one of its
claims or rules.

| Converge's rule | Judge Hack before today | Now |
|---|---|---|
| The app reads no environment variables | Same — no `process.env` in `src/` | **Same** |
| The build injects none | Same — no `define` in `rsbuild.config.mts` | **Same** |
| No secret or secret name in a `.pipe` | Three pipes carry `${ROCKETRIDE_ANTHROPIC_KEY}` | **Still differs, on purpose** — see below |
| No shared GitHub token fallback | None: user scope only, and `getEnv` does not merge | **Same** |
| Customer tokens are not environment variables | They are — user-scope platform env | **Still differs, decided** — see below |
| A token typed in is used directly, not read back | Same: `probeGithubToken` uses the typed value | **Same** |
| The only `.env` is the developer's, gitignored | Same, plus a `.env.example` that read like a template | **Same**, and the example now says it is not one |
| Deploy tools use the deploy pair only | **No.** `where-app` fell back to the dev pair; `team-share` published over the dev pair | **Fixed** |
| `--target` refuses a host mismatch | **No.** The host was printed, not checked | **Fixed** (and required, not defaulted) |
| The audience must be named | **No.** `team-share` guessed the first/dev team | **Fixed** (`--audience`, `@me` always pinned) |
| The app id looks like `publisher.name`, patched for the pack then restored | Same (`tools/app-id.mjs`) | **Same** |
| `ROCKETRIDE_APP_ID` overrides for a one-off | Same | **Same** |
| Ask when the deploy pair is missing | `where-app` silently substituted the dev pair | **Fixed** — it now says no deploy target is set |

### Three deliberate differences

**1. The Anthropic key stays in the pipes.** Converge's rule exists because its
pipeline once carried `bearer_token=${ROCKETRIDE_SPACEPORT_GITHUB_TOKEN}` — one
person's GitHub credential that every workspace ran on. Judge Hack has no
equivalent: there is no credential in any pipe that belongs to a *user*. What
is there is the app owner's own model key, at org scope, substituted
server-side, never in the bundle and never per-judge. Removing it would mean no
LLM, and Converge's pipeline needs no secret only because it has no LLM. Judge
Hack already complies with the rule's purpose; it cannot comply with its letter.

**2. There is no default target.** Converge defaults `--target` to `cloud`,
which means a bare `deploy-app.mjs` deploys to production as soon as `.env`
points there. Judge Hack requires the word. The whole reason the guard exists
is that `.env` reflects the last thing clicked in the extension rather than
anything about the command, and a default re-introduces exactly that gap for
the one command where it costs most.

**3. One token per judge, not per workspace and per repository.** Converge
resolves typed → repository → workspace. Judge Hack has a single per-judge
token, because a judge is a person scoring many repositories, not a workspace
owning a few. A per-target override (a private repo the judge's own PAT cannot
see) would be the equivalent feature; it is not built.

### Where the GitHub token lives — decided 1 Oct: keep the platform secret store

This is the remaining structural difference, and it was examined rather than
inherited. The conclusion is that Converge's model is **right for Converge and
wrong for Judge Hack**, so this one is not copied.

**The decisive fact is in Converge's own §4.2:**

> The first implementation put the token in the platform's **team** secret
> scope, which keeps it out of the browser entirely. That was abandoned for a
> concrete reason: writing a team secret requires the `team.admin` permission,
> so an ordinary member connecting a repository could not add one — which is
> exactly the case the feature exists for.

Converge built the vault-backed design first and retreated from it. The thing
that forced the retreat was `team.admin` on **team** scope. Judge Hack stores
at **user** scope, and the platform's permission model grants every org member
`getEnv('user')` and `setEnv('user')` on their own layer with no admin role.
Converge's blocker structurally cannot occur here, because Judge Hack's token
belongs to a person rather than to a team.

Judge Hack therefore already holds the position Converge wanted and could not
reach. Adopting their model would be a retreat from it.

Their summary table is explicit about what that retreat cost: for the customer
GitHub PAT, "Reaches the browser: **Yes, by design**" and "Encrypted at rest:
**No** — deliberate". At run time the two apps behave identically — the browser
reads the token and hands it to the HTTP node per call — so copying Converge
would change only where the token rests, from an encrypted vault to a plaintext
row that, in their words, "anybody who can open the workspace can read by
asking the store for it".

| | Converge | Judge Hack |
|---|---|---|
| Whose token | a **workspace's**, shared by its members | a **person's**, used only by them |
| Stored in | a row in that workspace's tenant database | the judge's user-scope platform environment |
| Written by | insert/update on one row the app owns | `setEnv('user', { ...everything, TOKEN })` |
| Blast radius of a bad write | that one row | every variable in that judge's user scope |
| At rest | plaintext | the platform's encrypted secret store |
| Reachable from a pipeline | yes — the same DB the app queries | no |
| Survives a store outage | no | **yes** |

**What moving would fix (one thing, and the smallest).** `setEnv` is a
full-dict replace, so saving a token is a read-modify-write of the judge's
whole user scope. If anything changed in between, it is lost. Scope: one
person, on the rare occasion they save a token, and most judges have nothing
else at user scope.

**What moving would cost (three things).**

1. **Availability.** The token read is currently independent of the store. When
   the SQL store fails, `RunsContext` falls back to `kind: 'appState'` with
   `ready: true` and judges keep scoring — only history degrades. Put the token
   in `hj_credentials` and a broker outage means no token, which means no
   verification at all. That couples "can I score a repo" to the exact
   subsystem that was broken on production until today.
2. **Protection at rest.** Encrypted secret store → plaintext row. Converge
   documents its own tokens as plaintext and keeps a separate note on what
   would fix it; adopting the model means adopting that open problem.
3. **Reachability.** The token would sit in the same tenant database the app
   issues SQL against through `rocketride_sql` with `allow_execute`. Today a
   credential is not reachable from any pipeline at all. The store's queries
   are parameterised and there is no known hole — the point is blast radius,
   not a present defect.

**What makes no difference either way:** isolation between judges (per-user in
both), the impossibility of a shared fallback (already impossible, because
`getEnv` does not merge scopes), and **the browser's handling — identical in
both apps**: read per run, sent to the HTTP node per call, never cached. That
last one is the point worth holding on to. The browser exposure everyone keeps
asking about is not a consequence of where the token is stored; it is a
consequence of `tool_http_request` having no config-level auth (§3). Moving the
store does not touch it.

**Why Converge chose differently.** Its token belongs to a workspace, which is
a thing that already lives in that database, and its pipeline has no SQL node,
so there is no reachability question. Judge Hack's token belongs to a person,
which is precisely what platform user scope is for.

The deploy discipline was the part worth copying, and it has been.

---

## Do's

- **Name the target on every write:** `--target cloud|staging|local`. The tools
  refuse a mismatch; that refusal is the feature.
- **Check the hosts before running anything.** Every tool prints
  `host=… target=…` on connect. Print hosts, never keys.
- **Reconnect the extension to switch environments.** Don't hand-edit `.env`.
- **Use the pair that matches the job:** the dev pair to run, validate and
  read; the deploy pair to deploy and publish.
- **Ask when the deploy pair is missing.** It means no deploy target is set —
  it does not mean "use the dev pair".
- **Publish `@me` alongside any team or public rung.** The browser resolves the
  personal rung first, so a team-only publish is invisible to the publisher.
- **Set org secrets in the platform UI,** Account → Environment.
- **Use fine-grained, read-only GitHub tokens:** Metadata and Contents at read
  level.

## Don'ts

- **Don't commit `.env`** or copy its keys into CI, docs, chat or screenshots.
- **Don't call `setEnv` on org or team scope from a script.** It replaces the
  entire dict at that scope. The app's only write is read-modify-write on the
  signed-in judge's own user scope.
- **Don't create `ROCKETRIDE_GITHUB_TOKEN` at org or team scope.** The app
  never reads it, and it is one widened read away from being a shared
  credential every judge unknowingly runs on.
- **Don't read `process.env` in `src/`.** The app gets its configuration from
  the platform connection.
- **Don't put a user's credential in a `.pipe`.** The owner's org-scope model
  key is the only secret name that belongs there.
- **Don't copy `.env.example` to `.env`.** It is a list of names. An app-level
  `.env` with a real value in it is a secret sitting next to the bundle.
- **Don't put a token value in logs, errors, audit lines, snapshots or
  exports** — not even masked. The audit records that a token was set or
  cleared.
- **Don't run writing scripts while `.env` points at production** unless that
  is the intent. `stage2-publish.mjs`, `sql-probe.mjs` and
  `team-share.mjs --publish` all write.

---

## Out of date elsewhere

- **`docs/PROD-CHECKLIST.md`** was written before the target guard. Its
  commands now need `--target`; it has been updated, but any copy taken before
  1 Oct has not.
- **`docs/AGENT-HANDOFF.md` and `docs/STAGE4-CHECKLIST.md`** still show
  `npm run stage2` with no `--target`, and `team-share.mjs --publish-only`,
  which is retired.
- **The workspace-root `pipelines/` directory** holds generated copies of the
  three pipes. `tools/gen-pipes.mjs` writes both it and `src/pipelines/`, so
  they are regenerated rather than stale — but only the `src/` copies are read
  by the tools and the app.
