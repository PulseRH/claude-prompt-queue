import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Flash, QueuedPrompt } from '../types'

const PANE = 'prompt-queue'
const items = atom({ plugin: 'prompt-queue', key: 'items' } as const, [])
const isOpen = atom({ plugin: 'prompt-queue', key: 'isOpen' } as const, true)
const mode = atom({ plugin: 'prompt-queue', key: 'mode' } as const, 'band')
const size = atom({ plugin: 'prompt-queue', key: 'size' } as const, 'M')
const start = atom({ plugin: 'prompt-queue', key: 'start' } as const, 0)
const history = atom({ plugin: 'prompt-queue', key: 'history' } as const, [])
const numCols = atom({ plugin: 'prompt-queue', key: 'numCols' } as const, 2)
const tone = atom({ plugin: 'prompt-queue', key: 'tone' } as const, 0)
const isHover = atom({ plugin: 'prompt-queue', key: 'isHover' } as const, true)
const editId = atom({ plugin: 'prompt-queue', key: 'editId' } as const, '')
const draft = atom({ plugin: 'prompt-queue', key: 'draft' } as const, '')
const rev = atom({ plugin: 'prompt-queue', key: 'rev' } as const, 0)

// auto-send: on/off is its own switch; the count and the delay are settings beside it
const isAuto = atom({ plugin: 'prompt-queue', key: 'isAuto' } as const, false)
const autoLimit = atom({ plugin: 'prompt-queue', key: 'autoLimit' } as const, 3)
const autoLeft = atom({ plugin: 'prompt-queue', key: 'autoLeft' } as const, 0)
const delay = atom({ plugin: 'prompt-queue', key: 'delay' } as const, 5)
const countdown = atom({ plugin: 'prompt-queue', key: 'countdown' } as const, 0)
const LIMITS = [1, 2, 3, 5, 10, -1] // -1 is no limit
const DELAYS = [3, 5, 10, 15, 30]

// the card that just moved, and how far its highlight has faded
const flash = atom({ plugin: 'prompt-queue', key: 'flash' } as const, null)
const ACCENT = '#d97757'
const FADE = [0.9, 0.6, 0.35, 0.15]

const BUDGET: Record<string, number> = { S: 5, M: 9, L: 15 }
// card fills: warm Claude-ish brown, slate, and the live theme colours
const TONES: { bg: string; fg?: string }[] = [
  { bg: '#3a2e28' },
  { bg: '#2b303b' },
  { bg: 'claude', fg: 'inverseText' },
  { bg: 'permission', fg: 'inverseText' },
]
const MAX_TEXT_LINES = 3

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c)
const mix = (from: string, to: string, t: number) => {
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16)
  const out = [0, 1, 2].map(i => Math.round(ch(from, i) + (ch(to, i) - ch(from, i)) * t))
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('')
}

