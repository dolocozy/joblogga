/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeToggle from './components/ThemeToggle'
import { applyTheme, CHROME_COLOR, effectiveTheme, storedTheme, storeTheme, systemPrefersDark, THEME_KEY } from './theme'
import type { Theme } from './theme'
import { mockList, mockUpcoming, renderApp, signIn } from './test/helpers'

const html = () => document.documentElement
const isDarkNow = () => html().classList.contains('dark')
const button = () => screen.getByRole('button', { name: /^Theme:/ })

/** A controllable `matchMedia`: the device's colour preference, which a test can flip like sunset would. */
function deviceTheme(initial: 'light' | 'dark') {
  let dark = initial === 'dark'
  const listeners = new Set<() => void>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  )
  return {
    switchTo(next: 'light' | 'dark') {
      dark = next === 'dark'
      act(() => listeners.forEach((fn) => fn()))
    },
    listenerCount: () => listeners.size,
  }
}

beforeEach(() => {
  document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#ffffff" />')
})
afterEach(() => vi.unstubAllGlobals())

describe('the saved choice', () => {
  it('is nothing when nothing is saved', () => {
    expect(storedTheme()).toBeNull()
  })

  it.each(['light', 'dark'] as const)('reads back %s', (value) => {
    localStorage.setItem(THEME_KEY, value)
    expect(storedTheme()).toBe(value)
  })

  it.each(['', 'Dark', 'blue', 'null', 'system', '{"theme":"dark"}'])('treats an unknown or old saved value %j as no choice', (value) => {
    localStorage.setItem(THEME_KEY, value)
    expect(storedTheme()).toBeNull()
  })

  it('saves the choice', () => {
    storeTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    storeTheme('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
  })

  it('survives storage that throws, both ways', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(storedTheme()).toBeNull()
    expect(() => storeTheme('dark')).not.toThrow()
    vi.restoreAllMocks()
  })
})

describe('which theme is in effect', () => {
  const cases: [Theme | null, boolean, Theme][] = [
    [null, false, 'light'], // no choice: follows the device
    [null, true, 'dark'],
    ['light', true, 'light'], // a choice beats the device
    ['dark', false, 'dark'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
  ]
  it.each(cases)('saved=%s with a device preferring dark=%s is %s', (saved, prefersDark, expected) => {
    expect(effectiveTheme(saved, prefersDark)).toBe(expected)
  })

  it('puts the class on <html> and matches the browser chrome colour to it', () => {
    deviceTheme('light')
    applyTheme('dark')
    expect(isDarkNow()).toBe(true)
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', CHROME_COLOR.dark)
    applyTheme('light')
    expect(isDarkNow()).toBe(false)
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', CHROME_COLOR.light)
  })
})

describe('the toggle', () => {
  it('starts on the device theme, and a dark device gets the dark theme without anyone choosing it', () => {
    deviceTheme('dark')
    render(<ThemeToggle />)
    expect(button()).toHaveTextContent('Theme: Dark')
    expect(isDarkNow()).toBe(true)
    expect(localStorage.getItem(THEME_KEY)).toBeNull() // nothing is saved until someone chooses
  })

  it('switches between light and dark, applying and saving each', async () => {
    const user = userEvent.setup()
    deviceTheme('dark')
    render(<ThemeToggle />)

    await user.click(button())
    expect(button()).toHaveTextContent('Theme: Light')
    expect(isDarkNow()).toBe(false) // overrides the dark device
    expect(localStorage.getItem(THEME_KEY)).toBe('light')

    await user.click(button())
    expect(button()).toHaveTextContent('Theme: Dark')
    expect(isDarkNow()).toBe(true)
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('says what a click will do', async () => {
    deviceTheme('light')
    render(<ThemeToggle />)
    expect(button()).toHaveAttribute('title', 'Switch to dark')
    await userEvent.setup().click(button())
    expect(button()).toHaveAttribute('title', 'Switch to light')
  })

  it('remembers the choice for the next visit', () => {
    deviceTheme('light')
    localStorage.setItem(THEME_KEY, 'dark')
    render(<ThemeToggle />)
    expect(button()).toHaveTextContent('Theme: Dark')
    expect(isDarkNow()).toBe(true)
  })

  it('keeps following the device until a choice is made, and stops once it is', async () => {
    const user = userEvent.setup()
    const device = deviceTheme('light')
    render(<ThemeToggle />)
    expect(isDarkNow()).toBe(false)

    device.switchTo('dark') // sunset
    expect(isDarkNow()).toBe(true)
    expect(button()).toHaveTextContent('Theme: Dark')
    device.switchTo('light')
    expect(isDarkNow()).toBe(false)

    await user.click(button()) // dark, chosen
    device.switchTo('light')
    expect(isDarkNow()).toBe(true) // the choice holds
    expect(device.listenerCount()).toBe(0) // and nothing is still listening
  })

  it('stops listening to the device when it goes away', () => {
    const device = deviceTheme('light')
    const { unmount } = render(<ThemeToggle />)
    expect(device.listenerCount()).toBe(1)
    unmount()
    expect(device.listenerCount()).toBe(0)
  })

  it('still switches for this visit when nothing can be saved', async () => {
    const user = userEvent.setup()
    deviceTheme('light')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<ThemeToggle />)
    await user.click(button())
    expect(button()).toHaveTextContent('Theme: Dark')
    expect(isDarkNow()).toBe(true)
    vi.restoreAllMocks()
  })

  it('copes with a browser that has no matchMedia at all', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<ThemeToggle />)
    expect(button()).toHaveTextContent('Theme: Light')
    expect(isDarkNow()).toBe(false)
  })
})

