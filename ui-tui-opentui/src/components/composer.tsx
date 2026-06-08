// Native OpenTUI composer — single-line input wired to submit.
// Maps FROM ui-tui/src/components/textInput.tsx (Phase 1 minimal: no multiline,
// history, or paste yet). Uses OpenTUI's native <input> (focus + cursor + Enter).
import React from 'react'

import type { Theme } from '../theme.ts'

export function Composer({
  t,
  cols,
  onSubmit,
  focused,
  busy
}: {
  t: Theme
  cols: number
  onSubmit: (text: string) => void
  focused: boolean
  busy: boolean
}) {
  return (
    <box style={{ flexDirection: 'column' }}>
      <text fg={t.color.border}>{'─'.repeat(cols)}</text>
      <box style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}>
        <text fg={t.color.label}>
          <b>{'> '}</b>
        </text>
        <input
          cursorColor={t.color.accent}
          focused={focused}
          // The `as never` is REQUIRED, not lazy. @opentui/react's JSX namespace
          // declares `IntrinsicElements extends React.JSX.IntrinsicElements`, so
          // `<input>` inherits BOTH OpenTUI's `onSubmit: (value: string) => void`
          // AND React's HTML `onSubmit: FormEventHandler`. The two intersect into
          // a call signature no concrete handler satisfies (string & FormEvent),
          // so the prop must be cast. The runtime delivers the input string
          // (see node_modules/@opentui/react InputProps.onSubmit). No cleaner
          // typed overload exists while the namespace extends React's intrinsics.
          onSubmit={
            ((value: string) => {
              const text = (typeof value === 'string' ? value : '').trim()

              if (text) {
                onSubmit(text)
              }
            }) as never
          }
          placeholder={busy ? 'streaming…' : 'Type a message, Enter to send · Ctrl+C to quit'}
          style={{ flexGrow: 1 }}
          textColor={t.color.text}
        />
      </box>
    </box>
  )
}
