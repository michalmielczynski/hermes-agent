# Spec v3: Native OpenTUI TUI — second engine, rewrite-not-shim

**Status:** Active spec. Supersedes the shim architecture in `opentui-migration-spec.md`.
**Date:** 2026-06-08
**Author:** Hermes (for glitch)
**Lineage:**
- `opentui-migration-feasibility.md` — proved OpenTUI needs Bun; Node fails; native render works.
- `opentui-migration-spec.md` (v1/v2) — the **shim** design + 3 adversarial reviews. The
  launcher/distribution findings there (§11–§14) **still apply** and are carried forward here.
  The shim itself is **abandoned** per the decision below.

---

## 0. The pivot (decision from glitch)

> "I'm OK rewriting TS. Leave the Ink TUI as-is and shipping. Make headway into OpenTUI —
> map *from* the Ink TUI as the spec, but build the OpenTUI one as native and as performant as
> possible. I'm OK testing and maintaining the OpenTUI TUI; we can learn."

**Abandon the shim.** A `@hermes/ink`-compatible shim tried to make OpenTUI *impersonate* Ink's
reconciler — which the adversarial review showed is the hard, low-value 20% (nested-Text style
cascade, per-cell NoSelect mask, reconciler-coordinate mouse events). Instead:

- **Reuse** the renderer-agnostic logic layer (~7k+ LOC of `.ts`).
- **Rewrite** the view layer (~10k LOC of `.tsx`, 23 components) **natively** against
  `@opentui/react`, using OpenTUI's own primitives and idioms.
- **Ink stays untouched and remains the default engine.** The OpenTUI app is a new, parallel,
  first-class TUI. End state is **dual-engine, possibly forever** (Windows/Termux keep Ink).

**Motivation (restated honestly):** render perf + stop investing in the Ink fork + OpenTUI is
forward-facing. NOT "delete the fork" — Windows can't run Bun reliably (review §13), so Ink is
the legacy/fallback engine. OpenTUI becomes the **primary, forward-facing** engine.

---

## 1. The two layers (the line that makes this tractable)

Measured from the real tree (`ui-tui/src`):

### REUSE — renderer-agnostic, port with ~zero changes
- `src/domain/**` (413 LOC) — message model, roles, blockLayout, details, slash, usage, viewport.
- `src/protocol/**` — interpolation, paste.
- `src/app/*Store.ts`, `turnController.ts`, `turnStore.ts`, `gatewayContext` logic,
  `createGatewayEventHandler.ts`, `createSlashHandler.ts`, `slash/registry.ts`, `slash/commands/**`.
- `gatewayClient.ts`, `rpc.ts` — JSON-RPC transport to the Python `tui_gateway` (engine-blind).
- `theme.ts` (already a *local copy*, not an Ink import — see its header comment), `content/**`,
  most of `lib/**` pure utils (fuzzy, text, emoji, history, syntax, reasoning, subagentTree…).

### REWRITE — view layer, authored natively in OpenTUI
- All 23 `.tsx` in `src/components/**` + `src/app.tsx` + `src/app/*.tsx`.
- The **shallow** Ink coupling in a few `.ts` files (audited — all easy):
  | File | Ink import | Native replacement |
  |---|---|---|
  | `lib/inputMetrics.ts` | `stringWidth`, `wrapAnsi` (pure utils) | OpenTUI's width util or a vendored `string-width`/`wrap-ansi` |
  | `lib/wheelAccel.ts` | `isXtermJs` | OpenTUI `renderer.capabilities` / env check |
  | `lib/viewportStore.ts`, `app/scroll.ts`, `app/interfaces.ts`, `hooks/useVirtualHistory.ts` | `type ScrollBoxHandle`, `type MouseTrackingMode` | OpenTUI `<scrollbox>` handle types |
  | `app/useInputHandlers.ts` | `forceRedraw`, `useInput` | `renderer.requestRender()`, `useKeyboard` |
  | `app/useComposerState.ts` | `useStdin`, `withInkSuspended` | `useRenderer`, `renderer.suspend()/resume()` |
  | `lib/memoryMonitor.ts` | deferred `evictInkCaches` | OpenTUI cache-eviction or drop (Bun GC differs) |

**Net:** ~10k LOC view rewrite + untangle ~8 thin `.ts` couplings. The ~7k LOC logic core is kept.

---

## 2. Where the OpenTUI app lives

