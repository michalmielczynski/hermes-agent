# Feasibility: Replace `hermes-ink` with OpenTUI in `ui-tui/`

**Status:** Feasibility + spike. **No implementation done.** This doc exists to be grilled.
**Date:** 2026-06-08
**Author:** Hermes (for glitch)
**Repo:** `ui-tui/` (worktree `lively-thrush`)

---

## 0. TL;DR for the impatient

- **It is technically possible.** OpenTUI has a React binding (`@opentui/react`) with a
  reconciler, `<box>`/`<text>/<scrollbox>`, keyboard/paste/selection hooks, custom
  stdin/stdout streams (the dashboard PTY path), OSC52 clipboard, alternate-screen,
  resize — i.e. most of what `hermes-ink` gives us.
- **The blocking fact, proven by spike:** OpenTUI's native core **does not run on
  standard Node.** It requires **Bun** (or a Node build with experimental FFI flags that
  Node 22 here does not have). Today the TUI ships as `node dist/entry.js`. Adopting
  OpenTUI means **switching the TUI runtime from Node to Bun** everywhere it is launched.
- **This is not a swap, it is a rewrite** of the rendering substrate *and* a runtime
  migration. Rough size: ~39k LOC of app (`ui-tui/src`, 28 `.tsx`) re-targeted onto a new
  element/prop/event model, plus deletion of ~27k LOC of forked Ink (`packages/hermes-ink`,
  139 files), plus changes to the Python launcher, build, Docker, dashboard PTY bridge, and
  `profile-tui.py`.
- **Recommendation:** Do **not** start the migration on the strength of "OpenTUI is nicer."
  The decision hinges on one question — **are we willing to make Bun a hard runtime
  dependency for the TUI?** If no → stop here. If yes → proceed to a *second* spike that
  ports one real screen (the chat transcript) end-to-end before committing to the full port.

---

## 1. What we have today (the honest inventory)

The TUI is a theater production with two layers:

| Layer | Path | Size | What it is |
|---|---|---|---|
| **The app** | `ui-tui/src/` | ~39k LOC, 28 `.tsx` | The actual Hermes TUI: transcript, composer, approvals, session picker, spinner, overlays. React/JSX. **47 files import `@hermes/ink`.** |
| **The stage** | `ui-tui/packages/hermes-ink/` | ~27k LOC, 139 files | A **forked, heavily-customized copy of Ink** — our own react-reconciler → terminal escape codes, Yoga layout, custom `ScrollBox`, mouse tracking, ANSI selection/copy, OSC52, hyperlink hover, alternate-screen, truecolor forcing, termio parser. |

`hermes-ink` is **not a thin shim.** It is a rendering engine we forked precisely because
upstream Ink couldn't do scrollback / selection / mouse / truecolor the way the TUI needs.

### Runtime + build facts (verified)

- Launched as **`node dist/entry.js`** (see `scripts/profile-tui.py:11`, `hermes_cli`
  wrapper). `node -v` here = **v22.22.2**, `bun -v` = **1.3.13**.
- Built with **esbuild** into a single self-contained `dist/entry.js`
  (`ui-tui/scripts/build.mjs`); `@hermes/ink` is bundled *from source* (not its prebuilt
  bundle) due to an esbuild `__esm` async-init quirk.
- Docker rebuilds `dist/entry.js` on TUI launch when source mtime is newer
  (`docker/stage2-hook.sh:215`), needs write perms on `ui-tui/dist/`.
- The **dashboard** embeds the *real* `hermes --tui` over a PTY bridge
  (`hermes_cli/pty_bridge.py` + xterm.js in the browser). Any renderer must drive a
  **custom stdout** (not a raw TTY). hermes-ink does; OpenTUI can too (verified).
- A second module-resolution wrinkle exists for the *Python* gateway subprocess
  (`HERMES_PYTHON_SRC_ROOT`) — unrelated to the renderer but part of the launch surface.

### API surface `ui-tui/src` actually consumes from `@hermes/ink`

