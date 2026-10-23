import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, Item } from '../types'

// Every task is a file ~/.claude/progress/<id>.json:
//   { "label": "download", "total": 22863084160, "files": ["C:/.../part0", ...] }  progress = sum of file sizes (bytes)
//   { "label": "test suite", "total": 8, "done": 3, "unit": "step" }               progress = counter the script writes
// A bar disappears when done >= total, when none of the files exists (yet or any more), or when the JSON is gone.
type Tracker = { label?: string; total?: number; done?: number; unit?: string; files?: string[] }

const items = atom({ plugin: 'progress-bar', key: 'items' } as const, [])
const agents = atom({ plugin: 'progress-bar', key: 'agents' } as const, [])

const BAR = 30
const DONE_SHOWN_MS = 10_000
// Git Bash scripts write /c/models/...; Windows does not resolve that.
const winPath = (p: string) => p.replace(/^\/([a-zA-Z])\//, '$1:/')
const TEXT = {
  en: { left: 'left', dot: '.', calls: 'tool calls', running: 'running', waiting: 'waiting', done: 'done', failed: 'failed' },
  pl: { left: 'zostało', dot: ',', calls: 'wywołań narzędzi', running: 'pracuje', waiting: 'czeka', done: 'gotowe', failed: 'błąd' },
}
const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export const register: Register = (on, options) => {
  // Language: /progress-bar en|pl (kept in $.store across sessions) wins over the userConfig option.
  let L = options.language === 'pl' ? TEXT.pl : TEXT.en
  const num = (n: number, digits: number) => n.toFixed(digits).replace('.', L.dot)
  const fmtBytes = (b: number) => (b >= 1e9 ? `${num(b / 1e9, 1)} GB` : `${num(b / 1e6, 0)} MB`)
  const fmtEta = (s: number) =>
    s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${num(s / 3600, 1)} h`
  // ponytail: rate = average since the first reading (session start or task start); ETA reacts slowly to a changing link
  const first = new Map<string, { t: number; done: number }>()
  // ponytail: agent start = first time the mod saw it (within 2 s of spawn); counts reset on a mod reload
  const calls = new Map<string, number>()
  const seen = new Map<string, { t0: number; endAt?: number }>()

  on('tool.call', ($, e, next) => {
    if (e.agentId) calls.set(e.agentId, (calls.get(e.agentId) ?? 0) + 1)
    return next(e)
  })

  on('command.run', { command: 'progress-bar' }, async ($, e) => {
    const lang = e.args.trim().toLowerCase()
    if (lang !== 'en' && lang !== 'pl') return { text: 'Usage: /progress-bar en|pl' }
    await $.store.set('language', lang)
    L = TEXT[lang]
    return { text: lang === 'pl' ? 'Pasek postępu: język polski.' : 'Progress bar: English.' }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress-bar',
      description: 'Progress bar language: en or pl',
      argumentHint: 'en|pl',
    })
    const stored = await $.store.get('language')
    if (stored === 'en' || stored === 'pl') L = TEXT[stored]
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

      const rows: AgentRow[] = []
      for (const a of await $.agent.list().catch(() => [])) {
        const isEnded = a.status === 'completed' || a.status === 'failed' || a.status === 'killed'
        // An agent already finished when the mod first sees it is history, never shown.
        if (!seen.has(a.id)) seen.set(a.id, isEnded ? { t0: now, endAt: -Infinity } : { t0: now })
        const s = seen.get(a.id)!
        if (isEnded && s.endAt === undefined) s.endAt = now
        if (s.endAt !== undefined && now - s.endAt > DONE_SHOWN_MS) continue
        const state = !isEnded ? (a.status === 'running' ? 'running' : 'waiting') : a.status === 'completed' ? 'done' : 'failed'
        rows.push({ id: a.id, label: a.name ?? a.description, state, ms: (s.endAt ?? now) - s.t0, calls: calls.get(a.id) ?? 0 })
      }
      await update($, agents, prev => (prev.length === 0 && rows.length === 0 ? prev : rows))
    }

    $.ui.status(undefined)
    await tick()
    $.clock.every(2000, () => void tick())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, items)
    const crew = await read($, agents)
    if (e.props.hasSurvey || (list.length === 0 && crew.length === 0)) return next(e)
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
          const eta = i.rate > 0 ? ` · ${L.left} ${fmtEta((i.total - i.done) / i.rate)}` : ''
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
        {crew.map(a => (
          <Box key={`agent-${a.id}`} columnGap={1}>
            <Text color={a.state === 'done' ? 'green' : a.state === 'failed' ? 'red' : 'yellow'}>
              {a.state === 'done' ? '✓' : a.state === 'failed' ? '✗' : '●'}
            </Text>
            <Text bold>{a.label}</Text>
            <Text dimColor>{`· ${L[a.state]} · ${fmtElapsed(a.ms)} · ${a.calls} ${L.calls}`}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