New top-level sibling package: **`ui-tui-opentui/`** (NOT inside `ui-tui/`, to keep Ink pristine
and avoid npm/bun toolchain collisions in one tree — review §11 P6 flagged shared-tree build
races).

**Actual on-disk layout (verified Phase 0–2; reconciled with this spec in the 2026-06-08
hardening pass — the earlier tree below was the *proposal*, this is what landed):**

```
ui-tui-opentui/
  package.json            # bun, @opentui/core, @opentui/react, react; scripts incl. lint/fmt/check
  tsconfig.json           # jsxImportSource: @opentui/react; types: [node, bun]
  eslint.config.mjs       # mirrors ../ui-tui/eslint.config.mjs rule style (hardening pass)
  .prettierrc             # mirrors ../ui-tui/.prettierrc (hardening pass)
  scripts/check.sh        # type-check + lint + both headless demos (local CI; hardening pass)
  src/
    entry.opentui.tsx     # live TTY bootstrap, FakeGateway (NOT node:v8 — review §11 P3) ✓
    entry.real.tsx        # live TTY bootstrap, RealGateway (sets HERMES_PYTHON_SRC_ROOT) ✓
    demo.tsx              # headless verifier (FakeGateway) → demo-frame.txt/demo-report.txt ✓
    demo.real.tsx         # headless verifier (real gateway + model call) → demo-real-*.txt ✓
    components/           # native view: app, transcript, messageLine, markdown, composer ✓
    gateway/              # REAL-gateway transport glue: realGateway, eventAdapter, env ✓
    {model,theme,fakeGateway}.ts  # trimmed local mirrors (replaced by reuse in Phase 3)
```

**Divergences from the original proposal, and their resolutions (canonical decisions):**
- **`engine/` vs `gateway/`.** The proposal put OpenTUI helpers under `src/engine/`. Reality:
  no `engine/` exists yet, and the Phase-2 transport glue landed in **`src/gateway/`**. These are
  *different concerns* and the canonical split is: **`gateway/` = JSON-RPC transport / event
  reduction** (exists now — `realGateway.ts`, `eventAdapter.ts`, `env.ts`); **`engine/` = native
  OpenTUI *rendering* helpers** (ansiToSpans, selection, mouse, scroll) — still a Phase-4 dir that
  has not been created because no rendering helper has been factored out yet. Keep both names;
  do not collapse transport into `engine/`.
- **`src/app.tsx` → `src/components/app.tsx`.** The app shell lives under `components/` with the
  other view files, not at `src/` top level. Canonical.
- **No `bunfig.toml`.** Not needed: Bun runs `.tsx` directly using `tsconfig.json`'s
  `jsxImportSource`. Add one only if a runtime alias/preload becomes necessary.
- **No `shared/` symlink.** Logic reuse is direct relative path-import
  (`../../../ui-tui/src/<logic>`), not a symlink and not tsconfig path aliases. See below.

**Logic reuse mechanism — DECIDED (was an open Phase-0 choice).** Chose **(a) path-import** from
`../ui-tui/src/<logic>` (plain relative imports; e.g. `gateway/realGateway.ts` imports
`../../../ui-tui/src/gatewayClient.ts`, `eventAdapter.ts` imports `../../../ui-tui/src/gatewayTypes.ts`).
Zero copy, zero drift, type-checks clean. Option (b) — extracting a shared `ui-tui-core/`
workspace package — remains the long-term cleanup once the OpenTUI app stabilizes and the reuse
surface (domain/protocol/stores/turnController) is broad enough to justify it.

---

## 3. Native OpenTUI view patterns (replacing the shim's "hard 20%")

These are no longer impedance-match problems — they're "use OpenTUI as designed":

1. **Rich text** — author `<text>` with `<span>`/`<b>`/`<i>`/`<u>`/`<a>` children (OpenTUI's
   inline model) instead of nested `<Text>`. The Ink markdown renderer's *output structure* is
   the spec; the *implementation* is native spans.
2. **`<Ansi>` (tool output / Rich markup)** — port the pure parser (`Ansi.tsx::parseToSpans`,
   already isolated) to emit OpenTUI spans → `engine/ansiToSpans.ts`. Pure function, no reconciler.
3. **Gutter non-selection** — design with OpenTUI's `selectable`/selection model from scratch
   (mark gutter renderables non-selectable) rather than retrofitting a per-cell mask.
