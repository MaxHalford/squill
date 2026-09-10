export const MONO_FONT_IDS = ['ibm-plex-mono', 'rec-mono-linear'] as const

export type MonoFontId = typeof MONO_FONT_IDS[number]

export const MONO_FONT_OPTIONS: ReadonlyArray<{ id: MonoFontId; label: string }> = [
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono' },
  { id: 'rec-mono-linear', label: 'Rec Mono Linear' },
]

const fontLoads = new Map<MonoFontId, Promise<unknown>>()
let latestRequest = 0

const loadFont = (font: MonoFontId): Promise<unknown> => {
  const existing = fontLoads.get(font)
  if (existing) return existing

  const load = font === 'ibm-plex-mono'
    ? Promise.all([
        import('@fontsource/ibm-plex-mono/latin-400.css'),
        import('@fontsource/ibm-plex-mono/latin-400-italic.css'),
        import('@fontsource/ibm-plex-mono/latin-500.css'),
        import('@fontsource/ibm-plex-mono/latin-600.css'),
        import('@fontsource/ibm-plex-mono/latin-700.css'),
      ])
    : import('@fontsource-variable/recursive/mono.css')

  fontLoads.set(font, load)
  return load
}

export const applyMonoFont = async (font: MonoFontId): Promise<void> => {
  const request = ++latestRequest

  try {
    await loadFont(font)
    if (request === latestRequest) {
      document.documentElement.dataset.monoFont = font
    }
  } catch (error) {
    fontLoads.delete(font)
    console.error(`Failed to load ${font}:`, error)
  }
}
