import { useCallback, useEffect, useState } from 'react'

// The colour theme: light or dark. Until someone picks one, the app shows whichever the device is set to (and keeps following it,
// for example at sunset); the first click on the Theme button saves a choice, and from then on that choice wins. The choice is a
// display preference, not account data, so it lives in this browser's localStorage only. The dark palette itself is in index.css;
// this file only decides when it is on, by putting the "dark" class on <html>.
//
// index.html runs a tiny copy of the same rule before the page paints, so a dark-mode reader never sees a flash of light. The two
// are tested against each other (theme.test.ts).

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'joblogga-theme'
export const THEMES: readonly Theme[] = ['light', 'dark']
export const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark' }
export const NEXT_THEME: Record<Theme, Theme> = { light: 'dark', dark: 'light' }

// The page and browser-chrome colours (the <meta name="theme-color"> follows the theme, so a phone's address bar matches).
export const CHROME_COLOR = { light: '#ffffff', dark: '#0f151b' } as const

// Storage can be missing or throw (private windows, blocked site data), and can hold anything: only a known value counts,
// and anything else (including the old "system" value) means no choice has been made.
export function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return THEMES.includes(value as Theme) ? (value as Theme) : null
  } catch {
    return null
  }
}

export function storeTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Not saved: the choice still applies until the page is closed.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

// The theme in effect: the saved choice, or else what the device prefers.
export const effectiveTheme = (saved: Theme | null, prefersDark: boolean): Theme => saved ?? (prefersDark ? 'dark' : 'light')

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? CHROME_COLOR.dark : CHROME_COLOR.light)
}

export function useTheme() {
  const [saved, setSaved] = useState<Theme | null>(storedTheme)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  const theme = effectiveTheme(saved, prefersDark)

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setSaved(next)
  }, [])

  // Apply whenever the theme in effect changes.
  useEffect(() => applyTheme(theme), [theme])

  // While no choice has been made, follow the device when it switches (sunset, a control-centre toggle).
  useEffect(() => {
    if (saved !== null || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setPrefersDark(systemPrefersDark())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [saved])

  return { theme, setTheme }
}
