/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards the visual identity: patterns we deliberately ruled out must not creep
// back into the app's source. Add a rule here when the design plan adds one.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const FILES = sourceFiles(join(process.cwd(), 'src')).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

function offenders(pattern: RegExp, except: string[] = []) {
  return FILES.filter((f) => pattern.test(f.text) && !except.some((e) => f.path.endsWith(e))).map((f) => f.path.replace(process.cwd() + '/', ''))
}

describe('design rules', () => {
  it('finds the source files (so the checks below are not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('has no middle-dot separators in text', () => {
    expect(offenders(/·/)).toEqual([])
  })

  it('has no arrows on links or buttons', () => {
    expect(offenders(/[←→↗↘↑↓⟶➜➔]|&rarr;|&larr;/)).toEqual([])
  })

  it('has no tracked-out all-caps labels', () => {
    expect(offenders(/\buppercase\b|\btracking-(wide|wider|widest)\b/)).toEqual([])
  })

  it('has no leftover default-palette colors (only the named palette is used)', () => {
    expect(offenders(/\b(bg|text|border|ring|divide|from|to|via)-(slate|gray|zinc|neutral|stone|indigo|violet|purple|blue|sky|emerald|green|red|amber|yellow|orange)-\d{2,3}\b/)).toEqual([])
  })

  it('uses only the two radii from the plan (no rounded-lg / xl / full)', () => {
    expect(offenders(/\brounded-(sm|md|lg|xl|2xl|3xl|full)\b/)).toEqual([])
  })

  it('has no shadows, except on the chart tooltip that must lift off the plot', () => {
    expect(offenders(/\bshadow(-\w+)?\b/, ['charts/ChartTooltip.tsx'])).toEqual([])
  })
})
