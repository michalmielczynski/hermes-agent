// LIVE interactive entry — real TTY, alternate screen. Run: bun src/entry.opentui.tsx
// Phase 1: native OpenTUI Hermes TUI skeleton (transcript + composer + streaming).
// NOTE: deliberately Bun-native; does NOT use node:v8 / --expose-gc (per spec §4).
import '@opentui/react/runtime-plugin-support'

import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import React from 'react'

import { App } from './components/app.tsx'
import { FakeGateway } from './fakeGateway.ts'

if (!process.stdin.isTTY) {
  console.log('hermes-tui-opentui: no TTY (run in a real terminal, or use `bun src/demo.tsx`)')
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
const gw = new FakeGateway()

createRoot(renderer).render(<App cols={cols} gw={gw} rows={rows} />)

// Keep the app sized to the terminal.
renderer.on('resize', (w: number, h: number) => {
  createRoot(renderer).render(<App cols={w} gw={gw} rows={h} />)
})

// Safety net: restore the terminal on unexpected exit.
const cleanup = () => {
  try {
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
