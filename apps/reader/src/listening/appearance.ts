import type { Settings, TypographyConfiguration } from '../state'

export interface ListeningAppearanceChoice {
  preset: 'comfortable' | 'large' | 'compact' | 'reading'
  theme: 'light' | 'dark' | 'sepia' | 'reading'
}

export interface ListeningAppearance {
  fontSize: number
  lineHeight: number
  fontFamily: string
  fontWeight: number
  theme: 'light' | 'dark' | 'sepia'
}

export const defaultListeningAppearance: ListeningAppearanceChoice = {
  preset: 'comfortable',
  theme: 'light',
}

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export function normalizeListeningAppearance(
  choice?: ListeningAppearanceChoice,
): ListeningAppearanceChoice {
  return {
    preset: ['comfortable', 'large', 'compact', 'reading'].includes(
      choice?.preset || '',
    )
      ? choice!.preset
      : 'comfortable',
    theme: ['light', 'dark', 'sepia', 'reading'].includes(choice?.theme || '')
      ? choice!.theme
      : 'light',
  }
}

function readingFontSize(size: unknown) {
  if (typeof size === 'number') return size
  if (typeof size !== 'string') return 22
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*(px|%|em|rem)?$/i)
  if (!match) return 22
  const number = Number(match[1])
  return match[2] === '%'
    ? (number / 100) * 16
    : ['em', 'rem'].includes(match[2]?.toLowerCase() || '')
    ? number * 16
    : number
}

/** Resolve once when launching. Never change the active narration DOM to apply a preset. */
export function resolveListeningAppearance(
  requested?: ListeningAppearanceChoice,
  global: Settings = {},
  book: TypographyConfiguration = {},
  dark = false,
): ListeningAppearance {
  const choice = normalizeListeningAppearance(requested)
  const effective = {
    ...global,
    ...Object.fromEntries(
      Object.entries(book).filter(([, value]) => value !== undefined),
    ),
  }
  const preset = {
    comfortable: { fontSize: 22, lineHeight: 1.75 },
    large: { fontSize: 28, lineHeight: 1.85 },
    compact: { fontSize: 18, lineHeight: 1.55 },
    reading: {
      fontSize: clamp(readingFontSize(effective.fontSize), 16, 48, 22),
      lineHeight: clamp(Number(effective.lineHeight ?? 1.75), 1.2, 2.5, 1.75),
    },
  }[choice.preset]
  return {
    ...preset,
    fontFamily:
      choice.preset === 'reading' &&
      typeof effective.fontFamily === 'string' &&
      effective.fontFamily
        ? effective.fontFamily
        : "Georgia, 'Times New Roman', serif",
    fontWeight:
      choice.preset === 'reading'
        ? clamp(Number(effective.fontWeight ?? 400), 100, 900, 400)
        : 400,
    theme:
      choice.theme === 'reading' ? (dark ? 'dark' : 'light') : choice.theme,
  }
}

export function savedReaderAppearance() {
  let settings: Settings = {}
  let scheme = 'system'
  try {
    settings = JSON.parse(localStorage.getItem('settings') || '{}') || {}
    scheme = JSON.parse(
      localStorage.getItem('literal-color-scheme') || '"system"',
    )
  } catch {
    // A malformed preference must not prevent opening the book.
  }
  const dark =
    scheme === 'dark' ||
    (scheme === 'system' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  return { settings, dark }
}
