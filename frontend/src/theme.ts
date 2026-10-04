import { useCallback, useEffect, useState } from 'react'

// The colour theme. "system" (the default) follows the device's light/dark setting and keeps following it; "light" and "dark"
// are the person's own choice and override it. The choice is a display preference, not account data, so it lives in this
// browser's localStorage only. The dark palette itself is in index.css; this file only decides when it is on, by putting the
// "dark" class on <html>.
//
// index.html runs a tiny copy of applyTheme before the page paints, so a dark-mode reader never sees a flash of light. The two
// are tested against each other (theme.test.ts).

export type Theme = 'system' | 'light' | 'dark'

export const THEME_KEY = 'joblogga-theme'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']
export const THEME_LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }
// One button steps through them in this order, and system comes back round, so there is a way back to following the device.
export const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

// The page and browser-chrome colours (the <meta name="theme-color"> follows the theme, so a phone's address bar matches).
export const CHROME_COLOR = { light: '#f4efe5', dark: '#161a18' } as const

// Storage can be missing or throw (private windows, blocked site data), and can hold anything: only a known value counts.
export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return THEMES.includes(value as Theme) ? (value as Theme) : 'system'
  } catch {
    return 'system'
  }
}

export function storeTheme(theme: Theme) {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_KEY) // the default needs no entry
    else window.localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Not saved: the choice still applies until the page is closed.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const isDark = (theme: Theme, prefersDark: boolean) => theme === 'dark' || (theme === 'system' && prefersDark)

export function applyTheme(theme: Theme) {
  const dark = isDark(theme, systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? CHROME_COLOR.dark : CHROME_COLOR.light)
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(storedTheme)

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])

  // Apply whenever the choice changes, and, while following the system, whenever the device switches (sunset, a control-centre toggle).
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  return { theme, setTheme }
}
