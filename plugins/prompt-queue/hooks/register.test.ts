import { expect, mock, test } from 'claude-code/testing'

// the kit's bottom: what the engine itself answers beneath the plugin
let clock: ReturnType<typeof mock.clock>
const boot = (on: Parameters<Parameters<typeof test>[1]>[1], entries?: Record<string, unknown>, sessionId = 's1') => {
  const sent: string[] = []
  mock.store(on, entries)
  clock = mock.clock(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: sessionId }) as never)
  return sent
}

const SURFACES = ['terminal', 'desktop'] as const

const band = (surface: (typeof SURFACES)[number]) =>
  ({
    plugin: 'prompt-queue',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 100 },
  }) as never

const turnDone = { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as never
const started = { cwd: '/', surface: null, isInteractive: true } as never

for (const surface of SURFACES) {
  test(`${surface}: typing a prompt and pressing Enter queues a card`, async ($, on) => {
    boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))

    await ui.input({ key: 'new-0', text: 'write the docs' })

    expect(await ui.find({ text: /write the docs/ })).toBeDefined()
    // empty input is ignored
    await ui.input({ key: 'new-1', text: '   ' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('"   "')
  })

  test(`${surface}: send submits the prompt as the user and removes the card`, async ($, on) => {
    const sent = boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))
    await ui.input({ key: 'new-0', text: 'run the tests' })

    const go = await ui.find({ type: 'Button', text: '➤' })
    expect(go?.key).toMatch(/^send-/)
    await ui.press({ key: go!.key! })

    expect(sent).toEqual(['run the tests'])
    expect(await ui.find({ text: /run the tests/ })).toBeUndefined()
  })

  test(`${surface}: delete removes a card without sending`, async ($, on) => {
    const sent = boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))
    await ui.input({ key: 'new-0', text: 'throw me away' })

    const del = await ui.find({ type: 'Button', text: '✕' })
    await ui.press({ key: del!.key! })

    expect(sent).toEqual([])
    expect(await ui.find({ text: /throw me away/ })).toBeUndefined()
  })

  test(`${surface}: down moves a card below its neighbour`, async ($, on) => {
    boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))
    await ui.input({ key: 'new-0', text: 'first one' })
    await ui.input({ key: 'new-1', text: 'second one' })

    const before = JSON.stringify(await ui.drawn())
    expect(before.indexOf('first one')).toBeLessThan(before.indexOf('second one'))

    const down = await ui.find({ type: 'Button', text: '↓' })
    await ui.press({ key: down!.key! })

    const after = JSON.stringify(await ui.drawn())
    expect(after.indexOf('second one')).toBeLessThan(after.indexOf('first one'))
  })

  test(`${surface}: up moves a card exactly one place, not to the top`, async ($, on) => {
    boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))
    for (const [i, t] of ['aaa', 'bbb', 'ccc'].entries()) await ui.input({ key: `new-${i}`, text: t })

    const ups = (await ui.findAll?.({ type: 'Button', text: '↑' })) ?? []
    const third = ups[2] ?? (await ui.find({ type: 'Button', text: '↑' }))
    await ui.press({ key: third!.key! })

    const out = JSON.stringify(await ui.drawn())
    const order = ['aaa', 'bbb', 'ccc'].map(t => out.indexOf(t))
    expect(order[0]).toBeLessThan(order[2])
    expect(order[2]).toBeLessThan(order[1])
  })

  test(`${surface}: top jumps a card to the front; the first card has no top button`, async ($, on) => {
    boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))
    for (const [i, t] of ['aaa', 'bbb', 'ccc'].entries()) await ui.input({ key: `new-${i}`, text: t })

    const tops = await ui.findAll({ type: 'Button', text: '⇈' })
    expect(tops).toHaveLength(2) // cards 2 and 3 only
    await ui.press({ key: tops[1].key! }) // the third card

    const out = JSON.stringify(await ui.drawn())
    const order = ['ccc', 'aaa', 'bbb'].map(t => out.indexOf(t))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    // still three cards, and the new first card has no top button, so two remain
    expect(await ui.findAll({ type: 'Button', text: '⇈' })).toHaveLength(2)
  })

  test(`${surface}: edit loads the text, Enter saves it in place`, async ($, on) => {
    boot(on)
    await $.session.start(started)
    const ui = await $.ui.mount(band(surface))
    await ui.input({ key: 'new-0', text: 'old wording' })

    const edit = await ui.find({ type: 'Button', text: '✎' })
    await ui.press({ key: edit!.key! })

    const field = await ui.find({ type: 'Input' })
    expect(field?.props.value).toBe('old wording')
    expect(field?.props.label).toBe('Edit: ')

    await ui.input({ key: field!.key!, text: 'new wording' })

    expect(await ui.find({ text: /new wording/ })).toBeDefined()
    expect(await ui.find({ text: /old wording/ })).toBeUndefined()
    expect((await ui.find({ type: 'Input' }))?.props.label).toBe('Queue: ')
  })
}

