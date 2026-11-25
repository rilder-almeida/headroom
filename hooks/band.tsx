import type { Color } from 'claude-code'

import type { Forecasts, LevelName, Reading } from '../types'
import type { Ladders } from './config'
import { runOut } from './forecast'
import { contextHit, paceOf, rangeOf, stageOf, windowHit, windowOf } from './levels'
import type { Limit } from './levels'

/** What the band draws from: the last reading, the stored forecasts, the ladders and the time. */
export type BandInput = { reading: Reading | null; stored: Forecasts; config: Ladders; now: number }

/** A run of text in one color; no color draws in the default text color. */
export type Span = { text: string; color?: Color }

const LEFT = 26
const LABEL = 11
const COLUMN = 17

const COLORS: Record<LevelName | 'ok', Color> = {
  ok: 'inactive',
  warm: 'warning',
  hot: 'claude',
  full: 'error',
  over: 'error',
}

const subtle = (text: string): Span => ({ text, color: 'subtle' })

/** The text of a row, its colors dropped. */
export const plain = (spans: readonly Span[]): string => spans.map(span => span.text).join('')

type Column = { label: string; used: string; pace: string; level: string; color: Color; out: string }

const windows = (band: BandInput): Column[] =>
  (band.reading?.rateLimits ?? []).flatMap((limit: Limit) => {
    const window = windowOf(limit.kind)

    if (window === undefined) {
      return []
    }

    const pace = paceOf(limit, band.now)
    const name = windowHit(limit, band.now, band.config.pace)?.level.name ?? 'ok'

    return [
      {
        label: window.label,
        used: `${limit.percentUsed}%`,
        pace: pace === null ? 'n/a' : `${pace.value > 0 ? '+' : ''}${pace.value}%`,
        level: pace === null ? '·' : `${name} ${rangeOf(pace.value, band.config.pace)}`,
        color: COLORS[name],
        out: runOut(band.stored[limit.kind], limit, band.now),
      },
    ]
  })

const context = (band: BandInput) => {
  const percent = band.reading?.context
  const hit = percent === undefined ? null : contextHit(percent, band.config.context)
  const name = hit?.level.name ?? 'ok'

  return {
    percent,
    stage: percent === undefined ? -1 : stageOf(hit, band.config.context),
    level: percent === undefined ? name : `${name} ${rangeOf(percent, band.config.context)}`,
    color: COLORS[name],
  }
}

/** The always-visible row: context stage dots, then pace per window and its run-out time when it runs out before the reset. */
export const compact = (band: BandInput): Span[] => {
  const ctx = context(band)
  const dots = [0, 1, 2, 3].map(i => (i <= ctx.stage ? '●' : '○')).join('')
  const columns = windows(band)
  const spans: Span[] = [{ text: dots, color: ctx.stage < 0 ? 'subtle' : ctx.color }]

  columns.forEach((column, i) => {
    const arrow =
      column.pace === 'n/a'
        ? 'n/a'
        : column.pace.startsWith('-')
          ? `▼${column.pace.slice(1)}`
          : `▲${column.pace.replace('+', '')}`

    spans.push(subtle(i === 0 ? '  │  ' : '   '), subtle(`${column.label} `), { text: arrow, color: column.color })

    if (column.out !== '·') {
      spans.push({ text: ` ⧗ ${column.out.replace(' ', '')}` })
    }
  })

  return spans
}

/** The toggled view: the context block, then one column per window, row labels on the left. */
export const full = (band: BandInput): Span[][] => {
  const ctx = context(band)
  const columns = windows(band)
  const block: Span[][] = [
    [subtle('context')],
    [subtle('now'.padEnd(7)), { text: ctx.percent === undefined ? 'n/a' : `${ctx.percent}%` }],
    [subtle('level'.padEnd(7)), { text: ctx.level, color: ctx.color }],
  ]

  if (columns.length === 0) {
    return block
  }

  const cells = (pick: (column: Column) => Span): Span[] =>
    columns.map((column, i) => {
      const cell = pick(column)

      return i === columns.length - 1 ? cell : { ...cell, text: cell.text.padEnd(COLUMN) }
    })
  const grid: Span[][] = [
    [subtle(''.padEnd(LABEL)), ...cells(column => subtle(column.label))],
    [subtle('now'.padEnd(LABEL)), ...cells(column => ({ text: column.used }))],
    [subtle('pace'.padEnd(LABEL)), ...cells(column => ({ text: column.pace, color: column.color }))],
    [subtle('level'.padEnd(LABEL)), ...cells(column => ({ text: column.level, color: column.color }))],
    [subtle('out'.padEnd(LABEL)), ...cells(column => ({ text: column.out }))],
  ]

  return grid.map((row, i) => {
    const head = block[i] ?? []
    const width = plain(head).length

    return [...head, subtle(`${''.padEnd(LEFT - width)}│ `), ...row]
  })
}
