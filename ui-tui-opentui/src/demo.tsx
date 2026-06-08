// Headless verifier for the INTERACTIVE app: mounts the app, simulates a user
// submit via the gateway, lets it stream, and captures the resulting 2D frame.
// Proves the Phase-1 submit→stream→render path without a live TTY.
// Run: bun src/demo.tsx → demo-frame.txt + demo-report.txt
import '@opentui/react/runtime-plugin-support'

import { writeFileSync } from 'node:fs'

import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'

import { App } from './components/app.tsx'
import { FakeGateway } from './fakeGateway.ts'

const COLS = 90
const ROWS = 28

const { renderer, renderOnce, flush, captureCharFrame } = await createTestRenderer({
  width: COLS,
  height: ROWS
})

const gw = new FakeGateway()
const t0 = performance.now()
createRoot(renderer).render(<App cols={COLS} gw={gw} rows={ROWS} />)
await renderOnce()
await flush()
await new Promise(r => setTimeout(r, 150))
await renderOnce()
await flush()
const t1 = performance.now()

// Simulate a user submitting a message; let the streamed reply complete.
const done = new Promise<void>(resolve => gw.send('does interactive work?', resolve))
await done

// A few render cycles to let the final streamed state settle into the frame.
for (let k = 0; k < 4; k++) {
  await new Promise(r => setTimeout(r, 80))
  await renderOnce()
  await flush()
}

const frame = captureCharFrame()
writeFileSync(new URL('../demo-frame.txt', import.meta.url), frame)

const report = [
  `rendered ${COLS}x${ROWS}; first paint ${(t1 - t0).toFixed(2)}ms`,
  `frame chars: ${frame.length}`,
  `header present: ${frame.includes('hermes')}`,
  `seed transcript present: ${frame.includes('switch the TUI')}`,
  `user submit echoed: ${frame.includes('does interactive work?')}`,
  `streamed reply present: ${frame.includes('Native OpenTUI reply')}`,
  `composer present: ${frame.includes('Ctrl+C') || frame.includes('streaming')}`,
  `tool box present: ${frame.includes('bun src/entry')}`,
  `literal markdown markers leaked (**): ${(frame.match(/\*\*/g) || []).length}`
].join('\n')

writeFileSync(new URL('../demo-report.txt', import.meta.url), report + '\n')

renderer.destroy()
process.exit(0)