const text = async (ui: { find: (q: { key: string }) => Promise<{ text?: string } | undefined> }, key: string) =>
  (await ui.find({ key }))?.text ?? ''

test('auto-send off: a finished turn leaves the queue alone', async ($, on) => {
  const sent = boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'later' })

  await $.turn.complete(turnDone)
  await clock.advance(60_000)

  expect(sent).toEqual([])
})

test('auto-send: on counts down visibly, then sends the first prompt', async ($, on) => {
  const sent = boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'one' })
  await ui.input({ key: 'new-1', text: 'two' })
  await ui.press({ key: 'auto' })
  expect(await text(ui, 'auto')).toContain('On')

  await $.turn.complete(turnDone)
  expect(await ui.find({ key: 'cdcancel' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('⏱ 5')

  await clock.advance(2000)
  expect(JSON.stringify(await ui.drawn())).toContain('⏱ 3')
  expect(sent).toEqual([])

  await clock.advance(3000)
  expect(sent).toEqual(['one'])
  expect(await ui.find({ key: 'cdcancel' })).toBeUndefined()
  expect(await ui.find({ text: /1\. one/ })).toBeUndefined()
  expect(await ui.find({ text: /1\. two/ })).toBeDefined()
})

test('auto-send: Cancel stops the pending send and turns auto-send off', async ($, on) => {
  const sent = boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'one' })
  await ui.press({ key: 'auto' })
  await $.turn.complete(turnDone)
  await clock.advance(2000)

  await ui.press({ key: 'cdcancel' })
  await clock.advance(30_000)

  expect(sent).toEqual([])
  expect(await ui.find({ key: 'cdcancel' })).toBeUndefined()
  expect(await text(ui, 'auto')).toContain('Off')
  expect(await ui.find({ text: /1\. one/ })).toBeDefined()
})

test('auto-send: the count is its own setting, and one press of the switch turns it off', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  expect(await text(ui, 'limit')).toContain('×3')
  await ui.press({ key: 'limit' })
  expect(await text(ui, 'limit')).toContain('×5')

  await ui.press({ key: 'auto' })
  expect(await text(ui, 'limit')).toContain('5 left')
  await ui.press({ key: 'auto' }) // a single press turns it off, whatever the count
  expect(await text(ui, 'auto')).toContain('Off')
  expect(await text(ui, 'limit')).toContain('×5')
})

test('auto-send: hovering the count or the delay offers every choice to pick directly', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  await ui.press({ key: 'lim-10' })
  expect(await text(ui, 'limit')).toContain('×10')
  await ui.press({ key: 'lim--1' })
  expect(await text(ui, 'limit')).toContain('×∞')

  await ui.press({ key: 'dly-30' })
  expect(await text(ui, 'delay')).toContain('30s')

  // while on, picking a count resets what is left
  await ui.press({ key: 'auto' })
  await ui.press({ key: 'lim-2' })
  expect(await text(ui, 'limit')).toContain('2 left')
})

test('long prompts are not cut short on the desktop, where text is narrower than a cell', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  const long = 'word '.repeat(14).trim() // 69 characters
  await ui.input({ key: 'new-0', text: long })

  expect(JSON.stringify(await ui.drawn())).not.toContain('…')
})

test('auto-send: stops by itself once the count is used up', async ($, on) => {
  const sent = boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  for (const [i, t] of ['a', 'b', 'c'].entries()) await ui.input({ key: `new-${i}`, text: t })
  await ui.press({ key: 'limit' }) // 5
  await ui.press({ key: 'limit' }) // 10
  await ui.press({ key: 'limit' }) // no limit
  await ui.press({ key: 'limit' }) // 1
  expect(await text(ui, 'limit')).toContain('×1')
  await ui.press({ key: 'auto' })

  await $.turn.complete(turnDone)
  await clock.advance(5000)
  expect(sent).toEqual(['a'])
  expect(await text(ui, 'auto')).toContain('Off')

  await $.turn.complete(turnDone)
  await clock.advance(60_000)
  expect(sent).toEqual(['a'])
})