describe('the script that runs before the page paints', () => {
  const script = readFileSync(join(process.cwd(), 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
  const saved: (Theme | null)[] = [null, 'light', 'dark']

  for (const value of saved) {
    for (const prefersDark of [false, true]) {
      it(`agrees with the app for saved=${value} and a device preferring dark=${prefersDark}`, () => {
        deviceTheme(prefersDark ? 'dark' : 'light')
        if (value) localStorage.setItem(THEME_KEY, value)
        new Function(script)()
        const early = isDarkNow()
        html().classList.remove('dark')
        applyTheme(effectiveTheme(storedTheme(), systemPrefersDark()))
        expect(early).toBe(isDarkNow())
        expect(early).toBe(value === 'dark' || (value === null && prefersDark))
      })
    }
  }

  it('does not break the page when storage or matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => new Function(script)()).not.toThrow()
    expect(isDarkNow()).toBe(false)
    vi.restoreAllMocks()
  })

  it('also sets the browser chrome colour', () => {
    deviceTheme('dark')
    new Function(script)()
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', CHROME_COLOR.dark)
  })
})

describe('where the toggle is', () => {
  it('is in the header of every signed-in page, and switching it darkens the whole app', async () => {
    const user = userEvent.setup()
    deviceTheme('light')
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/applications')
    await screen.findByRole('heading', { name: 'Applications' })
    expect(isDarkNow()).toBe(false)

    await user.click(button()) // dark
    expect(isDarkNow()).toBe(true)
  })

  it('is on the landing page', async () => {
    deviceTheme('light')
    renderApp('/')
    expect(await screen.findByRole('button', { name: /^Theme:/ })).toBeInTheDocument()
  })

  it.each(['/login', '/signup', '/forgot-password'])('is on the stand-alone page %s', async (path) => {
    deviceTheme('light')
    renderApp(path)
    expect(await screen.findByRole('button', { name: /^Theme:/ })).toBeInTheDocument()
  })

  it('keeps its choice when moving between pages', async () => {
    const user = userEvent.setup()
    deviceTheme('light')
    renderApp('/login')
    await user.click(await screen.findByRole('button', { name: /^Theme:/ })) // dark
    await user.click(screen.getByRole('link', { name: /sign up|create an account/i }))
    expect(await screen.findByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument()
    expect(isDarkNow()).toBe(true)
  })
})

describe('the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
  const block = (open: string) => {
    const start = css.indexOf(open)
    return css.slice(start, css.indexOf('\n}', start))
  }
  const colours = (text: string) => Object.fromEntries([...text.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]))
  const light = colours(block('@theme {'))
  const dark = colours(block(':root.dark {'))

  it('gives every colour a dark value, so a new colour cannot be forgotten', () => {
    const missing = Object.keys(light).filter((name) => !(name in dark))
    expect(missing).toEqual([])
    expect(Object.keys(dark).filter((name) => !(name in light))).toEqual([]) // and no dark value for a colour that does not exist
  })

  it('enables the dark: variant from the same class', () => {
    expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));')
  })

  it('has no hard-coded colour in any chart, so dark mode reaches them through the tokens', () => {
    const dir = join(process.cwd(), 'src/components/charts')
    const files = ['ChartCard', 'ChartTooltip', 'ResumeChart', 'StageTimeChart', 'StatusChart', 'WeeklyChart']
    for (const name of files) {
      const text = readFileSync(join(dir, `${name}.tsx`), 'utf8')
      expect(text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [], name).toEqual([])
    }
  })

  it('points the chart colours at the tokens', () => {
    for (const name of ['surface', 'ink', 'ink-2', 'grid', 'axis', 'series-1']) {
      expect(css).toMatch(new RegExp(`--viz-${name}:\\s*var\\(--color-`))
    }
  })

  // The same standard the light palette met: body text 4.5:1, control borders and chart marks 3:1.
  const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  it.each([
    ['ink', 'platform', 4.5],
    ['ink', 'ticket', 4.5],
    ['ink-soft', 'platform', 4.5],
    ['ink-soft', 'ticket', 4.5],
    ['cobalt', 'platform', 4.5], // links
    ['cobalt', 'ticket', 4.5],
    ['cobalt-deep', 'platform', 4.5], // link hover
    ['brick', 'platform', 4.5], // overdue and errors
    ['brick', 'ticket', 4.5],
    ['brick-deep', 'platform', 4.5],
    ['signal', 'platform', 4.5], // offers
    ['plum', 'platform', 4.5],
    ['ticket', 'cobalt', 4.5], // primary button
    ['ticket', 'cobalt-deep', 4.5], // its hover
    ['ticket', 'brick', 4.5], // destructive button
    ['ticket', 'brick-deep', 4.5],
    ['ticket', 'ink', 4.5], // the selected range button
    ['pencil', 'platform', 3], // control borders
    ['pencil', 'ticket', 3],
    ['cobalt', 'ticket', 3], // the chart bars and progress bar
    ['tangerine', 'platform', 3], // lines and stops are graphics, so 3:1
    ['signal', 'ticket', 3],
    ['plum', 'ticket', 3],
  ])('%s on %s is at least %s:1 in both themes', (fg, bg, minimum) => {
    expect(ratio(light[fg]!, light[bg]!)).toBeGreaterThanOrEqual(minimum)
    expect(ratio(dark[fg]!, dark[bg]!)).toBeGreaterThanOrEqual(minimum)
  })
})