export const register: Register = on => {
  // the running countdown to the next auto-send (a hot reload drops it; session.start clears the number)
  let pending: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('items')) as QueuedPrompt[] | undefined
    await update($, items, () => saved ?? [])
    await update($, countdown, () => 0)
    await $.command.register({ name: 'queue', description: 'Show or hide the prompt queue' })
    return next(e)
  })

  on('command.run', { command: 'queue' }, async $ => {
    const open = await update($, isOpen, (v: boolean) => !v)
    if (open && (await read($, mode)) === 'pane') {
      await $.ui.open({ id: PANE, title: 'Prompt queue', focus: true })
    }
    if (!open) await $.ui.close({ id: PANE })
    return { text: open ? 'Prompt queue shown.' : 'Prompt queue hidden.' }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.isAborted || e.reason !== 'answer' || pending) return next(e)
    if (!(await read($, isAuto))) return next(e)
    if (((await read($, items)) as QueuedPrompt[]).length === 0) return next(e)

    // count down visibly so the person can cancel, then send the first prompt
    const secs = (await read($, delay)) as number
    await update($, countdown, () => secs)
    pending = $.clock.every(1000, async () => {
      const left = await update($, countdown, (n: number) => n - 1)
      if (left > 0) return
      pending?.cancel()
      pending = undefined
      await update($, countdown, () => 0)
      if (!(await read($, isAuto))) return

      const list = (await read($, items)) as QueuedPrompt[]
      if (list.length === 0) return
      const first = list[0]
      const saved = await update($, items, (l: QueuedPrompt[]) => l.filter(i => i.id !== first.id))
      await $.store.set('items', saved)
      const remaining = (await read($, autoLeft)) as number
      if (remaining > 0) {
        const now = await update($, autoLeft, (n: number) => n - 1)
        if (now === 0) await update($, isAuto, () => false)
      }
      void $.prompt.submit({ text: first.text, asUser: true })
    })
    return next(e)
  })

  on('ui.render', async ($, e, next) => {
    const isBand = e.component === 'AbovePrompt'
    const isPane = e.component === 'Pane' && e.requestId === PANE
    if (!isBand && !isPane) return next(e)

    const where = (await read($, mode)) as string
    if (!(await read($, isOpen))) return next(e)
    if (isBand && (where !== 'band' || e.props.hasSurvey)) return next(e)
    if (isPane && where !== 'pane') return next(e)

    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const list = (await read($, items)) as QueuedPrompt[]
    const sz = (await read($, size)) as string
    const hist = (await read($, history)) as number[]
    let from = (await read($, start)) as number
    if (from >= list.length) from = 0

    const nc = (await read($, numCols)) as number
    const toneIdx = (await read($, tone)) as number
    const look = TONES[toneIdx % TONES.length]
    const moved = (await read($, flash)) as Flash | null

    const cols = Math.max(20, e.props.bodyColumns ?? 80)
    const cellW = Math.floor((cols - 1) / nc)
    // the desktop draws proportional text, so a cell holds more than one character
    const fudge = e.surface === 'desktop' ? 1.5 : 1
    const perLine = Math.max(8, Math.floor((cellW - 6) * fudge))
    const budget = isBand ? BUDGET[sz] : Math.max(4, (e.viewport?.rows ?? 24) - 7)

    // short prompt: one row, icons on the same line. Longer: text left, icons stacked right.
    const ROW_CTRL = Math.round(14 * fudge)
    const SIDE_CTRL = Math.round(9 * fudge)
    // hover mode: the icons float over the card's corner on hover, so the text gets the whole card
    const hoverMode = (await read($, isHover)) as boolean
    const isInline = (t: string) => !hoverMode && t.length + 4 + ROW_CTRL <= perLine
    const sideW = hoverMode ? perLine : Math.max(6, perLine - SIDE_CTRL)
    const textLines = (t: string) =>
      isInline(t) ? 1 : Math.min(MAX_TEXT_LINES, Math.max(1, Math.ceil((t.length + 4) / sideW)))
    const cellHeight = (t: string) => (isInline(t) || hoverMode ? textLines(t) : Math.max(2, textLines(t))) + 1

    // pack rows of nc cells until the line budget is used
    const rows: QueuedPrompt[][] = []
    let used = 0
    let at = from
    while (at < list.length) {
      const group = list.slice(at, at + nc)
      const h = Math.max(...group.map(p => cellHeight(p.text)))
      if (rows.length > 0 && used + h > budget) break
      rows.push(group)
      used += h
      at += group.length
    }
    const shown = at - from

    const auto = (await read($, isAuto)) as boolean
    const limit = (await read($, autoLimit)) as number
    const left = (await read($, autoLeft)) as number
    const secs = (await read($, delay)) as number
    const ticking = (await read($, countdown)) as number
    const editing = (await read($, editId)) as string
    const draftText = (await read($, draft)) as string
    const revision = (await read($, rev)) as number

    const add = async (text: string) => {
      const t = text.trim()
      if (!t) return
      const id = editing
      const saved = id
        ? await update($, items, (l: QueuedPrompt[]) => l.map(i => (i.id === id ? { ...i, text: t } : i)))
        : await update($, items, (l: QueuedPrompt[]) => [...l, { id: String(Date.now()) + Math.random(), text: t }])
      await $.store.set('items', saved)
      await update($, editId, () => '')
      await update($, draft, () => '')
      await update($, rev, (n: number) => n + 1)
    }
    const startEdit = async (item: QueuedPrompt) => {
      await update($, editId, () => item.id)
      await update($, draft, () => item.text)
      await update($, rev, (n: number) => n + 1)
    }
    const cancelEdit = async () => {
      await update($, editId, () => '')
      await update($, draft, () => '')
      await update($, rev, (n: number) => n + 1)
    }

    // auto-send: one press turns it on or off; the count is set separately
    const toggleAuto = async () => {
      const on_ = await update($, isAuto, (v: boolean) => !v)
      if (on_) {
        await update($, autoLeft, () => limit)
      } else {
        pending?.cancel()
        pending = undefined
        await update($, countdown, () => 0)
      }
    }
    const cycleLimit = async () => {
      const next_ = LIMITS[(LIMITS.indexOf(limit) + 1) % LIMITS.length]
      await update($, autoLimit, () => next_)
      if (auto) await update($, autoLeft, () => next_)
    }
    const setLimit = async (n: number) => {
      await update($, autoLimit, () => n)
      if (auto) await update($, autoLeft, () => n)
    }
    const setDelay = async (s: number) => {
      await update($, delay, () => s)
    }
    const cycleDelay = async () => {
      await update($, delay, (s: number) => DELAYS[(DELAYS.indexOf(s) + 1) % DELAYS.length])
    }
    // cancel a send that is counting down, and stop auto-send so nothing follows it
    const cancelSend = async () => {
      pending?.cancel()
      pending = undefined
      await update($, countdown, () => 0)
      await update($, isAuto, () => false)
    }

    const toggleHover = async () => {
      await update($, isHover, (v: boolean) => !v)
    }
    const remove = async (id: string) => {
      const saved = await update($, items, (l: QueuedPrompt[]) => l.filter(i => i.id !== id))
      await $.store.set('items', saved)
    }
    // the plugin UI cannot slide a card, so the one that moved lights up and fades
    const lightUp = async (id: string, dir: number) => {
      const seq = Math.random()
      await update($, flash, () => ({ id, dir, step: 0, seq }))
      void (async () => {
        try {
          for (const step of [1, 2, 3]) {
            await $.clock.sleep(150)
            await update($, flash, (f: Flash | null) => (f && f.seq === seq ? { ...f, step } : f))
          }
          await $.clock.sleep(150)
          await update($, flash, (f: Flash | null) => (f && f.seq === seq ? null : f))
        } catch {
          // the plugin was reloaded mid-fade: the highlight just stops
        }
      })()
    }
    const move = async (id: string, by: number) => {
      const saved = await update($, items, (l: QueuedPrompt[]) => {
        const i = l.findIndex(x => x.id === id)
        const j = i + by
        if (i < 0 || j < 0 || j >= l.length) return l
        const c = [...l]
        c[i] = l[j]
        c[j] = l[i]
        return c
      })
      await $.store.set('items', saved)
      await lightUp(id, by)
    }
    // jump a prompt to the front of the queue
    const toTop = async (id: string) => {
      const saved = await update($, items, (l: QueuedPrompt[]) => {
        const found = l.find(x => x.id === id)
        return found ? [found, ...l.filter(x => x.id !== id)] : l
      })
      await $.store.set('items', saved)
      await update($, start, () => 0)
      await update($, history, () => [])
      await lightUp(id, -1)
    }
    const send = async (item: QueuedPrompt) => {
      await remove(item.id)
      void $.prompt.submit({ text: item.text, asUser: true })
    }
    const next_ = async () => {
      await update($, history, (h: number[]) => [...h, from])
      await update($, start, () => from + shown)
    }
    const prev = async () => {
      const back = hist[hist.length - 1] ?? 0
      await update($, history, (h: number[]) => h.slice(0, -1))
      await update($, start, () => back)
    }
    const cycleSize = async () => {
      await update($, size, (s: string) => (s === 'S' ? 'M' : s === 'M' ? 'L' : 'S'))
      await update($, history, () => [])
    }
    const cycleCols = async () => {
      await update($, numCols, (c: number) => (c >= 3 ? 1 : c + 1))
      await update($, history, () => [])
    }
    const cycleTone = async () => {
      await update($, tone, (t: number) => (t + 1) % TONES.length)
    }
    const toggleWhere = async () => {
      const w = await update($, mode, (m: string) => (m === 'band' ? 'pane' : 'band'))
      await update($, history, () => [])
      if (w === 'pane') await $.ui.open({ id: PANE, title: 'Prompt queue', focus: true })
      else await $.ui.close({ id: PANE })
    }

    // no native tooltip exists, so a button's name appears beside it while the pointer is over it
    const tip = (name: string, button: unknown, text: string) => (
      <Box key={'tip-' + name} flexDirection="row" alignItems="center">
        {button}
        <Box display="none" hover={{ display: 'flex' }} marginLeft={1}>
          <Text dimColor>{text}</Text>
        </Box>
      </Box>
    )

    const cell = (item: QueuedPrompt, n: number) => {
      const lines = textLines(item.text)
      const inline = isInline(item.text)
      const width = inline ? perLine - ROW_CTRL : sideW
      const cap = lines * width - 4
      const body = item.text.length > cap ? item.text.slice(0, Math.max(1, cap - 1)) + '…' : item.text
      // the first prompt is already at the top, so it gets no jump-to-top button
      const top = n > 1 ? tip('top-' + item.id, <Button key={'top-' + item.id} plain onPress={() => toTop(item.id)}>⇈</Button>, 'to top') : null
      const up = tip('up-' + item.id, <Button key={'up-' + item.id} plain onPress={() => move(item.id, -1)}>↑</Button>, 'up one')
      const dn = tip('dn-' + item.id, <Button key={'dn-' + item.id} plain onPress={() => move(item.id, 1)}>↓</Button>, 'down one')
      const ed = tip('edit-' + item.id, <Button key={'edit-' + item.id} plain onPress={() => startEdit(item)}>✎</Button>, 'edit')
      const go = tip('send-' + item.id, <Button key={'send-' + item.id} variant="primary" onPress={() => send(item)}>➤</Button>, 'send now')
      const del = tip('del-' + item.id, <Button key={'del-' + item.id} dimColor onPress={() => remove(item.id)}>✕</Button>, 'delete')

      const lit = moved && moved.id === item.id ? moved : null
      const fill = lit ? (isHex(look.bg) ? mix(look.bg, ACCENT, FADE[lit.step]) : lit.step < 2 ? ACCENT : look.bg) : look.bg
      const arrow = lit ? (lit.dir < 0 ? '↑ ' : '↓ ') : ''
      return (
        <Box
          key={item.id}
          flexDirection="row"
          width={cellW - 1}
          marginRight={1}
          marginBottom={1}
          paddingX={1}
          borderStyle="round"
          borderColor={fill}
          backgroundColor={fill}
        >
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap" color={look.fg}>{arrow}{n}. {body}</Text>
          </Box>
          {hoverMode ? (
            <Box
              position="absolute"
              top={0}
              right={0}
              display="none"
              hover={{ display: 'flex' }}
              flexDirection="row"
              gap={1}
              paddingX={1}
              backgroundColor={fill}
            >
              {top}{up}{dn}{ed}{go}{del}
            </Box>
          ) : inline ? (
            <Box flexDirection="row" flexShrink={0} gap={1}>{top}{up}{dn}{ed}{go}{del}</Box>
          ) : (
            <Box flexDirection="column" flexShrink={0} alignItems="flex-end">
              <Box flexDirection="row" gap={1}>{top}{up}{dn}{del}</Box>
              <Box flexDirection="row" gap={1}>{ed}{go}</Box>
            </Box>
          )}
        </Box>
      )
    }

    // lit up while auto-send is on, so the three controls read as one thing
    const autoBg = auto ? mix('#2a2a2a', ACCENT, 0.35) : '#2e2e2e'

    const barW = Math.min(secs, 15)
    const filled = Math.ceil((ticking / secs) * barW)
    const nextText = list[0]?.text ?? ''
    const nextShort = nextText.length > 40 ? nextText.slice(0, 39) + '…' : nextText

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Input
              key={'new-' + revision}
              label={editing ? 'Edit: ' : 'Queue: '}
              placeholder="type a prompt, Enter to add"
              value={draftText}
              submitLabel={editing ? 'save' : 'add'}
              onSubmit={add}
            />
          </Box>
          {/* the auto-send controls share one filled group; hovering it opens the pickers */}
          <Box flexShrink={0} flexDirection="row" alignItems="center" gap={1} paddingX={1} backgroundColor={autoBg}>
            {tip('auto', <Button key="auto" variant={auto ? 'primary' : 'secondary'} onPress={toggleAuto}>
              {auto ? '⚡ On' : '⚡ Off'}
            </Button>, 'auto-send after each reply')}
            {/* each of these reveals its own choices beside it on hover: wider, never taller */}
            <Box key="limgrp" flexDirection="row" alignItems="center">
              <Button key="limit" plain onPress={cycleLimit}>
                {auto ? (left < 0 ? '∞ left' : left + ' left') : '×' + (limit < 0 ? '∞' : limit)}
              </Button>
              <Box display="none" hover={{ display: 'flex' }} flexDirection="row" gap={1} marginLeft={1}>
                <Text dimColor>send</Text>
                {LIMITS.map(n => (
                  <Button key={'lim-' + n} plain variant={n === limit ? 'primary' : 'secondary'} onPress={() => setLimit(n)}>
                    {n < 0 ? '∞' : String(n)}
                  </Button>
                ))}
              </Box>
            </Box>
            <Box key="dlygrp" flexDirection="row" alignItems="center">
              <Button key="delay" plain onPress={cycleDelay}>{'⏱ ' + secs + 's'}</Button>
              <Box display="none" hover={{ display: 'flex' }} flexDirection="row" gap={1} marginLeft={1}>
                <Text dimColor>wait</Text>
                {DELAYS.map(s => (
                  <Button key={'dly-' + s} plain variant={s === secs ? 'primary' : 'secondary'} onPress={() => setDelay(s)}>
                    {s + 's'}
                  </Button>
                ))}
              </Box>
            </Box>
          </Box>
          {editing && (
            <Box flexShrink={0}>
              <Button key="cancel" plain onPress={cancelEdit}>✕ Cancel</Button>
            </Box>
          )}
          <Box flexShrink={0} flexDirection="row" gap={1}>
            {tip('prev', <Button key="prev" plain dimColor={hist.length === 0} onPress={prev}>‹</Button>, 'previous page')}
            <Text dimColor wrap="truncate-end">
              {list.length === 0 ? '0' : `${from + 1}-${from + shown}/${list.length}`}
            </Text>
            {tip('next', <Button key="next" plain dimColor={from + shown >= list.length} onPress={next_}>›</Button>, 'next page')}
          </Box>
          {isBand && (
            <Box flexShrink={0}>
              {tip('size', <Button key="size" plain onPress={cycleSize}>{'⤢ ' + sz}</Button>, 'band height')}
            </Box>
          )}
          <Box flexShrink={0}>
            {tip('cols', <Button key="cols" plain onPress={cycleCols}>{'▥ ' + nc}</Button>, 'columns')}
          </Box>
          <Box flexShrink={0}>
            {tip('hov', <Button key="hov" plain onPress={toggleHover}>{hoverMode ? '◉' : '○'}</Button>, 'card buttons on hover')}
          </Box>
          <Box flexShrink={0}>
            {tip('tone', <Button key="tone" plain onPress={cycleTone}>◐</Button>, 'card color')}
          </Box>
          <Box flexShrink={0}>
            {tip('where', <Button key="where" plain onPress={toggleWhere}>{isBand ? '◨' : '⬒'}</Button>, isBand ? 'side window' : 'above input')}
          </Box>
        </Box>
        {ticking > 0 && (
          <Box flexDirection="row" gap={1} marginY={1}>
            <Text bold color="claude">{'⏱ ' + ticking}</Text>
            <Text color="claude">{'●'.repeat(filled) + '○'.repeat(barW - filled)}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{'sending "' + nextShort + '"'}</Text>
            </Box>
            <Button key="cdcancel" variant="primary" onPress={cancelSend}>✕ Cancel</Button>
          </Box>
        )}
        {rows.map((pair, r) => (
          <Box key={'row' + r} flexDirection="row">
            {pair.map((item, c) => cell(item, from + r * nc + c + 1))}
          </Box>
        ))}
      </Box>
    )
  })
}