Core (must map 1:1): `Box`, `Text`, `Link`, `ScrollBox` + `ScrollBoxHandle`, `Ink` /
`renderSync`, `useInput`, `useApp`, `useStdin`, `useStdout`, `useSelection` /
`useHasSelection`, `useTerminalTitle`, `Key`, `InputEvent`, `FrameEvent`,
`MouseTrackingMode`, `AlternateScreen`, `NoSelect`.

Low-level (custom, the risky part): `forceRedraw`, `evictInkCaches`, `withInkSuspended`,
`scrollFastPathStats`, `isXtermJs`, `Ansi`, `stringWidth`, `wrapAnsi`,
`RunExternalProcess`.

---

## 2. The spike (real execution, not speculation)

Temp project `/tmp/otui-spike`, `npm install @opentui/core @opentui/react react`
(installed clean, 21 pkgs, pulled `@opentui/core-linux-x64` native package).

### Spike result 1 — Node ❌

```
$ node spike.mjs
[spike] importing @opentui/core ...
[spike] RESULT: FAILURE
Error: bun-ffi-structs requires Bun or Node.js with node:ffi enabled
       (--experimental-ffi --allow-ffi).
```

`node --experimental-ffi --allow-ffi spike.mjs` → `node: bad option: --experimental-ffi`
(Node 22 does not ship that flag). **Standard Node cannot load OpenTUI's native core.**

### Spike result 2 — Bun ✅

Same spike, same custom `PassThrough` stdin/stdout (the dashboard/PTY shape):

```
$ bun spike2.mjs   # results written to file because native renderer hijacks console
import OK
renderer created w=80 h=24
bytes_to_custom_stdout=3327      <- real frames rendered to a CUSTOM stdout
osc52_supported=false            <- API present (false because PassThrough isn't a real term)
SUCCESS
```

**Conclusion:** OpenTUI is fully functional under Bun, including the custom-stream path the
dashboard needs. It is a hard no under stock Node.

---

## 3. hermes-ink → OpenTUI mapping & gap analysis

| hermes-ink feature | OpenTUI equivalent | Risk |
|---|---|---|
| `<Box>` / `<Text>` / flexbox (Yoga) | `<box>` / `<text>`, Yoga layout | **Low** — concepts match, but **props differ** (`borderStyle`, `fg`/`bg`, `style` prop). Every component edited. |
| `<Link>` | `<a>` text modifier | Low |
| `ScrollBox` + handle + fast-path | `<scrollbox>` | **Medium** — our custom scroll fast-path (`scrollFastPathStats`) is a perf hack OpenTUI won't replicate identically; behavior parity must be re-validated. |
| `useInput` + `parse-keypress` | `useKeyboard` (+ Kitty protocol) | **Medium** — different key event model; keymap rewrite. |
| `useStdin`/`useStdout`/`useApp` | `useRenderer`, renderer props | Low–Medium |
| `useSelection`/`useHasSelection` + ANSI copy | `useSelectionHandler` + `selection` event | **Medium** — selection model differs; copy/`NoSelect` semantics need re-impl. |
| OSC52 clipboard | `renderer.copyToClipboardOSC52` | Low (API exists) |
| `useTerminalTitle` | `renderer.setTerminalTitle` | Low |
| Alternate screen | `screenMode: "alternate-screen"` | Low |
| Custom stdout (dashboard PTY) | `createCliRenderer({ stdin, stdout })` | Low (**spike-proven**) |
| Resize | `useOnResize` / `renderer.resize` | Low |
| `forceRedraw` / `evictInkCaches` / `withInkSuspended` | renderer `requestRender`/`suspend`/`resume` + scrollback writers | **High** — these are bespoke escape hatches into *our* reconciler. No drop-in; each call site needs rethinking. |
| `isXtermJs`, truecolor forcing, termio parser | renderer `capabilities`, theme detection | **Medium** — we own a termio parser today; OpenTUI owns its own. Parity unknown until tested. |
| `RunExternalProcess` (suspend TUI, run external CLI) | `suspend()`/`resume()` | **Medium** — flow exists but must be re-wired. |
| Markdown / syntax (`src/lib/syntax.ts`) | `<markdown>`, `<code>` (Tree-sitter) | Medium — OpenTUI's are arguably *better*, but output will look different; a visual-parity pass is needed. |

