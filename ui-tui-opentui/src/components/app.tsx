import { useKeyboard, useRenderer } from '@opentui/react'
// Native OpenTUI app shell — header + transcript + composer. Phase 2: works with
// BOTH FakeGateway and the real request()-based gateway via a generic interface.
import React, { useCallback, useEffect, useState } from 'react'

import type { Msg } from '../model.ts'
import { defaultTheme } from '../theme.ts'

import { Composer } from './composer.tsx'
import { Transcript } from './transcript.tsx'

/** The minimal contract both FakeGateway and RealGateway satisfy. */
export interface Gateway {
  subscribe(fn: (msgs: Msg[]) => void): () => void
  send(text: string, onDone?: () => void): void
  /** Optional: real transport exposes a status line. */
  getStatus?(): { ready: boolean; text: string }
}

export function App({ gw, cols = 80, rows = 24 }: { gw: Gateway; cols?: number; rows?: number }) {
  const t = defaultTheme
  const renderer = useRenderer()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => gw.subscribe(setMsgs), [gw])

  // Ctrl+C quits (renderer created with exitOnCtrlC:false so we own cleanup).
  useKeyboard(key => {
    if (key.ctrl && key.name === 'c') {
      renderer.destroy()
      process.exit(0)
    }
  })

  const onSubmit = useCallback(
    (text: string) => {
      if (busy) {
        return
      }
      setBusy(true)
      gw.send(text, () => setBusy(false))
    },
    [gw, busy]
  )

  const status = gw.getStatus?.()
  const statusText = busy ? 'streaming…' : (status?.text ?? 'ready')

  const headerH = 1
  const composerH = 2
  const bodyH = Math.max(1, rows - headerH - composerH)

  return (
    <box style={{ flexDirection: 'column', width: cols, height: rows }}>
      <box
        style={{
          flexDirection: 'row',
          height: headerH,
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: '#1A1A1A'
        }}
      >
        <text fg={t.color.accent}>
          <b>hermes</b>
        </text>
        <text fg={t.color.muted}>{`  ·  engine=opentui · bun · ${statusText}`}</text>
      </box>

      <box style={{ height: bodyH }}>
        <Transcript cols={cols} msgs={msgs} t={t} />
      </box>

      <Composer busy={busy} cols={cols} focused={!busy} onSubmit={onSubmit} t={t} />
    </box>
  )
}
