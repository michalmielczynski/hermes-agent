// Shared env bootstrap for the REAL gateway transport.
//
// Two responsibilities:
//   1. Force HERMES_PYTHON_SRC_ROOT to THIS worktree root, so the spawned
//      gateway runs this checkout's tui_gateway/ source. (The real GatewayClient
//      otherwise resolves the root relative to its own file location, which is
//      wrong when we import it from a sibling package.)
//   2. Pin HERMES_PYTHON to *the python that runs Hermes* — deterministically,
//      not by guessing. If we leave it unset, the GatewayClient's own fallback
//      chain ends at bare `python` on PATH (often a system python WITHOUT hermes
//      deps), which dies with `ModuleNotFound: dotenv`.
//
// Python resolution order (mirrors scripts/run_tests.sh and AGENTS.md):
//   HERMES_PYTHON / PYTHON   (explicit override — respected as-is)
//   VIRTUAL_ENV/bin/python   (an activated venv)
//   <worktree>/.venv         (dev venv, if present)
//   <worktree>/venv          (alt dev venv)
//   ~/.hermes/hermes-agent/venv   (the INSTALLED runtime venv — worktrees share
//                                  this; it is the python the `hermes` launcher
//                                  shebang points at)
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** Resolve the hermes repo root (parent of ui-tui-opentui/) and verify it. */
export function resolveRepoRoot(): string {
  // import.meta.dirname here is .../ui-tui-opentui/src/gateway
  const root = resolve(import.meta.dirname, '../../..')

  if (!existsSync(resolve(root, 'tui_gateway'))) {
    throw new Error(
      `repo root sanity check failed: no tui_gateway/ under ${root}. ` + `Set HERMES_PYTHON_SRC_ROOT manually.`
    )
  }

  return root
}

/**
 * Resolve the python that runs Hermes, in priority order. Returns the first
 * candidate that exists on disk. An explicit HERMES_PYTHON/PYTHON wins even if
 * we can't stat it (the user asked for it; let the client surface the error).
 */
export function resolveHermesPython(root: string): string | null {
  const explicit = process.env.HERMES_PYTHON?.trim() || process.env.PYTHON?.trim()

  if (explicit) {
    return explicit
  }

  const home = process.env.HERMES_HOME?.trim() || resolve(homedir(), '.hermes')
  const venv = process.env.VIRTUAL_ENV?.trim()

  const candidates = [
    venv && resolve(venv, 'bin/python'),
    venv && resolve(venv, 'Scripts/python.exe'),
    resolve(root, '.venv/bin/python'),
    resolve(root, '.venv/bin/python3'),
    resolve(root, 'venv/bin/python'),
    resolve(root, 'venv/bin/python3'),
    // The installed runtime venv — worktrees share this; it's what the `hermes`
    // launcher shebang uses, so it always has hermes deps.
    resolve(home, 'hermes-agent/venv/bin/python3'),
    resolve(home, 'hermes-agent/venv/bin/python')
  ].filter((p): p is string => Boolean(p))

  return candidates.find(p => existsSync(p)) ?? null
}

/**
 * Set HERMES_PYTHON_SRC_ROOT + HERMES_PYTHON on process.env. Returns the
 * resolved root. Safe to call multiple times. Throws with actionable guidance
 * if no Hermes python can be found.
 */
export function bootstrapGatewayEnv(): string {
  const root = resolveRepoRoot()
  process.env.HERMES_PYTHON_SRC_ROOT = root

  const python = resolveHermesPython(root)

  if (!python) {
    const home = process.env.HERMES_HOME?.trim() || resolve(homedir(), '.hermes')
    throw new Error(
      'Could not find the Python that runs Hermes.\n' +
        'Looked for (in order): $HERMES_PYTHON, $PYTHON, $VIRTUAL_ENV, ' +
        `${root}/.venv, ${root}/venv, ${home}/hermes-agent/venv.\n\n` +
        'Fix one of:\n' +
        '  • export HERMES_PYTHON=/path/to/hermes/venv/bin/python\n' +
        '  • install Hermes (its runtime venv lives at ~/.hermes/hermes-agent/venv)\n' +
        `  • create a dev venv at ${root}/.venv and install hermes (uv sync)\n`
    )
  }

  process.env.HERMES_PYTHON = python

  return root
}
