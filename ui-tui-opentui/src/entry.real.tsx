// LIVE interactive entry for the REAL gateway — real TTY, alternate screen.
// Run: bun src/entry.real.tsx
// Phase 2: talks to a live Python `tui_gateway` subprocess via the path-imported
// renderer-agnostic GatewayClient (zero drift with the Ink package).
import '@opentui/react/runtime-plugin-support'

import { bootstrapGatewayEnv } from './gateway/env.ts'

// MUST run before importing/constructing the real client (it reads env on start).
bootstrapGatewayEnv()

import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import React from 'react'

import { App } from './components/app.tsx'
import { RealGateway } from './gateway/realGateway.ts'

if (!process.stdin.isTTY) {
  console.log('hermes-tui-opentui (real): no TTY (run in a real terminal, or use `bun src/demo.real.tsx`)')
  process.exit(0)
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false, // App handles Ctrl+C so we can clean up the terminal.
  screenMode: 'alternate-screen',
  useMouse: true,
  targetFps: 30
})

const cols = renderer.width
const rows = renderer.height
const gw = new RealGateway({ cols })
gw.start()

createRoot(renderer).render(<App cols={cols} gw={gw} rows={rows} />)

renderer.on('resize', (w: number, h: number) => {
  createRoot(renderer).render(<App cols={w} gw={gw} rows={h} />)
})

const cleanup = () => {
  try {
    gw.kill('entry.shutdown')
    renderer.destroy()
  } catch {
    // already torn down
  }
}

process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})
process.on('SIGHUP', () => {
  cleanup()
  process.exit(0)
})