**No showstopper gap on features** — the showstopper is the **runtime (Bun)**, not missing
capabilities.

---

## 4. Blast radius (what changes beyond `ui-tui/src`)

1. **Runtime swap Node→Bun** at every TUI entry point:
   - `hermes_cli` TUI launcher (`node dist/entry.js` → `bun ...`)
   - `scripts/profile-tui.py` (hard-codes `node dist/entry.js`)
   - `docker/stage2-hook.sh` (esbuild rebuild + perms; Bun must be in the image)
   - The Hermes installer / setup wizard (Bun becomes a TUI prerequisite)
2. **Build pipeline** — esbuild single-file bundle story changes; OpenTUI ships a native
   `.node`/Zig lib that **cannot** be bundled into one JS file. Distribution model changes
   (must ship/locate the native package, or `bun build --compile` standalone exe).
3. **Dashboard PTY bridge** (`pty_bridge.py` + `web_server.py` `/api/pty`) — must spawn Bun;
   the spike proves custom-stream rendering works, but the bridge command changes.
4. **Delete `packages/hermes-ink`** (~27k LOC) — large net deletion, but only *after* parity.
5. **Tests** — `ui-tui` vitest suite + hermes-ink's own tests (termio, selection, wrap)
   either deleted or rewritten against OpenTUI's test-renderer.
6. **Docs/AGENTS.md** TUI architecture section rewrite.

---

## 5. Effort & risk

- **Effort:** multi-week. Not a sprint. The 28 components are the visible work; the
  *invisible* work is re-achieving parity on selection, scrollback, mouse, truecolor,
  dashboard PTY, and the `forceRedraw`/`evictInkCaches` escape hatches.
