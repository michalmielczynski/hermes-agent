import type { GatewayEvent } from '../../../ui-tui/src/gatewayTypes.ts'
import type { Msg } from '../model.ts'

// Native event→state adapter for the REAL gateway.
//
// Subscribes to the GatewayClient's inherited EventEmitter ('event') and folds
// the streamed GatewayEvent union (../../ui-tui/src/gatewayTypes.ts) into a flat
// `Msg[]` that the OpenTUI app already knows how to render. This is a fresh,
// minimal reducer — it deliberately does NOT import the Ink turnController or
// createGatewayEventHandler (that richer logic is Phase 3).
//
// Events are shaped { type, payload, session_id }. The payload (not the event
// root) carries the data fields.
import type { GatewayClient } from './realGateway.ts'

export type Listener = (msgs: Msg[]) => void

/** A tiny status line the adapter exposes alongside the transcript. */
export interface AdapterStatus {
  ready: boolean
  /** Last status.update / error text, or a transport note. */
  text: string
}

export class EventAdapter {
  private msgs: Msg[] = []
  private listeners = new Set<Listener>()
  private status: AdapterStatus = { ready: false, text: 'connecting…' }
  /** Index of the in-flight assistant message, or -1 when none is open. */
  private liveIdx = -1
  private unsub: (() => void) | null = null

  constructor(private gw: GatewayClient) {}

  /** Wire up to the gateway's 'event' emitter. Call once, after gw.start(). */
  attach(): void {
    const handler = (ev: GatewayEvent) => this.reduce(ev)
    this.gw.on('event', handler)
    this.unsub = () => this.gw.off('event', handler)
  }

  detach(): void {
    this.unsub?.()
    this.unsub = null
  }

  getStatus(): AdapterStatus {
    return this.status
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.snapshot())