test('auto-send: an aborted turn does not start a countdown', async ($, on) => {
  const sent = boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'one' })
  await ui.press({ key: 'auto' })

  await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 1, isAborted: true, turnId: 't2' } as never)
  await clock.advance(60_000)

  expect(sent).toEqual([])
  expect(await ui.find({ key: 'cdcancel' })).toBeUndefined()
})

test('moving a card lights it up with an arrow, then the highlight fades away', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'first' })
  await ui.input({ key: 'new-1', text: 'second' })

  const down = await ui.find({ type: 'Button', text: '↓' })
  await ui.press({ key: down!.key! })
  expect(JSON.stringify(await ui.drawn())).toContain('"↓ ","2",". ","first"')

  await clock.advance(1000)
  const after = JSON.stringify(await ui.drawn())
  expect(after).not.toContain('"↓ ","2"')
  expect(after).toContain('"","2",". ","first"')
})

test('hover mode: the icons are in the card but hidden until the pointer is over it', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'hover me' })

  // the card's icon strip floats over its corner and starts hidden
  const stripHidden = async () => /"position":"absolute"[^}]*"display":"none"/.test(JSON.stringify(await ui.drawn()))
  expect(await stripHidden()).toBe(true)

  await ui.press({ key: 'hov' }) // hover mode off: card icons always shown
  expect(await stripHidden()).toBe(false)
})

test('every button has a tooltip that is hidden until the pointer is over it', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))
  await ui.input({ key: 'new-0', text: 'one' })
  await ui.input({ key: 'new-1', text: 'two' })

  const drawn = JSON.stringify(await ui.drawn())
  for (const name of ['previous page', 'next page', 'band height', 'columns', 'card color', 'to top', 'up one', 'down one', 'edit', 'send now', 'delete']) {
    expect(drawn).toContain(`"${name}"`)
  }
  // a tip is a hidden box that a hover reveals
  expect(drawn).toMatch(/"display":"none"[^}]*\},"hover":\{"display":"flex"\},"children":\[\{"type":"Text","props":\{"dimColor":true\},"children":\["previous page"/)
})

test('the queue survives a restart through the store', async ($, on) => {
  boot(on, { 'items:s1': [{ id: 'a', text: 'saved earlier' }] })
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  expect(await ui.find({ text: /saved earlier/ })).toBeDefined()
})

test('a survey on screen: the band yields', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const props = { hasSurvey: true, isWorking: false, maxRows: 30, bodyColumns: 100 }
  const drawn = await $.ui
    .mount({ plugin: 'prompt-queue', surface: 'desktop', component: 'AbovePrompt', props } as never)
    .then(ui => ui.find({ type: 'Input' }))
    .catch(() => undefined)

  expect(drawn).toBeUndefined()
})

test('each conversation has its own queue: another conversation is not shown this one', async ($, on) => {
  boot(on, { 'items:s1': [{ id: 'a', text: 'for thread one' }], 'items:s2': [{ id: 'b', text: 'for thread two' }] }, 's2')
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  expect(await ui.find({ text: /for thread two/ })).toBeDefined()
  expect(await ui.find({ text: /for thread one/ })).toBeUndefined()
})

test('a queue saved before queues were per conversation moves to the first conversation that opens', async ($, on) => {
  boot(on, { items: [{ id: 'a', text: 'old shared queue' }] }, 's9')
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  expect(await ui.find({ text: /old shared queue/ })).toBeDefined()
})

test('a new conversation starts with an empty queue', async ($, on) => {
  boot(on, { 'items:s1': [{ id: 'a', text: 'for thread one' }] }, 'fresh')
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  expect(await ui.find({ text: /for thread one/ })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('0')
})

test('the auto-send tooltip is an animated interactive SVG on the desktop', async ($, on) => {
  boot(on)
  await $.session.start(started)
  const ui = await $.ui.mount(band('desktop'))

  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg!.props.isInteractive).toBe(true)
  expect(svg!.props.alt).toBe('auto-send after each reply')
  expect(String(svg!.props.source)).toContain('@keyframes')
  expect(String(svg!.props.source)).toContain('auto-send after each reply')
})