- **Top risks:**
  1. **Bun as a hard dependency** for every Hermes user who wants the TUI (install size,
     platform coverage, Docker base image, Windows story). This is a *product* decision, not
     a code one.
  2. Regressing hard-won polish (ANSI selection/copy, scrollback fast-path, xterm.js
     dashboard parity) that currently lives in hermes-ink.
  3. Single-file `dist/entry.js` distribution model breaks (native lib can't inline).

---

## 6. Recommended path (matches your usual flow)

1. **Decide the Bun question first.** Everything below is moot if we won't make Bun a TUI
   runtime dependency. → *This is the grill target.*
2. If yes: **second spike** — port exactly one real screen (the chat transcript /
   `messageLine.tsx` path) onto `@opentui/react` under Bun, driven through a fake PTY, and
   diff it against the current render. Validate selection + scroll + resize on that one
   screen before believing the full port.
3. If the screen-spike holds: write a **migration spec** (component-by-component, runtime
   cutover, dashboard bridge, Docker, rollback plan) and validate it via parallel
   adversarial sub-agents on neutral briefs.
4. Only then: implement behind a flag (`HERMES_TUI_ENGINE=opentui`) so we can ship Node-Ink
   and Bun-OpenTUI side by side during the transition, with a clean rollback.

---

## 7. Open questions for you to answer / grill

1. **Are we willing to require Bun for the TUI?** (Hard gate.)
2. Do we keep Node-Ink as fallback (dual-engine flag) or hard-cut to OpenTUI?
3. What's the Windows + Docker + installer story for Bun?
4. Is the motivation perf, maintenance burden of the Ink fork, OpenTUI features
   (markdown/code/diff/tree-sitter), or something else? The motivation changes whether this
   is even worth it.
5. Distribution: standalone `bun build --compile` exe, or ship Bun + native lib?

---

## 8. Screen-level spike #2 — shim strategy (real execution)

The decisive architectural finding. Instead of rewriting all 47 files that import
`@hermes/ink`, build a **thin `@hermes/ink`-compatible shim backed by `@opentui/react`**
so consuming files barely change. Spiked exactly that under Bun.

`messageLine.tsx` (a real, representative transcript component) uses these prop shapes:
- `<Box flexDirection borderColor borderStyle marginLeft marginTop marginBottom paddingX alignSelf width onClick>`
- `<Text color wrap bold dim dimColor>`
- custom `<Ansi>`, `<NoSelect fromLeftEdge width>`

A ~40-line shim maps these onto OpenTUI `<box>`/`<text>`:

| Ink prop | OpenTUI |
|---|---|
| `flexDirection`, `marginLeft/Top/Bottom`, `alignSelf`, `width` | `style={{ ... }}` |
| `paddingX` | `style.paddingLeft` + `style.paddingRight` |
| `borderStyle="round"` | `border` + `borderStyle="rounded"` (name map) |
| `borderColor` | `borderColor` |
| `Text color` | `text fg` |
| `Text bold` / `dim` | `text attributes={{ bold }/{ dim }}` |

**Spike result (`/tmp/otui-spike/screen.mjs`, run under Bun):**

```
renderer 80x24
bytes=3543
contains_user_text=true
contains_border_glyph=true     <- ╭─╮ rounded border rendered
contains_glyph_marker=true     <- ✦ / > role glyphs rendered
SUCCESS
```

Stripped frame dump (`/tmp/otui-spike/dump.mjs` → `frame.ansi`):

```
>   how do I switch the TUI to opentui?
✦   You build a shim that maps Ink props to OpenTUI.
    ╭────────────────────────────╮
    │ $ npm test ... 1822 passed │
    ╰────────────────────────────╯
```

**Takeaway:** The migration concentrates in **one adapter module**, not 47 file rewrites.
This dramatically lowers effort and risk and makes a flag-gated dual-engine rollout
realistic.

### Residual gaps the shim does NOT solve for free (the hard 20%)

These are real Ink-API features with no automatic OpenTUI equivalent — each needs design:

1. **`wrap="truncate-end"` / wrap modes** — OpenTUI `<text>` wraps by default; truncation
   modes (`truncate-start/middle/end`, `middle`) must be re-implemented or pre-truncated in
   JS before render.
2. **`<Ansi>`** — we render raw ANSI-coded text (tool output, system Rich markup) inline.
   OpenTUI text takes styled spans, not embedded ANSI escape codes. Needs an ANSI→span
   parser (we already own one in `hermes-ink/src/ink/termio` — could be ported standalone).
3. **`<NoSelect>` + `fromLeftEdge`** — selection-exclusion regions (gutter glyphs excluded
   from copy). Maps to OpenTUI's selection model but semantics differ; must verify copy
   output excludes gutters.
4. **`onClick` on `<Box>`** (the collapsible system-message toggle) — OpenTUI uses mouse
   events on focusable renderables; rewire needed.
5. **`dimColor` vs `dim`** — Ink distinguishes; OpenTUI uses an attribute. Cosmetic but
   needs a visual-parity pass.
6. **Layout default width** — in `main-screen` mode, OpenTUI boxes without explicit width
   expand full-width (visible as padding gaps in the dump). Real components pass
   `width`/`flexDirection`, so this is a prop-completeness chore, not a blocker.

### Updated recommendation

The shim strategy de-risks the *code* side substantially. The decision still hinges on the
**Bun runtime gate (§7 Q1)**. If Bun is acceptable, the realistic plan is:

1. Build the `@hermes/ink`→OpenTUI shim module (the adapter) + port the termio ANSI parser
   standalone.
2. Flag-gate: `HERMES_TUI_ENGINE=opentui` selects shim+OpenTUI+Bun; default stays
   Node+Ink. Ship both during transition.
3. Validate the 6 residual gaps on the chat-transcript screen first, then expand.
4. Delete `packages/hermes-ink` only after full parity under the flag.

---

### Spike artifacts (reproducible)

- `/tmp/otui-spike/spike.mjs` — Node attempt (fails with the FFI error above)
- `/tmp/otui-spike/spike2.mjs` — Bun render-to-custom-stdout proof (writes `result.txt`)
- `/tmp/otui-spike/screen.mjs` — Ink-shim → OpenTUI transcript-row render proof under Bun
- `/tmp/otui-spike/dump.mjs` — dumps the rendered frame to `frame.ansi` for visual parity