    return () => this.listeners.delete(fn)
  }

  /** Append a locally-known message (e.g. the user's own prompt on submit). */
  pushUser(text: string): void {
    this.msgs = [...this.msgs, { role: 'user', text }]
    this.emit()
  }

  private snapshot(): Msg[] {
    return [...this.msgs]
  }

  private emit(): void {
    const snap = this.snapshot()

    for (const fn of this.listeners) {
      fn(snap)
    }
  }

  private setStatus(patch: Partial<AdapterStatus>): void {
    this.status = { ...this.status, ...patch }
  }

  /** Ensure an in-flight assistant Msg exists; returns its index. */
  private ensureLive(): number {
    if (this.liveIdx >= 0 && this.msgs[this.liveIdx]?.role === 'assistant') {
      return this.liveIdx
    }

    this.msgs = [...this.msgs, { role: 'assistant', text: '', streaming: true }]
    this.liveIdx = this.msgs.length - 1

    return this.liveIdx
  }

  private patchLive(patch: Partial<Msg>): void {
    const i = this.ensureLive()
    const next = [...this.msgs]
    next[i] = { ...next[i]!, ...patch }
    this.msgs = next
  }

  private reduce(ev: GatewayEvent): void {
    const p = (ev as { payload?: Record<string, unknown> }).payload ?? {}

    switch (ev.type) {
      case 'gateway.ready': {
        this.setStatus({ ready: true, text: 'ready' })
        this.emit()

        break
      }

      case 'message.start': {
        // Begin a fresh assistant message.
        this.msgs = [...this.msgs, { role: 'assistant', text: '', streaming: true }]
        this.liveIdx = this.msgs.length - 1
        this.emit()

        break
      }

      case 'message.delta': {
        // Ink uses `text` and APPENDS (turnController.ts:655-668): `rendered`
        // is *incremental Rich ANSI*, NOT plain text — appending it injects raw
        // escape codes into OpenTUI's span text. Prefer `text`; fall back to
        // `rendered` only if `text` is absent.
        const chunk = (p.text as string) ?? (p.rendered as string) ?? ''

        if (!chunk) {
          break
        }
        const i = this.ensureLive()
        this.patchLive({ text: (this.msgs[i]!.text ?? '') + chunk, streaming: true })
        this.emit()

        break
      }

      case 'message.complete': {
        // Ink prioritises `text ?? rendered` (turnController.ts:566): `rendered`
        // is Rich-ANSI for non-markdown terminals and garbles a markdown view.
        const finalText = (p.text as string) ?? (p.rendered as string)
        const patch: Partial<Msg> = { streaming: false }

        if (typeof finalText === 'string' && finalText.length > 0) {
          patch.text = finalText
        }
        this.patchLive(patch)
        this.liveIdx = -1
        this.setStatus({ text: 'ready' })
        this.emit()

        break
      }

      case 'thinking.delta':
      case 'reasoning.delta': {
        const chunk = (p.text as string) ?? ''

        if (!chunk) {
          break
        }
        const i = this.ensureLive()
        this.patchLive({ thinking: (this.msgs[i]!.thinking ?? '') + chunk })
        this.emit()

        break
      }

      case 'tool.start': {
        const name = (p.name as string) ?? 'tool'
        const i = this.ensureLive()
        const tools = [...(this.msgs[i]!.tools ?? []), name]
        this.patchLive({ tools })
        this.setStatus({ text: `running ${name}…` })
        this.emit()

        break
      }

      case 'tool.complete': {
        const name = (p.name as string) ?? 'tool'
        const error = p.error as string | undefined
        const resultText = (p.result_text as string) ?? (p.summary as string) ?? ''
        const head = error ? `✗ ${name}: ${error}` : `$ ${name}`
        const body = resultText ? `\n${resultText}` : ''
        this.msgs = [...this.msgs, { role: 'tool', text: head + body }]
        this.setStatus({ text: 'ready' })
        this.emit()

        break
      }

      case 'status.update': {
        const text = (p.text as string) ?? ''

        if (text) {
          this.setStatus({ text })
        }

        // Keep status.update out of the transcript; it's a status line only.
        break
      }

      case 'error': {
        const message = (p.message as string) ?? 'unknown error'
        this.msgs = [...this.msgs, { role: 'system', text: `error: ${message}` }]
        this.setStatus({ text: `error: ${message}` })
        this.emit()

        break
      }

      case 'gateway.stderr': {
        const line = (p.line as string) ?? ''

        // Don't spam the transcript; surface as status so the verifier can see it.
        if (line) {
          this.setStatus({ text: `stderr: ${line.slice(0, 120)}` })
        }

        break
      }

      case 'gateway.start_timeout': {
        const tail = (p.stderr_tail as string) ?? ''
        this.msgs = [...this.msgs, { role: 'system', text: `gateway start timeout${tail ? `\n${tail}` : ''}` }]
        this.setStatus({ text: 'gateway start timeout' })
        this.emit()

        break
      }

      case 'gateway.protocol_error': {
        this.setStatus({ text: 'protocol error' })

        break
      }

      default:
        // Minimal Phase-2 reducer: the rest of the GatewayEvent union
        // (../../../ui-tui/src/gatewayTypes.ts) is intentionally dropped here.
        //
        // Cosmetic / deferred to richer turn logic (Phase 3+) — safe to ignore:
        //   session.info, skin.changed, status-ish notifications
        //   (notification.show/clear), voice.* , browser.progress,
        //   tool.progress, tool.generating, review.summary, background.complete,
        //   subagent.* , and reasoning.available (the full-snapshot sibling of
        //   reasoning.delta — appending it would double the reasoning text, so
        //   the delta path above is authoritative and this variant is dropped).
        //
        // ⚠️ Needed for a fully usable session — these are the real Phase-4 gap:
        //   clarify.request / approval.request / sudo.request / secret.request.
        //   These are interactive REQUESTS: the Python agent blocks until the
        //   client answers via the matching *.respond RPC (clarify.respond,
        //   approval.respond, sudo.respond, secret.respond — see
        //   ../../../ui-tui/src/gatewayClient.ts). With no handler + no UI to
        //   answer, any turn that triggers a tool approval or a clarifying
        //   question will hang the agent. The "say hi" demo never triggers them,
        //   which is why Phase 2 passes; a real agentic task can deadlock.
        //   Wiring these (prompt overlays + the respond RPCs) is spec §6 Phase 4.
        break
    }
  }
}
