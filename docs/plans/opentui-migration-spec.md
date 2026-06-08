# Spec: Dual-Engine TUI — OpenTUI (Bun) alongside hermes-ink (Node)

> **⛔ SUPERSEDED (2026-06-08) by `opentui-native-rewrite-spec.md`.** The shim architecture
> below was abandoned: glitch chose to **rewrite the view layer natively in OpenTUI** rather than
> impersonate Ink via a shim. This doc is retained for its **adversarial-review findings (§11–§14)
> on the launcher, distribution, and cross-platform realities**, which still apply and are carried
> into the v3 spec. Read v3 first.


**Status:** Spec. Ready to grill / adversarially validate. **No implementation yet.**
**Date:** 2026-06-08
**Author:** Hermes (for glitch)
**Predecessor:** `docs/plans/opentui-migration-feasibility.md` (spikes proved: OpenTUI needs Bun;
Node fails; a `@hermes/ink`-compatible shim renders a real transcript row under Bun).

> ## ⚠️ ADVERSARIAL REVIEW VERDICT (2026-06-08) — read before implementing
> Three independent reviewers (neutral briefs) audited this spec against the real code.
> **Two load-bearing claims in the original draft are FALSE.** Corrections are inlined below
> as `[REVIEW]` callouts; the original prose is kept for diff context. The net effect:
> - The dual-engine **launcher/flag** architecture is sound BUT `_make_tui_argv` is **not**
>   the single chokepoint (P1/P2 below). The env-mutation in `_launch_tui` and the dashboard
>   PTY spawn site are second/third cutover points.
> - The **shim is not a 40-line adapter and the 47 files are not byte-identical.** Three
>   load-bearing patterns (nested `<Text>` style cascade, per-cell `<NoSelect>` mask,
>   reconciler-coordinate mouse events) cannot be expressed as prop translations. The
>   feasibility spike validated only the easy flat-row case.
> - **Distribution breaks the universal-wheel invariant.** Termux & nix are unaddressed;
>   Windows is effectively a hard blocker on ever flipping the default / retiring the fork.
> **Required next step before Phase 1: three targeted spikes** (nested-Text flattening;
> NoSelect-exclusion in OpenTUI's selection; composer click-drag). If any fails, the "shim"
> becomes a second engine maintained *on top of* OpenTUI — contradicting the whole motivation.
> Full reviewer findings appended in §11–§13.

## Decisions locked (from glitch)
1. **Bun as TUI runtime: YES.** OpenTUI's native core requires it.
2. **Dual-engine** behind a flag. Ship Node+Ink (default) and Bun+OpenTUI side-by-side.
3. **Motivation:** render perf, shed the hermes-ink fork maintenance burden, OpenTUI is more
   forward-facing. → The OpenTUI path must eventually become *default*, but only after parity.

---

## 1. The flag

`HERMES_TUI_ENGINE` (env) + `display.tui_engine` (config), values:
- `ink` (**default** during transition) → Node + `@hermes/ink` (today's path, untouched).
- `opentui` → Bun + `@opentui/react` via the shim.

Resolution order: env > config > default `ink`. One helper, `_resolve_tui_engine()`, in
`hermes_cli/main.py`, consulted by `_make_tui_argv`.

Rollback at any point = unset the flag. Zero code churn to revert because the Ink path is
never modified, only branched around.

---

## 2. Single cutover point (Python launcher)

**File:** `hermes_cli/main.py`, `_make_tui_argv(tui_dir, tui_dev)` — **line 1530**.

It returns `[node, "--expose-gc", <entry.js>]` in **three** places:
- L1569 — `HERMES_TUI_DIR` prebuilt
- L1575 — wheel-bundled `tui_dist/entry.js`
- L1683 — normal esbuild flow

**Change:** at the top of `_make_tui_argv`, branch on engine:

```python
engine = _resolve_tui_engine()           # "ink" | "opentui"
if engine == "opentui":
    return _make_opentui_argv(tui_dir, tui_dev)   # new sibling fn
# ... existing ink body unchanged ...
```

`_make_opentui_argv` mirrors the structure but:
- runtime binary = **`bun`** (new `_bun_bin()` resolver, parallel to `_node_bin()` L1534)
- dev: `bun --watch src/entry.opentui.tsx` (or reuse `entry.tsx` gated internally)
- prod: `bun dist/entry.opentui.js` (Bun build output) **or** `bun src/entry.opentui.tsx`
  directly (Bun runs TS natively — may skip a build step entirely; see §4)
- bun install gating: parallel to `_tui_need_npm_install` (L1319), checking
  `@opentui/core` + `@opentui/react` presence.

Node-bootstrap (`_ensure_tui_node` L1465) gets a Bun sibling `_ensure_tui_bun()` —
fnm/proto/`curl -fsSL https://bun.sh/install`/brew cascade, mirroring node-bootstrap.sh.
Add `scripts/lib/bun-bootstrap.sh`. Set `HERMES_SKIP_BUN_BOOTSTRAP=1` to disable.

**Why this is safe:** the entire Ink body (L1552–1683) is left byte-for-byte intact and only
runs when `engine == "ink"`. No regression risk to the shipping path.

---

## 3. The shim module (`ui-tui/src/engine/`)

The core of the migration. A `@hermes/ink`-API-compatible module backed by `@opentui/react`,
so the **47 files** in `ui-tui/src` that import `@hermes/ink` change their import path *once*
(or not at all, via build-time alias — preferred).

### 3a. Build-time alias (preferred — zero source edits)
The Bun build/entry aliases `@hermes/ink` → `src/engine/ink-opentui.tsx`. Mirrors how the
esbuild build already aliases `@hermes/ink` → `packages/hermes-ink/src/entry-exports.ts`
(`ui-tui/scripts/build.mjs` **L41**). So the Ink build aliases to the fork; the OpenTUI build
aliases to the shim. **Source files stay identical between engines.** This is the killer
property of the dual-engine approach.

### 3b. Shim exports (the contract to satisfy)
From the feasibility audit, `ui-tui/src` consumes:

**Components:** `Box`, `Text`, `Link`, `ScrollBox` (+ `ScrollBoxHandle`), `Ansi`, `NoSelect`,
`Ink`/`render`/`renderSync`, `AlternateScreen`.
**Hooks:** `useInput`, `useApp`, `useStdin`, `useStdout`, `useSelection`, `useHasSelection`,
`useTerminalTitle`.
**Types/consts:** `Key`, `InputEvent`, `FrameEvent`, `MouseTrackingMode`.
**Escape hatches:** `forceRedraw`, `evictInkCaches`, `withInkSuspended`, `scrollFastPathStats`,
`isXtermJs`, `stringWidth`, `wrapAnsi`, `RunExternalProcess`.

### 3c. Prop mapping (validated in feasibility §8)
`Box`: `flexDirection|margin*|alignSelf|width|height|flexGrow|flexShrink` → `style`;
`paddingX/Y` → `style.padding{Left,Right,Top,Bottom}`; `borderStyle="round"` → `border` +
`borderStyle="rounded"`; `borderColor` → `borderColor`; `onClick` → mouse handler on
focusable renderable.
`Text`: `color` → `fg`; `backgroundColor` → `bg`; `bold/italic/underline/strikethrough` →
`attributes`; `dim`/`dimColor` → `attributes.dim`; `wrap` → see gap #1.

### 3d. The hard 20% (each needs explicit design + tests)
1. **`wrap` truncate modes** (`truncate-end/start/middle`, `middle`) — OpenTUI `<text>`
   wraps by default. Implement by pre-truncating in JS (we own `lib/text.ts`) before render.
2. **`<Ansi>`** — inline ANSI escapes in tool output / system Rich markup. OpenTUI takes
   styled spans, not embedded escapes. **Port the termio ANSI parser standalone** from
   `packages/hermes-ink/src/ink/termio/*` → `src/engine/ansiToSpans.ts`, emitting OpenTUI
   `<span>` trees. This is the single biggest sub-task.
3. **`<NoSelect>` + `fromLeftEdge`** — gutter glyphs excluded from copy. Map to OpenTUI
   selection model; **verify copied text excludes gutters** (test against `selection` event +
   `getSelectedText()`).
4. **`ScrollBox` + fast-path** — `scrollFastPathStats` is an Ink-fork perf hack. OpenTUI
   `<scrollbox>` replaces it; re-validate scroll perf (this is a *motivation*, so measure).
5. **`useInput`/`Key`/parse-keypress** → `useKeyboard` (+ optional Kitty protocol). Key event
   shape differs; adapter must normalize to the `Key` shape callers expect.
6. **`forceRedraw`/`evictInkCaches`/`withInkSuspended`** → `renderer.requestRender()` /
   `suspend()`/`resume()` / scrollback writers. Bespoke; each call site reviewed.
7. **`render`/`onFrame`/`onHyperlinkClick`** (entry.tsx L114–124) → `createRoot(renderer)` +
   `renderer.on('frame')` + link click via OpenTUI `<a>` / mouse. New `entry.opentui.tsx`.

---

## 4. Build & distribution

| Concern | Ink (today) | OpenTUI |
|---|---|---|
| Build | esbuild → single `dist/entry.js` (`scripts/build.mjs`) | Bun runs TS natively → **may need no bundle**; or `bun build --compile` standalone exe. Native `@opentui/core-<platform>` lib **cannot inline** — must be resolvable at runtime. |
| Launcher artifact | `node dist/entry.js` | `bun src/entry.opentui.tsx` (dev/checkout) or `bun build` output + native lib (packaged) |
| Wheel bundling | `tui_dist/entry.js` (L1526) | Native lib per platform → wheel size + platform matrix grows. **Decision needed: ship Bun+lib, or require user-installed Bun.** |
| Docker | esbuild rebuild + chown `ui-tui/dist` (`docker/stage2-hook.sh` L215) | Add Bun to image; add OpenTUI native lib; parallel chown if a build dir is produced |
| `scripts/profile-tui.py` | hardcodes `node dist/entry.js` (L11) | add `--engine opentui` path → `bun ...` |

**Open build decision (grill target):** packaged-release distribution model for the native
lib — (a) `bun build --compile` standalone exe per platform, (b) ship Bun + `@opentui/*`
node_modules, or (c) require Bun on PATH and lazy-install `@opentui/*`. Recommend (a) for
releases, (c) for dev/checkout.

---

## 5. Dashboard PTY bridge

`hermes_cli/pty_bridge.py` + `web_server.py` `/api/pty` spawn the TUI subprocess. They invoke
whatever `_make_tui_argv` returns, so **if the cutover lives entirely in `_make_tui_argv`, the
bridge needs no engine-specific code** — it just spawns `bun ...` instead of `node ...`.
Feasibility spike already proved OpenTUI renders to a **custom stdout** (the PTY path).
**Verification:** drive `bun entry.opentui.tsx` through the PTY bridge + xterm.js and confirm
frames, resize (`renderer.resize`), and OSC52 copy work over the socket.

---

## 6. Phasing (each phase independently shippable behind the flag)

- **Phase 0 — Scaffolding.** Flag resolver + `_make_opentui_argv` + `_ensure_tui_bun` +
  `bun-bootstrap.sh`. `entry.opentui.tsx` renders a "hello, engine=opentui" screen. Proves
  the launch path end-to-end. *Exit:* `HERMES_TUI_ENGINE=opentui hermes --tui` shows a frame.
- **Phase 1 — Shim core.** `Box`/`Text`/`Link` + prop mapping + build-time alias. Render the
  **transcript** screen (messageLine + markdown) under the flag, diff vs Ink. *Exit:* transcript
  visually matches.
- **Phase 2 — Input + selection.** `useInput`→`useKeyboard`, `useSelection`/`NoSelect`, copy.
  *Exit:* composer typing, scroll, mouse-select+copy (gutters excluded) all work.
- **Phase 3 — ANSI + scrollbox + escape hatches.** Port termio→spans, `<ScrollBox>`,
  `forceRedraw`/`evictInkCaches`/`withInkSuspended`. *Exit:* tool output + long sessions parity.
- **Phase 4 — Dashboard + Docker + packaging.** PTY bridge over Bun, Docker image, release
  distribution decision implemented. *Exit:* `hermes dashboard → /chat` works on OpenTUI.
- **Phase 5 — Perf validation + flip default.** Benchmark OpenTUI vs Ink (the motivation).
  If it wins, flip default to `opentui`; keep `ink` selectable. *Exit:* default switched.
- **Phase 6 — Retire fork.** Delete `packages/hermes-ink` only after a deprecation window
  with `opentui` as default and no parity regressions reported.

---

## 7. Test strategy
- Shim unit tests (Bun's test runner or vitest) for prop mapping + ANSI→span parser, mirroring
  the existing termio tests (`packages/hermes-ink/src/ink/termio/*.test.ts`).
- Frame-diff harness: render the same `Msg[]` fixtures under both engines to a custom stdout,
  strip cursor-movement noise, compare. (Feasibility `dump.mjs` is the seed.)
- Keep the existing `ui-tui` vitest suite green for the Ink path throughout (no regressions).

---

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Bun availability (Windows, exotic platforms) | Ink stays default + selectable; flip default only after Bun coverage proven. `bun-bootstrap.sh` cascade. |
| ANSI→span parser is the long pole | Port the *existing, tested* termio parser rather than writing fresh. |
| Selection/copy parity (gutters) | Dedicated Phase 2 exit test against `getSelectedText()`. |
| Native lib distribution bloat | Standalone `bun build --compile` for releases; lazy-install for dev. |
| Perf doesn't actually beat Ink | Phase 5 gates the default-flip on real benchmarks; if it loses, dual-engine still delivers the forward-facing path without forcing the switch. |

---

## 9. What stays untouched (the safety guarantee)
- `packages/hermes-ink/**` — frozen until Phase 6.
- The entire Ink body of `_make_tui_argv` (L1552–1683).
- `scripts/build.mjs` Ink path (only a new Bun build script is added).
- Every `ui-tui/src` source file (build-time alias swaps the renderer, not the source).

---

## 10. Grill targets (answer before Phase 4)
1. Release distribution for the native lib: standalone exe vs ship-Bun vs require-Bun? (§4)
2. Do we keep a single `entry.tsx` with internal engine gating, or a separate
   `entry.opentui.tsx`? (Separate is cleaner; gating avoids drift. Lean: separate, thin.)
3. Windows: is Bun coverage acceptable to ever flip default, or is Windows Ink-forever?
4. Should the shim live in `ui-tui/src/engine/` or its own `packages/hermes-opentui/`?
   (Lean: `src/engine/` until it stabilizes, then extract.)

---

## 11. [REVIEW] Launcher / runtime corrections (Reviewer A)

`_make_tui_argv` is **NOT** the single chokepoint. Three corrections:

- **P1 (CRITICAL) — `NODE_OPTIONS` injection lives in the caller, not `_make_tui_argv`.**
  `hermes_cli/main.py:1890-1893` (inside `_launch_tui`, runs *before* `_make_tui_argv` at
  L1905) unconditionally appends `--max-old-space-size=<n>` to `NODE_OPTIONS`. Bun uses JSC,
  not V8 — this flag is meaningless/erroring under Bun, and the whole cgroup heap-sizing
  machinery (`_resolve_tui_heap_mb`, `_read_cgroup_memory_limit`, L1710-1778) silently dies,
  re-opening the silent-OOM class of bug. **Fix:** gate that block on `engine == "ink"`;
  design a Bun memory strategy (Bun has no `--max-old-space-size` equivalent — unsolved hole).
- **P2 (CRITICAL) — second spawn site: the dashboard PTY bridge.**
  `hermes_cli/web_server.py:8502-8528` calls `_make_tui_argv` (good) but builds its **own** env
  from `os.environ.copy()` and sets `NODE_ENV=production`, `HERMES_TUI_INLINE`,
  `HERMES_TUI_DISABLE_MOUSE` — Ink assumptions, never normalized per-engine. **Fix:** extract a
  shared `_apply_tui_engine_env(env, engine)` used by *both* `_launch_tui` and the PTY bridge.
- **P3 (HIGH) — `entry.tsx` bootstrap is V8/Node-only, not just `render`.**
  `--expose-gc` (no Bun equivalent), `node:v8` heap snapshots (`lib/memory.ts:6,157`),
  `startMemoryMonitor` + `process.exit(137)` EOF contract (`entry.tsx:66-89`),
  `setupGracefulExit` signal semantics (`entry.tsx:42-64`). Reusing these under Bun throws at
  import or silently kills OOM-attribution (the #34095 observability). **Fix:**
  `entry.opentui.tsx` must *re-implement* (not reuse) the lifecycle/memory bootstrap, or
  declare it degraded with a documented gap + `node:v8` availability guard.
- **P4/P5 (HIGH/MED) — build-alias + artifact resolution.** The "build-time alias" property
  only holds in **bundled** mode (esbuild `build.mjs:41`); the spec's "run TS directly" mode
  needs `bunfig.toml` aliasing instead — pick one. `_find_bundled_tui` (L1522), `HERMES_TUI_DIR`
  (L1553), `_tui_need_rebuild`/`_tui_need_npm_install` all key off `dist/entry.js` +
  `package-lock.json`; under `engine=opentui` they hand a **Node bundle to `bun`** (category
  error). Bun uses `bun.lockb` (binary) — freshness logic must be rewritten, not "mirrored."
  Add `HERMES_BUN` override. **Engine-parameterize every artifact/lockfile/binary path.**
- **P6 (MED) — ordering:** the engine branch must go **above** `_ensure_tui_node()` (L1532,
  first statement) or every OpenTUI launch bootstraps Node and a Bun-only box `sys.exit(1)`s.
  Plus concurrent `/api/pty` builds race a shared `dist`/`node_modules` across two toolchains.

## 12. [REVIEW] Shim / rendering-parity corrections (Reviewer B)

The "40-line shim, 47 files byte-identical" thesis is **false**. Good news: no
`measureElement`/`Static`/`Transform`/`useFocus`/`Spacer`/`Newline` in use. But three
load-bearing patterns can't be prop-translated:

- **SHOWSTOPPER A — nested `<Text>`-in-`<Text>` inline style cascade.** Every markdown
  paragraph/table cell/inline-code run nests `<Text>` and relies on Ink's style-inheritance +
  parent-level `wrap` over element children (`markdown.tsx:466-469,48`;
  `messageLine.tsx:112-114,179-186`). OpenTUI `<text>` takes a flat span list, not nested
  React `<text>` with cascading style. The shim must **flatten the subtree into spans + apply
  wrap at OpenTUI's resolved width** — a mini-reconciler. The spike never exercised this.
- **SHOWSTOPPER B — `<NoSelect>`/`fromLeftEdge` is a per-cell `Uint8Array` mask** consulted by
  every selection primitive (`NoSelect.tsx:54-59`; `selection.ts:170,335,863,901`), plus a
  geometric row-spanning col-0 extension. OpenTUI's selection has **no caller-supplied
  cell-exclusion hook**. If absent, gutters (`✦`/`>`, `└─`) paste into every copy — daily
  regression. May require forking OpenTUI's selection → defeats "shed the fork."
- **SHOWSTOPPER C — reconciler-coordinate mouse events.** App uses
  `onMouseDown/Drag/Up/Enter/Leave` (not just `onClick`) with fork-grid payloads
  `{localCol, localRow, cellIsBlank, stopImmediatePropagation}` (`textInput.tsx:1205-1267`;
  `appLayout.tsx:95,225`; `appChrome.tsx:682-695`). `onMouseDrag` is a fork invention. Shim
  must recompute rects→local cells, synthesize drag, compute `cellIsBlank`.
- **`<Ansi>` is half-done already** (`Ansi.tsx:177-222` `parseToSpans` exists) — the parser
  port is bounded; its *composition inside parent `<Text wrap>`* is gated on Showstopper A.
- **`wrap` modes: 8 not 4.** `wrap-trim` (the markdown default, `wrap-text.ts:115`) and
  `wrap-char` are custom algorithms; "pre-truncate in JS" is impossible since truncation is
  **post-layout-width-dependent** (`appChrome` uses `flexShrink`+`truncate-end`).
- **§3b omissions in real use:** `Text inverse` (every picker), `dimColor` vs `dim` (visible
  color, not cosmetic), `flexShrink` on Text, `Box height` spacers + the whole
  **virtual-history scroll** path (`useVirtualHistory.ts`, `ScrollBoxHandle`) — unaddressed.

## 13. [REVIEW] Distribution / Docker / cross-platform corrections (Reviewer C)

The current TUI artifact is a **single universal `entry.js` in a `py3-none-any` wheel**.
OpenTUI's per-platform native lib breaks that on every channel:

- **pip wheel:** bundling Bun+native lib forces a **platform-tagged wheel matrix** (cp3x ×
  manylinux/macos/win) — `upload_to_pypi.yml:61-72` + `pyproject.toml:277` build ONE universal
  wheel today. This is a release-pipeline rewrite, not a "size bump."
- **`bun build --compile`:** 1-leg build → 5-platform matrix; artifacts ~100 MB each (~500 MB
  total) vs hundreds of KB; + macOS notarization. The spec's "recommend (a) for releases"
  underestimates by an order of magnitude. Option (c) require-Bun + runtime-provision fits the
  universal wheel better but pushes failures to runtime.
- **Termux & nix: unaddressed.** Termux is a heavily-coded first-class path
  (`main.py:1579-1664`); Bun/OpenTUI almost certainly **can't run there** (no Android native
  lib). nix (`nix/tui.nix`, `nix/checks.nix:210`) needs a sibling derivation; `bun build` is
  sandbox-hostile. Both permanently fork the engine matrix.
- **Windows = hard blocker on flipping default / Phase 6.** No Windows-arm64 Bun; PTY bridge is
  POSIX-only (`pty_bridge.py`); Bun bootstrap inherits `node-bootstrap.sh`'s **bash-only**
  design (`_ensure_tui_node` runs `bash -c`) — doesn't exist on stock Windows. → Windows is
  "Ink-forever," so the fork **cannot be retired** while Windows is supported.
- **`stage2-hook.sh` needs 4 touch points** (build-time chown `Dockerfile:197`, runtime chown
  `:245-251`, a writable Bun cache in the seed list `:307-319`, always-build-or-guard), kept in
  lockstep with #28851/#35027.
- **Failure modes ranked:** S1 missing/wrong-arch native lib (hard crash, **no fallback** —
  fix: auto-fall-back to the never-removed Ink engine) → S2 Bun version skew (no floor in
  `_bun_bin`) → **S3 PTY bridge lazy `bun install` racing in Docker = rebirth of the #28851 502
  bug** (fix: OpenTUI Docker path must be fully prebuilt, never lazy-install) → S4 universal
  wheel ships wrong-arch lib → S5 silent Windows/Termux bootstrap no-op (fix: `_resolve_tui_engine`
  refuses `opentui` on Win/Termux up front) → S6 nix sealed-store resolution.

## 14. [REVIEW] Revised required-next-step (supersedes §6 Phase 0 start)

Before ANY launcher/build work, run **three parity spikes under Bun** — these are the kill
criteria:
1. **Nested-`<Text>` flattening** — render a real markdown paragraph with nested bold/dim/inline
   spans + parent `wrap-trim`; diff vs Ink.
2. **NoSelect exclusion** — prove OpenTUI's selection can exclude arbitrary cell ranges from
   `getSelectedText()` (gutter glyphs must NOT copy).
3. **Composer click-drag** — mouse-down + drag selection with local-cell coordinates in a
   `<textarea>`/input.
If any spike can't reach faithful parity, the shim becomes a second renderer maintained on top
of OpenTUI → re-evaluate the whole project against its "shed the fork" motivation.
