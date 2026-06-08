// Native OpenTUI message row — maps FROM ui-tui/src/components/messageLine.tsx.
// Role gutter + body. Assistant body uses native Markdown spans; tool output
// renders in a bordered box; user/system are plain styled text.
import React from 'react'

import type { Msg } from '../model.ts'
import { roleStyle, type Theme } from '../theme.ts'

import { Markdown } from './markdown.tsx'

const GUTTER = 3

export function MessageLine({ msg, t, cols }: { msg: Msg; t: Theme; cols: number }) {
  const { glyph, prefix, body } = roleStyle(msg.role, t)
  const bodyWidth = Math.max(20, cols - GUTTER - 2)

  // Tool result: bordered box (maps messageLine.tsx tool branch)
  if (msg.role === 'tool') {
    return (
      <box style={{ flexDirection: 'row', marginTop: 1 }}>
        <box style={{ width: GUTTER }}>
          <text fg={prefix}>{glyph} </text>
        </box>
        <box
          border
          borderColor={t.color.muted}
          borderStyle="rounded"
          style={{ paddingLeft: 1, paddingRight: 1, alignSelf: 'flex-start' }}
        >
          <text fg={t.color.muted}>{msg.text}</text>
        </box>
      </box>
    )
  }

  const isAssistant = msg.role === 'assistant'

  return (
    <box style={{ flexDirection: 'row', marginTop: msg.role === 'user' ? 1 : 0 }}>
      <box style={{ width: GUTTER }}>
        <text fg={prefix}>{msg.role === 'user' ? <b>{glyph}</b> : glyph} </text>
      </box>
      <box style={{ width: bodyWidth, flexDirection: 'column' }}>
        {isAssistant ? (
          <Markdown t={t} text={msg.text || (msg.streaming ? '▍' : '')} width={bodyWidth} />
        ) : (
          <text fg={body || t.color.text}>{msg.text}</text>
        )}
        {isAssistant && msg.streaming && msg.text ? <text fg={t.color.muted}>▍</text> : null}
      </box>
    </box>
  )
}
