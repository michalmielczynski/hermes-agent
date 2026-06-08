// Message model — a trimmed mirror of ui-tui/src/types.ts `Msg`.
// Phase 2: extended to carry streaming + tool-call indicators emitted by the
// real gateway event stream (see src/gateway/eventAdapter.ts).
import type { Role } from './theme.ts'

export interface Msg {
  role: Role
  text: string
  kind?: 'slash' | 'trail' | 'diff'
  thinking?: string
  /** Tool indicator labels (e.g. "terminal", "read_file") attached to a turn. */
  tools?: string[]
  /** True while the assistant reply is still streaming in. */
  streaming?: boolean
}