4. **Mouse / composer** — build on OpenTUI `useKeyboard` + mouse events natively; the composer
   (`textarea`) uses OpenTUI's `<textarea>`/`<input>` where it fits, custom where it doesn't.
5. **Scroll / virtual history** — OpenTUI `<scrollbox>` + a native virtualization approach;
   re-derive from `useVirtualHistory.ts`'s *logic*, not its Ink `ScrollBoxHandle` calls.
6. **Wrapping** — keep `wrap-text.ts`'s pure algorithms (`wrap-trim` etc.) as utils; apply at
   OpenTUI's resolved layout width.
7. **Markdown/code/diff** — evaluate OpenTUI's native `<markdown>`/`<code>`/`<diff>` (tree-sitter)
   as *replacements* for our markdown renderer — potential perf + maintenance win (the motivation).

---

## 4. Launcher & runtime (carried from v2 review — STILL REQUIRED; anchors re-verified 2026-06-08)

This is Phase 3 and is **not yet implemented** — the OpenTUI app is launched manually via `bun`.
The design below is the concrete plan, with the spawn sites **re-verified against the current
tree** during the hardening pass (the v2 review's line numbers had drifted).

### The two TUI spawn sites — and where the argv vs env cutovers actually are

There are exactly **two** places that spawn the Ink TUI today, and they relate differently than
the v2 review assumed:

| Site | What it is | Calls `_make_tui_argv`? | Sets the V8 heap cap itself? |
|---|---|---|---|
| `_launch_tui()` — `hermes_cli/main.py:1781` | CLI `hermes --tui` | yes, at **main.py:1905** | yes — **main.py:1890–1893** |
| `_resolve_chat_argv()` — `hermes_cli/web_server.py:8479` | dashboard "Chat" PTY bridge (`/api/pty` ws handler at web_server.py:8635 → calls it at 8693) | yes, at **web_server.py:8504** | **no** (only `os.environ.copy()`) |

**Key correction to the v2 framing.** The **argv** cutover is effectively *single-point*: BOTH
sites build their argv through `_make_tui_argv(tui_dir, tui_dev)` (`main.py:1530`), so branching
*there* gives the dashboard the OpenTUI argv for free. What is NOT shared is the **V8 heap-cap
env**, which only `_launch_tui` sets (main.py:1890–1893); the dashboard never sets it. So the
shared helper is needed on the **env** side, not the argv side.

### The cutover points (concrete)

1. **`_resolve_tui_engine()`** — resolve engine from `HERMES_TUI_ENGINE` (env) + `display.tui_engine`
   (config); **`ink` default**. **Refuses `opentui` on Windows/Termux** up front, falling back to
   ink with a clear message (review §13 S5).

2. **Branch at the TOP of `_make_tui_argv` (`main.py:1530`), above `_ensure_tui_node()` (L1532)**
   (review §11 P6). When `engine=="opentui"` → `_make_opentui_argv(root)`:
   - calls **`_ensure_tui_bun()`** instead of `_ensure_tui_node()`;
   - returns `([bun, str(root/"ui-tui-opentui/src/entry.opentui.tsx")], root/"ui-tui-opentui")`.
   - **No `node`, no `--expose-gc`, no built `dist/entry.js`.** The Ink path bakes
     `[node, "--expose-gc", <entry.js>]` at main.py:1569 & 1575 — both V8-specific; Bun runs the
     `.tsx` directly with no build step. Because both spawn sites route through here, the dashboard
     PTY bridge inherits the `[bun, …]` argv automatically.

3. **`_apply_tui_engine_env(env, engine)` — the shared ENV helper**, called by BOTH sites:
   - In **`_launch_tui`**: *replaces* the inline `--max-old-space-size` merge at **main.py:1890–1893**.
     For `engine=="ink"` it does today's merge; for `engine=="opentui"` it does NOT add any
     `--max-old-space-size` (see §JSC note below) and strips a V8-only one from an inherited
     `NODE_OPTIONS` so Bun/JSC doesn't choke or error.
   - In **`_resolve_chat_argv`** (web_server.py, right after the `os.environ.copy()` at 8505):
     call it too, so a user's exported `NODE_OPTIONS=--max-old-space-size=…` is stripped before it
     reaches a Bun child (the dashboard doesn't set the cap, but it does inherit the environment).

   > **JSC note (why this matters):** Bun uses JavaScriptCore, not V8. `--max-old-space-size` and
   > `--expose-gc` are **V8 flags** — meaningless under Bun, and `--expose-gc` in `NODE_OPTIONS`
   > makes even Node refuse to start. So every V8 knob must be gated on `engine=="ink"`.

4. **Bun bootstrap:** `_ensure_tui_bun()` + `scripts/lib/bun-bootstrap.sh`; `HERMES_BUN` override;
   min-version floor in `_bun_bin()` (review §13 S2). Engine-parameterize artifact/lockfile checks
   (`bun.lock`/`bun.lockb`, not `package-lock.json`) (review §11 P4/P5). NOTE: the current dev
   package uses a text `bun.lock`.

5. **`entry.opentui.tsx` bootstrap** re-implements lifecycle/memory for Bun — NO `node:v8`,
   NO `--expose-gc` assumptions; degrade heap-dump/OOM-attribution with a documented gap or a
   Bun-native equivalent (review §11 P3). (The current entry already avoids `node:v8`/`--expose-gc`.)

6. **Auto-fallback:** on OpenTUI launch failure (missing/wrong native lib), fall back to the
   never-removed Ink engine (review §13 S1).

## 5. Distribution (carried from v2 review — unchanged realities)

**Load-bearing architecture fact (why distribution is fundamentally different from Ink).**
Ink builds: `esbuild` → a single `dist/entry.js` → run by `node` (real build step, in
`_make_tui_argv`). OpenTUI has **NO build step** — `bun` runs the `.tsx` directly — BUT it loads a
**per-platform native Zig library** (`@opentui/core-linux-x64`, `-darwin-arm64`, …) that **cannot
be inlined** into a JS bundle. So distribution must ship/require *both* Bun *and* the right native
lib for the platform; you can never produce one arch-neutral OpenTUI artifact the way Ink's
`dist/entry.js` is arch-neutral JS.

- pip wheel stays `py3-none-any`; OpenTUI is **runtime-provisioned** (require Bun + lazy-install
  `@opentui/*`, which pulls the correct per-arch native lib), never wheel-bundled wrong-arch
  (review §13 S4). Dev/checkout: `bun` runs TS directly.
- Docker: OpenTUI path **fully prebuilt at image build, never lazy-install in container**
  (review §13 S3 — avoids the #28851 race rebirth); add Bun + native lib + writable Bun cache +
  chown touch points (review §13).
- Termux: OpenTUI unsupported (no Android native lib) → Ink only. nix: separate derivation, off
  by default. Windows: Ink-forever.

---

## 6. Phasing

- **Phase 0 — Standalone native skeleton (no Python yet).** `ui-tui-opentui/` scaffold; a
  `FakeGateway` emitting representative `Msg[]`; render the **transcript** screen natively
  (markdown spans, role gutters, tool-result boxes) under `bun`. *Exit:* transcript renders
  natively + reads visually faithful to Ink; perf measured.
- **Phase 1 — Composer + input.** Native composer (textarea), `useKeyboard`, submit flow wired to
  FakeGateway. *Exit:* type, submit, see streamed assistant reply.
- **Phase 2 — Real gateway.** Path-import the logic layer; wire `gatewayClient`/`rpc` to a real
  `tui_gateway` subprocess (still launched manually via `bun`). *Exit:* a real session works.
- **Phase 3 — Launcher integration.** `HERMES_TUI_ENGINE` flag + `_make_opentui_argv` +
  `_apply_tui_engine_env` + `entry.opentui.tsx` bootstrap + auto-fallback. *Exit:*
  `HERMES_TUI_ENGINE=opentui hermes --tui` launches it.
- **Phase 4 — Parity sweep.** Remaining screens (overlays, pickers, prompts, agents, skills,
  todo, thinking, diff, ANSI tool output, selection/copy, scroll/virtual-history).
- **Phase 5 — Dashboard + Docker.** PTY bridge over Bun (prebuilt), Docker image.
- **Phase 6 — Perf validation + promote.** Benchmark vs Ink (the motivation). If it wins, make
  `opentui` the default on supported platforms; Ink stays as Windows/Termux/fallback.

Each phase is independently demoable. Ink ships untouched throughout.

---

## 7. Test & perf strategy
- OpenTUI app gets its own Bun/vitest suite; the Ink suite stays green untouched.
- Frame-diff harness: render the same `Msg[]` fixtures under both engines to a custom stdout,
  normalize cursor noise, compare (seed: feasibility `dump.mjs`).
- Perf: measure transcript render + scroll FPS vs Ink early (Phase 0/6) — it's the justification.

---

## 8. Open decisions (grill targets)
1. ~~Logic reuse: path-import vs extract `ui-tui-core/` workspace?~~ **RESOLVED: path-import now**
   (direct relative imports, zero copy — see §2). `ui-tui-core/` extraction deferred to when the
   reuse surface is broad enough to justify a workspace package.
2. Adopt OpenTUI native `<markdown>`/`<code>`/`<diff>` vs port our renderers? (Lean: try native — perf.)
   *Still open* — Phase 0–2 use a hand-written minimal `markdown.tsx`; native components unevaluated.
3. ~~`ui-tui-opentui/` as sibling vs a workspace under `ui-tui/`?~~ **RESOLVED: sibling package**
   (toolchain isolation — Ink stays npm/esbuild, OpenTUI stays bun; no shared-tree build races).
4. How faithful must visual parity be vs "native OpenTUI look"? (glitch wants native+performant —
   so parity is a *spec/reference*, not a pixel mandate.) *Still open.*

---

## 9. Immediate next step
Build **Phase 0**: scaffold `ui-tui-opentui/`, a FakeGateway, and the native transcript screen;
run it under Bun; capture a frame + a perf number. No Python launcher changes yet.

---

## 10. Progress log
- **Phase 0 ✓** native transcript renders in true 2D under Bun (markdown spans, role gutters,
  tool box, scrollbox); first paint ~2ms. Verified via `createTestRenderer`+`captureCharFrame`.
- **Phase 1 ✓** interactive: live `entry.opentui.tsx` (real TTY), native `<input>` composer,
  submit→stream→render, sticky-bottom auto-scroll, Ctrl+C quit (FakeGateway backend).
- **Phase 2 ✓** real gateway: `src/gateway/{realGateway,eventAdapter,env}.ts` path-import the
  real renderer-agnostic `GatewayClient` (zero copy), spawn `python -m tui_gateway.entry`,
  submit via `prompt.submit` (after `session.create`), native event→Msg[] reducer.
  **Verified end-to-end** (`bun src/demo.real.tsx`): real model reply `✦ Hi there, glitch!`
  rendered. Parent-fixed two reducer bugs: `message.delta`/`message.complete` must prefer
  `text` over `rendered` (`rendered` is incremental Rich-ANSI; appending it garbles the
  markdown view — see `turnController.ts:566,664`).
  - Env gotcha handled: `HERMES_PYTHON_SRC_ROOT` forced to the worktree root in `env.ts` (the
    real client otherwise resolves it relative to its own file → wrong checkout).

- **Hardening pass ✓ (2026-06-08)** — senior-engineer foundation pass; NO new features, Ink
  untouched. Re-verified the Phase 0–2 claims by re-running the demos (not self-report):
  `bun run type-check` → 0 errors; `bun src/demo.tsx` → native transcript, 0 markdown markers
  leaked; `bun src/demo.real.tsx` → real reply `✦ Hi there, glitch!` end-to-end (python resolved
  to `~/.hermes/hermes-agent/venv`). All still green.

  - **Spec↔code reconciled (§2):** the proposed tree never fully landed. Resolutions written into
    §2 — canonical split is **`gateway/` = transport glue (exists)** vs **`engine/` = future
    rendering helpers (Phase 4, not yet created)**; `app.tsx` lives under `components/`; no
    `bunfig.toml`; no `shared/` symlink. Logic-reuse mechanism **decided = path-import** (§8 #1).

  - **§4 launcher anchors re-verified** against the current tree (v2 line numbers had drifted).
    Correction recorded: the **argv** cutover is single-point (`_make_tui_argv`, main.py:1530 —
    BOTH `_launch_tui` at main.py:1905 AND the dashboard `_resolve_chat_argv` at web_server.py:8504
    route through it), while the **V8 heap-cap env** is duplicated/only in `_launch_tui`
    (main.py:1890–1893). `_apply_tui_engine_env(env, engine)` is the shared **env** helper. Stale
    `web_server.py:8502` anchor corrected to `_resolve_chat_argv` @ 8479 / `/api/pty` @ 8635. Still
    Phase 3, unimplemented.

  - **Gateway event-catalog audit (`src/gateway/eventAdapter.ts` vs the live `GatewayEvent` union
    in `ui-tui/src/gatewayTypes.ts`).** The reducer is minimal *by design*. Breakdown:
    - **Handled (14):** `gateway.ready`, `message.start`, `message.delta`, `message.complete`,
      `thinking.delta`, `reasoning.delta`, `tool.start`, `tool.complete`, `status.update`, `error`,
      `gateway.stderr`, `gateway.start_timeout`, `gateway.protocol_error`.
    - **Ignored, cosmetic/deferred (safe):** `session.info`, `skin.changed`, `notification.show`,
      `notification.clear`, `voice.*`, `browser.progress`, `tool.progress`, `tool.generating`,
      `review.summary`, `background.complete`, `subagent.*` (6), and **`reasoning.available`** —
      the latter shares a union member with `reasoning.delta` but is the *full-snapshot* variant;
      the `switch` matches only `reasoning.delta`, so `reasoning.available` falls through (correct:
      appending it would double the reasoning text). The real demo *does* emit `reasoning.available`
      + `session.info`; both safely dropped today.
    - **⚠️ Ignored but NEEDED for a fully usable session (the real Phase-4 gap):**
      `clarify.request`, `approval.request`, `sudo.request`, `secret.request`. These are interactive
      REQUESTS — the Python agent **blocks** until the client answers via the matching `*.respond`
      RPC (`clarify.respond`/`approval.respond`/`sudo.respond`/`secret.respond`, see
      `ui-tui/src/gatewayClient.ts`). With no handler + no prompt UI, any turn that triggers a tool
      approval or clarifying question will **hang the agent**. The trivial "say hi" demo never
      triggers them (why Phase 2 passes), but real agentic tasks can deadlock. Wiring prompt overlays
      + the respond RPCs is **spec §6 Phase 4**. The `default:` branch in `eventAdapter.ts` now
      documents this explicitly so the gap is visible at the code.

  - **Dev-quality rails added (the package had only `type-check`):**
    - `eslint.config.mjs` mirroring `../ui-tui/eslint.config.mjs` (typescript-eslint, react,
      react-hooks, unused-imports, perfectionist; dropped the parent's `react-compiler` + no-op
      custom-rule shims). Scripts: `lint`, `lint:fix`, `fmt` (prettier), `fix`, `check`.
      `eslint`/`@eslint/js` pinned to `^9` for parity. After `bun run fix`: **0 errors**, 9
      stylistic `padding-line-between-statements` warnings (warn-level in the parent too).
    - `.prettierrc` mirroring the parent.
    - Killed the residual type-check noise (`@opentui/react/.../runtime-plugin-support-configure.ts
      Cannot find module 'bun'`) by adding `@types/bun` + `tsconfig.json types: ["node", "bun"]` →
      type-check now fully clean.
    - `scripts/check.sh` (`bun run check`): type-check + lint + both demos as local CI; the real
      demo auto-skips when no Hermes python is resolvable and passes on `PASS|TRANSPORT OK`.
    - `.gitignore`: closed the `demo-real-*.txt` gap via `demo-*.txt`/`demo-*.ansi` globs.
    - Verified RESOLVED items from Phase 2 still hold (text via `<b>`/`<i>` spans not
      `attributes={{…}}`, `markdown.tsx`→`../theme.ts`, `crashed` narrowing). The `<input onSubmit>`
      `as never` cast is **necessary, not lazy**: `@opentui/react`'s JSX namespace extends
      `React.JSX.IntrinsicElements`, so `<input>` intersects OpenTUI's `(value:string)=>void` with
      React's HTML `FormEventHandler` — no concrete handler satisfies both; comment in
      `composer.tsx` now records the root cause.

  - **Still untracked (decision for glitch):** `ui-tui-opentui/` + `docs/plans/` remain untracked
    on a detached HEAD; committing them is intentional but pending a branch decision.

### Subagent workflow note (for future phases)
OpenTUI implementation subagents MUST get the `skills` toolset AND be told to
`skill_view(name="opentui", file_path="references/docs/...")` before writing renderable code —
the full offline OpenTUI doc set lives in that skill. Phase 2 agents were given only
`file/search/terminal` and worked from parent-supplied context; acceptable for transport glue
but NOT for view/renderable work (markdown/code/diff/selection/scroll). Always include
`skills` for Phase 4+.
