import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Item } from '../types'

// Every task is a file ~/.claude/progress/<id>.json:
//   { "label": "download", "total": 22863084160, "files": ["C:/.../part0", ...] }  progress = sum of file sizes (bytes)
//   { "label": "test suite", "total": 8, "done": 3, "unit": "step" }               progress = counter the script writes
// A bar disappears when done >= total, when none of the files exists (yet or any more), or when the JSON is gone.
type Tracker = { label?: string; total?: number; done?: number; unit?: string; files?: string[] }

const items = atom({ plugin: 'progress-bar', key: 'items' } as const, [])

const BAR = 30
// Git Bash scripts write /c/models/...; Windows does not resolve that.
const winPath = (p: string) => p.replace(/^\/([a-zA-Z])\//, '$1:/')
const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`)
const fmtEta = (s: number) =>
  s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`

export const register: Register = on => {
  // ponytail: rate = average since the first reading (session start or task start); ETA reacts slowly to a changing link
  const first = new Map<string, { t: number; done: number }>()

  on('session.start', async ($, e, next) => {
    const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    const dir = `${home}/.claude/progress`

    const tick = async () => {
      const entries = await $.fs.list(dir).catch(() => [])
      const now = await $.clock.now()
      const found: Item[] = []
      for (const entry of entries) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
        const id = entry.name.slice(0, -5)
        const t = await $.fs.read(`${dir}/${entry.name}`).then(s => JSON.parse(s) as Tracker).catch(() => null)
        if (!t || !(t.total! > 0)) continue
        let done = t.done ?? 0
        let unit = t.unit ?? ''
        if (t.files?.length) {
          const sizes = await Promise.all(t.files.map(f => $.fs.stat(winPath(f)).then(s => s.size).catch(() => -1)))
          if (sizes.every(s => s < 0)) continue
          done = sizes.reduce((a, s) => a + Math.max(0, s), 0)
          unit = 'B'
        }
        if (done >= t.total!) continue
        const start = first.get(id) ?? { t: now, done }
        if (!first.has(id) || done < start.done) first.set(id, { t: now, done })
        const dt = (now - start.t) / 1000
        const rate = dt > 0 && done > start.done ? (done - start.done) / dt : 0
        found.push({ id, label: t.label ?? id, done, total: t.total!, unit, rate })
      }
      for (const id of [...first.keys()]) if (!found.some(i => i.id === id)) first.delete(id)
      await update($, items, prev => (prev.length === 0 && found.length === 0 ? prev : found))
    }

    $.ui.status(undefined)
    await tick()
    $.clock.every(2000, () => void tick())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, items)
    if (e.props.hasSurvey || list.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {list.map(i => {
          const p = Math.min(1, i.done / i.total)
          const filled = Math.round(p * BAR)
          const isBytes = i.unit === 'B'
          const amount = isBytes
            ? `${fmtBytes(i.done)} / ${fmtBytes(i.total)}`
            : `${i.done} / ${i.total}${i.unit ? ` ${i.unit}` : ''}`
          const speed = isBytes && i.rate > 0 ? ` · ${fmtBytes(i.rate)}/s` : ''
          const eta = i.rate > 0 ? ` · ${fmtEta((i.total - i.done) / i.rate)} left` : ''
          return (
            <Box key={i.id} columnGap={1}>
              <Text bold>{i.label}</Text>
              <Text>
                <Text color="green">{'█'.repeat(filled)}</Text>
                <Text dimColor>{'░'.repeat(BAR - filled)}</Text>
              </Text>
              <Text>{`${Math.floor(p * 100)}%`}</Text>
              <Text dimColor>{`${amount}${speed}${eta}`}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
