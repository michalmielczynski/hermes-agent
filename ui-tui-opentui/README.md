# hermes-tui-opentui (Phases 0–2)

Native **OpenTUI** engine for the Hermes TUI — a second engine that runs on **Bun**.
The Ink engine (`../ui-tui/`) stays the default and is untouched. See the spec at
`../docs/plans/opentui-native-rewrite-spec.md`.

> **Build model:** there is **no build step** — Bun runs the `.tsx` directly. But OpenTUI loads a
> per-platform native lib (`@opentui/core-<os>-<arch>`) that can't be inlined, so the package is
> Bun-only and platform-specific (Windows/Termux can't run it → Ink there). Contrast Ink:
> `esbuild` → `dist/entry.js` → `node`.

## Run it interactively (real terminal)

```bash
cd ui-tui-opentui
bun install          # first time
bun start            # == bun src/entry.opentui.tsx  → live TUI in your terminal
```

- Type a message, **Enter** to send.
- Watch the assistant reply **stream** in (FakeGateway, no real backend yet).
- **Ctrl+C** quits.

> Needs a real TTY. In a non-interactive shell it prints a notice and exits.

## Verify headless (CI / non-TTY)

```bash
bun src/demo.tsx       # FakeGateway path → demo-frame.txt + demo-report.txt
bun src/demo.real.tsx  # REAL gateway path → demo-real-frame.txt + demo-real-report.txt
```

`demo-frame.txt` is the true 2D character grid; `demo-report.txt` is the checklist.

## Dev-quality rails

```bash
bun run type-check   # tsc --noEmit (0 errors)
bun run lint         # eslint (mirrors ../ui-tui rules; warnings allowed, errors fail)
bun run fix          # lint:fix + prettier
bun run check        # local CI: type-check + lint + both demos (scripts/check.sh)
```

`bun run check` is the one-shot gate. Its real-gateway stage auto-skips when no Hermes python is
resolvable (so it's safe in CI without API keys); force-skip with `HERMES_OPENTUI_SKIP_REAL=1`.

## Run against the REAL Python gateway (Phase 2)

```bash
bun src/entry.real.tsx   # live TUI talking to a spawned `python -m tui_gateway.entry`
# or: bun run start:real
```

The real path-imports the renderer-agnostic `GatewayClient` from `../ui-tui/src`
(zero drift — no copy) and adapts its `request()`-based RPC + EventEmitter stream
into the same `{ subscribe, send }` interface the app already used for the fake.
`src/gateway/env.ts` sets `HERMES_PYTHON_SRC_ROOT` to this worktree root so the
spawned gateway runs **this** checkout's `tui_gateway/`.

## Status

- **Phase 0** ✓ — native transcript (markdown→spans, role gutters, tool boxes, scrollbox).
- **Phase 1** ✓ — interactive composer (`<input>`), submit→stream→render, sticky auto-scroll,
  Ctrl+C quit. Backed by `FakeGateway` (no Python yet).
- **Phase 2** ✓ — REAL transport: path-imported `GatewayClient` spawns a live
  `tui_gateway` subprocess; `src/gateway/eventAdapter.ts` folds the streamed
  `GatewayEvent` union into `Msg[]`; verified end-to-end with a real reply.
- **Next** — Phase 3: richer turn logic (subagents, todos, approvals) via the
  Ink `turnController` / `createGatewayEventHandler`.

## Layout

| Path | Role |
|---|---|
| `src/entry.opentui.tsx` | live TTY entry — FakeGateway |
| `src/entry.real.tsx` | live TTY entry — REAL gateway (sets `HERMES_PYTHON_SRC_ROOT`) |
| `src/demo.tsx` | headless verifier — FakeGateway |
| `src/demo.real.tsx` | headless verifier — REAL gateway (hard 60s timeout) |
| `src/gateway/realGateway.ts` | path-imports real `GatewayClient`; `{subscribe,send}` adapter |
| `src/gateway/eventAdapter.ts` | minimal `GatewayEvent` → `Msg[]` reducer |
| `src/gateway/env.ts` | repo-root + python env bootstrap for the real client |
| `src/components/app.tsx` | shell; accepts a generic `Gateway` interface |
| `src/components/composer.tsx` | native `<input>` → submit |
| `src/components/transcript.tsx` | sticky-bottom `<scrollbox>` of rows |
| `src/components/messageLine.tsx` | role gutter + body + tool box |
| `src/components/markdown.tsx` | native markdown → `<span>` |
| `src/fakeGateway.ts` | stand-in gateway (seed + streamed reply) |
| `src/{model,theme}.ts` | trimmed mirrors of ui-tui types/theme |
