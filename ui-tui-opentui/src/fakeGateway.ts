// FakeGateway — Phase 0 stand-in for the real gatewayClient/rpc transport.
// Emits a representative transcript and can stream an assistant reply so the
// native view can be exercised without a Python tui_gateway behind it.
import type { Msg } from './model.ts'

export type Listener = (msgs: Msg[]) => void

const SEED: Msg[] = [
  { role: 'user', text: 'how do I switch the TUI to opentui?' },
  {
    role: 'assistant',
    text:
      'You build a **native** OpenTUI view layer and keep the renderer-agnostic logic. ' +
      'The Ink engine stays as the *default*; OpenTUI runs behind `HERMES_TUI_ENGINE=opentui`.\n\n' +
      'Key points:\n' +
      '- `domain/`, `protocol/`, stores and `gatewayClient` are **reused**.\n' +
      '- The ~10k LOC of `.tsx` is **rewritten** against `@opentui/react`.\n' +
      '- `wrap-trim` and ANSI parsing become native span emitters.'
  },
  { role: 'tool', text: '$ bun src/entry.opentui.tsx\nrenderer 120x32 — frame ok (3.2ms)' },
  { role: 'system', text: 'engine=opentui · runtime=bun · phase=0 skeleton' }
]

export class FakeGateway {
  private msgs: Msg[] = [...SEED]
  private listeners = new Set<Listener>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.msgs)

    return () => this.listeners.delete(fn)
  }

  private emit() {
    const snapshot = [...this.msgs]

    for (const fn of this.listeners) {
      fn(snapshot)
    }
  }

  /** Simulate a user submit + streamed assistant reply. onDone fires at end. */
  send(text: string, onDone?: () => void): void {
    this.msgs = [...this.msgs, { role: 'user', text }]
    this.emit()

    const reply =
      'Native OpenTUI reply to: *' + text + '*. ' + 'This text streams token-by-token to exercise incremental render.'

    const words = reply.split(' ')
    let i = 0
    const idx = this.msgs.length
    this.msgs = [...this.msgs, { role: 'assistant', text: '', streaming: true }]
    this.emit()

    const timer = setInterval(() => {
      i++
      const partial = words.slice(0, i).join(' ')
      const next = [...this.msgs]
      next[idx] = { role: 'assistant', text: partial, streaming: i < words.length }
      this.msgs = next
      this.emit()

      if (i >= words.length) {
        clearInterval(timer)
        onDone?.()
      }
    }, 60)
  }
}
