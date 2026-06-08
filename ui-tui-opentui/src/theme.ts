// Phase 0: minimal theme for the OpenTUI native engine.
// Mirrors the SHAPE of ui-tui/src/theme.ts (the reuse layer) — in Phase 2 we
// path-import the real theme. Kept tiny here so the skeleton runs standalone.

export interface ThemeColors {
  text: string
  muted: string
  label: string
  accent: string
  border: string
  ok: string
  error: string
}

export interface Theme {
  color: ThemeColors
  brand: { prompt: string; tool: string }
}

export const defaultTheme: Theme = {
  color: {
    text: '#E0E0E0',
    muted: '#8A8A8A',
    label: '#FFD580',
    accent: '#8BD5CA',
    border: '#5C6370',
    ok: '#98C379',
    error: '#E06C75'
  },
  brand: { prompt: '>', tool: '✦' }
}

// Role glyph/color mapping — mirrors ui-tui/src/domain/roles.ts
export type Role = 'assistant' | 'system' | 'tool' | 'user'

export function roleStyle(role: Role, t: Theme): { glyph: string; prefix: string; body: string } {
  switch (role) {
    case 'assistant':
      return { glyph: t.brand.tool, prefix: t.color.border, body: t.color.text }

    case 'user':
      return { glyph: t.brand.prompt, prefix: t.color.label, body: t.color.label }

    case 'tool':
      return { glyph: '⚡', prefix: t.color.muted, body: t.color.muted }

    case 'system':
      return { glyph: '·', prefix: t.color.muted, body: t.color.muted }
  }
}
