import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { End, Mark, Scenario, Step, Tester } from '../types'

const PANE = 'sf-tester-pane'
const TITLE = 'sf-tester'
const PREFIX = 'mcp__sf-tester__'
const testers = atom({ plugin: 'sf-tester-pane', key: 'testers' } as const, [] as Tester[])
// The running step's > blinks on this half-second flag; a requirement's or scenario's steps show while its key is open.
const blink = atom({ plugin: 'sf-tester-pane', key: 'blink' } as const, true)
const open = atom({ plugin: 'sf-tester-pane', key: 'open' } as const, [] as string[])
// Set once the session was told by a toast that the pane had no room to open.
const told = atom({ plugin: 'sf-tester-pane', key: 'told' } as const, false)
// The running tester a digit picked, by agentId; '' until one is pressed.
const picked = atom({ plugin: 'sf-tester-pane', key: 'picked' } as const, '')
let tick: Timer | undefined
// The user's blink option turned off: the running mark is a steady > and no timer runs.
let still = false
// One half-second blink timer while any tester runs; turn.complete cancels it when the last one answers. A late
// repeat spawn that set no tester running starts none.
const blinking = async ($: EngineInterface) => { if (!still && (await read($, testers)).some(t => !t.isDone)) tick ??= $.clock.every(500, () => void quiet(update($, blink, b => !b))) }
// A run time in the fewest characters: 42s, 1m 21s, 1h 5m.
const took = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
}
// A step's time: tenths under 10 s (0.4s), else as took.
const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : took(ms))
// Rows a text takes as the terminal's hard wrap draws it: each line on its own rows, every space kept, a word that
// fits moved whole to a new row, a wider one filling the row it starts on before it breaks.
const lines = (text: string, width: number): number => {
  const w = Math.max(1, width)
  return text.split(/\r?\n/).reduce((rows, line) => {
    let n = 1
    let at = 0
    line.split(' ').forEach((word, i) => {
      const gap = i > 0 ? 1 : 0
      if (at + gap + word.length <= w) { at += gap + word.length; return }
      if (word.length <= w) { n += 1; at = word.length; return }
      at += gap + word.length
      while (at > w) { n += 1; at -= w }
    })
    return rows + n
  }, 0)
}
// A text cut to n columns, its end marked.
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, Math.max(1, n) - 1)}…` : text)
// The persona of a scenario in a row width columns wide. beside: next to the status, 16 columns at most, cut before
// the title loses a column and dropped under 8. under: whole on a row of its own, in a row pressed open that cut it.
const who = (s: Scenario, width: number, label: string, full: boolean) => {
  const all = s.persona ?? ''
  const room = Math.min(16, width - s.title.length - 4 - 1 - label.length - 2)
  const beside = all.length <= room ? all : room >= 8 ? clip(all, room) : ''
  return full && beside !== all ? { beside: '', under: all } : { beside, under: '' }
}
// Right of each step: a known route's or found by exploring, and how long it took.
const side = (s: Step) => `${s.route ? ' route' : ' explore'}${s.ms === undefined ? '' : ` ${secs(s.ms)}`}`

type Args = Record<string, unknown>
const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))
// An API name as a person reads it: SfUiProbe__c.Inputs_Flow -> Inputs Flow.
const human = (v: unknown) => str(v).replace(/^.*\./, '').replace(/__c$/, '').replace(/_/g, ' ')
const q = (v: unknown) => `"${str(v)}"`
const nthOf = (a: Args) => (a.nth ? ` no. ${str(a.nth)}` : '')
const rowOf = (a: Args) => `${a.row ? ` on row ${str(a.row)}` : ''}${a.column ? ` under ${q(a.column)}` : ''}`
// What a call aims at, as the server aims: an exact text, a name, an unnamed element (a button unless a role says),
// else a role alone in a row; scoped (on_top, measure) with none, the frame, dialog or component, which nth and row skip.
const target = (a: Args, scoped = false) => {
  const named = a.text ? q(a.text) : a.name ? q(a.name) : a.name === '' ? `the unnamed ${str(a.role) || 'button'}` : undefined
  if (named === undefined && scoped) return a.frame ? 'the frame' : a.inModal ? 'the dialog' : a.lwcApiName ? q(a.lwcApiName) : 'the page'
  return (named ?? `the ${str(a.role) || 'button'}`) + nthOf(a) + rowOf(a)
}

// Each sf-tester call as a line of a QA scenario; plumbing a scenario would not list is hidden.
const HIDDEN = new Set(['start', 'end', 'run_route', 'scenario', 'combinations', 'whoami', 'improvements', 'record_improvement', 'fix_improvement', 'save_route', 'viewport', 'watch'])
const CLICK: Record<string, (a: Args) => string> = {
  option: a => `Choose ${q(a.name)}`,
  tab: a => `Open the ${q(a.name)} tab`,
  combobox: a => `Open the ${q(a.name)} picklist`,
  checkbox: a => `Tick ${q(a.name)}`,
  radio: a => `Select ${q(a.name)}`,
  link: a => `Click the ${q(a.name)} link`,
  button: a => `Click the ${q(a.name)} button`,
}
const PHRASE: Record<string, (a: Args) => string> = {
  click: a => (a.name && !a.text && a.role && CLICK[str(a.role)] ? CLICK[str(a.role)]!(a) + nthOf(a) + rowOf(a)
    : a.name === undefined && !a.text && !a.row ? 'Click' : `Click ${target(a)}`),
  fill: a => `Enter ${q(a.value)} in ${q(a.name)}`,
  press: a => `Press ${str(a.key)}`,
  wait: a => (a.text ? `Wait for ${q(a.text)}${a.gone ? ' to go' : ''}` : 'Wait for the page'),
  modal: a => (a.action === 'close' ? 'Close the dialog' : 'Check the dialog'),
  launch_action: a => `Click the ${q(human(a.apiName))} action`,
  actions: () => "Look at the record's actions",
  assert_field: a => `Confirm ${human(a.field)} is ${q(a.expected)}`,
  open_record: () => 'Open the record',
  open_tab: a => `Open the ${q(human(a.tab))} tab`,
  open_list: a => `Open the ${q(str(a.listView) || 'Recent')} ${human(a.objectApiName)} list view`,
  open_related_list: a => `Open the ${q(human(a.relationship))} related list`,
  search: a => `Search for ${q(a.text)}`,
  create_record: a => `Open the New ${human(a.objectApiName)} dialog`,
  edit_record: () => 'Open the Edit dialog',
  edit_inline: a => `Edit ${human(a.field)} inline`,
  set_fields: a => `Fill out the form (${Object.keys((a.values as Args) ?? {}).map(human).join(', ')})`,
  save: () => 'Save',
  cancel: () => 'Cancel',
  form_model: () => 'Read the form',
  upload_file: a => `Upload ${((a.paths as string[]) ?? []).map(p => p.split('/').pop()).join(', ')}`,
  lwc_read: a => `Read the ${q(a.lwcApiName)} component`,
  toasts: a => (a.text ? `Confirm the toast ${q(a.text)}` : 'Check the toast message'),
  hover: a => `Hover over ${target(a)}`,
  on_top: a => `Check what is on top of ${target(a, true)}`,
  measure: a => `Measure ${a.selector && a.name === undefined && !a.text ? q(a.selector) : target(a, true)}`,
  page_snapshot: () => 'Look at the page',
  screenshot: () => 'Take a screenshot',
  page_errors: () => 'Check the page for errors',
  login_as: a => `Log in as ${q(a.user)}`,
  apex: () => 'Run Apex',
  api: () => 'Read data from the API',
  verify_live: () => 'Confirm the deploy is live',
  map_feature: () => 'Map the page from the org',
  route: a => `Find the way to ${q(a.to)}`,
}
const short = (tool: string) => tool.replace(PREFIX, '').replace(/^sf_/, '')
const phrase = (tool: string, a: Args) => PHRASE[short(tool)]?.(a) ?? human(short(tool))

// A tool error: its code and message, which say what the page did instead (a Playwright one runs over lines).
const why = (text: string | undefined) => {
  try {
    const body = JSON.parse(text ?? '') as { code?: string; message?: string }
    // A coded error's message already starts with its code; a LOCATOR_TIMEOUT or UNEXPECTED one carries Playwright's own.
    const line = body.code && body.message?.startsWith(`${body.code}: `) ? body.message : [body.code, body.message].filter(Boolean).join(': ')
    return line.slice(0, 200) || undefined
  } catch { return text?.slice(0, 200) }
}

// A benchmark cell (`entry/C1`) keeps its arm in the header, so two lanes on one feature stay apart.
const arm = (label: string) => { const m = label.match(/\/([A-E]\d+)$/); return m ? `${m[1]}: ` : '' }
// A tester's header as drawn: its lane, then its feature.
const title = (t: Tester) => `${arm(t.label)}${t.feature || t.label}`
const ICON: Record<Mark, string> = { pending: '·', running: '>', done: '✓', failed: '✗' }
const COLOR: Record<Mark, string | undefined> = { pending: 'subtle', running: 'warning', done: 'success', failed: 'error' }
const STATUS: Record<Scenario['status'], [string, string]> = { pending: ['to run', 'subtle'], running: ['RUNNING', 'warning'], PASS: ['PASS', 'success'], FAIL: ['FAIL', 'error'] }
// A status this table lacks (OBSERVED, stored by an older tester and kept through a reload) draws as itself, and
// a scenario ended with no result draws none.
const look = (status: string | undefined): [string, string] => STATUS[status as Scenario['status']] ?? [status ?? '', 'subtle']

// The pane must never break a tester's own call, so a failed state write is dropped.
const quiet = (p: Promise<unknown>) => p.catch(() => undefined)

// How a run ended: what a resumed tester goes back to when its next turn is cut before any sf-tester call.
const ends = ({ isDone, result, asked, cause, hidden, startedAt, endedAt }: Tester): End => ({ isDone, result, asked, cause, hidden, startedAt, endedAt })
// A finished tester run again (continued with SendMessage, as after a BLOCKED answer): timed from at, its ending kept.
// Reset at its repeat spawn, or, when that spawn lands late, at its first sf-tester call or at the end of its turn.
const resumed = (at: number | undefined) => (t: Tester): Tester => ({ ...t, isDone: false, hidden: false, result: undefined, endedAt: undefined, startedAt: at ?? t.startedAt, kept: ends(t) })
// An ending that holds a question waits for an answer whatever its result: a FAIL that asks is counted and waits.
const waits = (t: Tester) => t.isDone && (t.result === 'BLOCKED' || !!t.asked)
// Ended with no result: STOPPED, or what an older pane stored for it (NONE, nothing).
const stopped = (t: Tester) => t.isDone && (t.result === undefined || t.result === 'STOPPED' || t.result === 'NONE')
// A scenario's bar cell, told apart by shape as well as colour.
const CELL: Record<string, string> = { pending: '▱', running: '▷', FAIL: '✗' }
// The question with any markup still open before it (`, **, opened before or after BLOCKED and not closed there) taken
// off its end, and markup of its own kept.
const unwrap = (before: string, rest: string) => {
  let open = before
  let q = rest.trim()
  for (const mark of ['**', '__', '`', '*', '_']) {
    const odd = (open.split(mark).length - 1) % 2 === 1
    open = open.split(mark).join('')
    if (odd && q.endsWith(mark)) q = q.slice(0, -mark.length).trimEnd()
  }
  return q
}
// What an answer says. RESULT is read as bench/bench.js reads it: the last line that starts with it after markup, words
// after it allowed, the brief's own "PASS or RESULT" line refused. BLOCKED asks only as the last line, fences aside.
export const said = (answer: string) => {
  const line = [...answer.matchAll(/^[\s>*_`#-]*RESULT \S+: (PASS|FAIL)(?!\s*(?:or|\/)\s*RESULT)/gm)].at(-1)?.[1] as 'PASS' | 'FAIL' | undefined
  const blocked = (answer.split(/\r?\n/).filter(l => l.trim() && !/^\s*(`{3,}|~{3,})[\w+.#-]*\s*$/.test(l)).at(-1) ?? '').match(/^((?:\s|\*(?!\s)|[_#>`])*)BLOCKED\b([\s*_`:.\u2014\u2013-]*)(.*)$/)
  return { line, asks: blocked ? unwrap(blocked[1]! + blocked[2]!, blocked[3]!) : undefined, mute: !answer.trim() }
}
// Why a turn did not answer, in one word: undefined for an answer, '' for a cut whose cause the host did not name.
export const cutBy = (e: { isAborted?: boolean; reason?: string }) => e.isAborted || e.reason === 'aborted' ? 'aborted' : e.reason === 'answer' ? undefined : e.reason === 'refusal' ? 'refused' : e.reason === 'error' ? 'error' : ''
// The one place a tester's result is decided, at the end of a turn. by: cutBy's word. now: this run's ending but
// for its result. kept: the run before a resume with no sf-tester call since; its FAIL stays until a RESULT line.
// ran: its steps outside a scenario; an answer with no text after none is STOPPED, not a plain report.
export const verdict = (by: string | undefined, sc: string[], { line, asks, mute }: ReturnType<typeof said>, now: End, kept?: End, ran = 0): End => {
  const cut = by !== undefined
  if (cut && kept) return kept
  const result = line === 'FAIL' || sc.includes('FAIL') || (!line && kept?.result === 'FAIL') ? 'FAIL' : !cut && asks !== undefined ? 'BLOCKED'
    : cut || (mute && !sc.length && !ran) ? 'STOPPED' : sc.length === 0 ? line ?? 'DONE' : sc.every(s => s === 'PASS') ? 'PASS' : 'STOPPED'
  return { ...now, result, asked: (!cut && asks) || undefined, cause: by || undefined }
}
// A running tester keeps the digit it holds, 1 to 9, to its end, so no key moves under a finger; one with none
// takes the lowest free digit at each spawn, resume and end, and when a session starts with a stored list.
const seats = (list: Tester[]) => {
  const used = new Set(list.filter(t => !t.isDone).map(t => t.digit))
  return list.map(t => {
    if (t.isDone || t.digit) return t.isDone && t.digit ? { ...t, digit: undefined } : t
    const digit = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(n => !used.has(n))
    used.add(digit)
    return { ...t, digit }
  })
}
// How many of a tester's scenarios passed.
const passedOf = (sc: Scenario[]) => sc.filter(s => s.status === 'PASS').length
// The same list back when no tester has the id, so another subagent's calls change nothing.
const tester = (agentId: string | undefined, fn: (t: Tester) => Tester) => (list: Tester[]) =>
  list.some(t => t.agentId === agentId) ? list.map(t => (t.agentId === agentId ? fn(t) : t)) : list
// How deep a step acts, from its own args: an open form or dialog, a component and its parents in the map, an iframe.
const depth = (parents: Record<string, string> | undefined, name: string, seen = new Set<string>()): number =>
  parents?.[name] && !seen.has(name) ? 1 + depth(parents, parents[name]!, seen.add(name)) : 0
// A call that reads the org rather than the page (the API, Apex, the map) stays at page level, even with a form open.
const OFF_PAGE = new Set(['api', 'apex', 'object_context', 'map_feature', 'route', 'verify_live'])
const level = (t: Tester, a: Args, tool: string) => (OFF_PAGE.has(tool) ? 0
  : (t.form || a.inModal ? 1 : 0) + (a.lwcApiName ? 1 + depth(t.parents, str(a.lwcApiName)) : 0) + (a.frame ? 1 : 0))
// The open-form state a finished call leaves: an opener opens it, a save that saved, a cancel, a close or a new page ends it.
const OPENS = new Set(['create_record', 'edit_record', 'edit_inline', 'launch_action'])
const LEAVES = new Set(['cancel', 'open_record', 'open_list', 'open_tab', 'open_related_list', 'search', 'login_as'])
const formAfter = (tool: string, a: Args, text: string, open: boolean | undefined) =>
  OPENS.has(tool) ? !(tool === 'launch_action' && text.includes('"navigated":true'))
    : LEAVES.has(tool) || (tool === 'save' && text.includes('"outcome":"saved"')) || (tool === 'modal' && a.action === 'close') ? false
      : open
// A map's components as child -> parent, so a nested component's steps sit below its parent's.
const parentsOf = (text: string) => {
  try {
    const { components = {} } = JSON.parse(text) as { components?: Record<string, { children?: string[] }> }
    return Object.fromEntries(Object.entries(components).flatMap(([name, c]) => (c.children ?? []).map(child => [child, name])))
  } catch { return undefined }
}

// The calls that open a new toast window on the server, as act.armToasts does. Only a call that succeeded counts: a
// failed one may have stopped before arming (a click whose target was not found), or never reached the server (denied).
const ARMS = new Set(['click', 'press', 'save', 'upload_file'])
const arms = (tool: string, a: Args) => ARMS.has(tool)
  || (tool === 'run_route' && Array.isArray(a.steps) && (a.steps as { tool?: string }[]).some(s => ARMS.has(short(str(s?.tool)))))
// What a finished call tells the run view: who the tester is logged in as, the toasts the page raised, page errors.
const seen = (t: Tester, tool: string, a: Args, text: string, at: number | undefined): Partial<Tester> => {
  if (tool === 'login_as') return { persona: str(a.user) }
  // sf_start logs in as the alias owner again, so no Login As persona holds after it.
  if (tool === 'start') return { persona: undefined }
  // The server's toast window opens on a click, press, save or upload, a route's step included; a save also returns its toasts.
  const armed = arms(tool, a)
  const window = (t.window ?? 0) + (armed ? 1 : 0)
  // A route's own Login As or sf_start step sets the persona as a direct call does; its last one wins.
  const last = tool === 'run_route' && Array.isArray(a.steps)
    ? [...(a.steps as { tool?: string; args?: Args }[])].reverse().find(x => ['login_as', 'start'].includes(short(str(x?.tool)))) : undefined
  const who = last ? { persona: short(str(last.tool)) === 'login_as' ? str(last.args?.user) : undefined } : {}
  const moved = { ...who, ...(armed ? { window } : {}) }
  // Only these results carry toasts or errors; a page snapshot or an API read is never parsed here.
  if (!['save', 'toasts', 'wait', 'page_errors'].includes(tool)) return moved
  let body: { toasts?: { title?: string; message?: string }[]; errors?: unknown[] } = {}
  try { body = JSON.parse(text) } catch { return moved }
  if (tool === 'page_errors') return { errors: (t.errors ?? 0) + (body.errors?.length ?? 0) }
  // sf_wait and sf_toasts repeat the toasts since the last action, so one already listed for it is not listed again.
  const raised = (body.toasts ?? []).map(x => ({ text: [x.title, x.message].filter(Boolean).join(': '), at, window }))
    .filter(x => x.text && !t.toasts?.some(y => y.text === x.text && (y.window ?? 0) === window))
  return raised.length ? { ...moved, toasts: [...(t.toasts ?? []), ...raised].slice(-3) } : moved
}
// A step belongs to the scenario that is running, else to the tester.
const addSteps = (make: Step[] | ((t: Tester) => Step[])) => (t: Tester): Tester => {
  const added = typeof make === 'function' ? make(t) : make
  const at = t.scenarios?.findLastIndex(s => s.status === 'running') ?? -1
  return at < 0 ? { ...t, steps: [...t.steps, ...added] }
    : { ...t, scenarios: t.scenarios!.map((s, i) => (i === at ? { ...s, steps: [...s.steps, ...added] } : s)) }
}
const mapSteps = (fn: (s: Step) => Step) => (t: Tester): Tester =>
  ({ ...t, steps: t.steps.map(fn), scenarios: t.scenarios?.map(s => ({ ...s, steps: s.steps.map(fn) })) })
// sf_scenario's marks, applied in this order: plan, start, end.
// What sf_scenario end answered: code's verdict, whether it overruled the result passed, and the checks behind it.
type Served = { verdict?: string; overruled?: boolean; unplanned?: boolean; checks?: { tool?: string; expected?: unknown; pass?: boolean }[] }
const mark = (a: Args, got: Served = {}) => (t: Tester): Tester => {
  let list = [...(t.scenarios ?? [])]
  type Planned = Pick<Scenario, 'title' | 'kind' | 'requirement' | 'persona' | 'source'>
  for (const p of (a.plan as Planned[] | undefined) ?? []) {
    const { title, kind, requirement, persona, source } = p
    if (!list.some(s => s.title === title)) list.push({ title, kind, requirement, persona, source, status: 'pending', steps: [] })
  }
  const set = (title: unknown, change: Partial<Scenario>) => {
    if (typeof title !== 'string') return
    if (!list.some(s => s.title === title)) list.push({ title, kind: 'positive', status: 'pending', steps: [] })
    list = list.map(s => (s.title === title ? { ...s, ...change } : s))
  }
  // An overruled PASS has no reason of its own: the first failed check is it. An unplanned scenario was judged as positive.
  const failed = got.checks?.find(c => c.pass === false)
  const why = got.overruled && failed ? `overruled: ${failed.tool} ${JSON.stringify(failed.expected)?.slice(0, 60)}` : undefined
  // The plan's persona first; else whoever the tester is logged in as when the scenario starts.
  const planned = list.find(s => s.title === a.start)?.persona
  set(a.start, { status: 'running', ...((planned ?? t.persona) && { persona: planned ?? t.persona }) })
  // The end goes last: one call may start and end the same scenario.
  set(a.end, { status: (got.verdict ?? a.result) as Scenario['status'], reason: typeof a.reason === 'string' ? a.reason : why, ...(got.unplanned && { kind: 'positive' as const }) })
  return { ...t, scenarios: list }
}
// Example mapping: the scenarios under each requirement. A tester that names no requirement gets one unnamed group.
const groups = (t: Tester) => {
  const sc = t.scenarios ?? []
  return [...new Set(sc.map(s => s.requirement ?? ''))].map(name => ({ name, run: sc.filter(s => (s.requirement ?? '') === name) }))
}

export const register: Register = (on, options) => {
  still = options.blink === false
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sf-tester-pane', description: 'Show running sf-testers and their scenarios in a pane' })
    // Running testers an older pane stored have no digit yet.
    await quiet(update($, testers, list => (list.some(t => !t.isDone && !t.digit) ? seats(list) : list)))
    return next(e)
  })

  on('command.run', { command: 'sf-tester-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'sf-tester pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    // Read before next: a continued tester can run, and even end, before the spawn resolves.
    const startedAt = e.subagentType === 'sf-tester' ? await $.clock.now().catch(() => undefined) : undefined
    const started = await next(e)
    if (e.subagentType !== 'sf-tester' || !('agentId' in started) || !started.agentId) return started
    const label = e.prompt.match(/Timed benchmark run (\S+)/)?.[1] ?? (e.description || 'sf-tester')
    // The header is the feature under test: the first line that starts with Requirement, numbered any way before its
    // colon, else the task's description.
    const feature = e.prompt.match(/^[ \t>*_-]*requirement\b[^:\n]{0,20}:[ \t]*(.+)/im)?.[1]?.trim() ?? label
    // At the cap of 300 the oldest hidden test leaves first, then the oldest finished one, with its open toggles; a running
    // tester, one shown waiting for an answer or the one just spawned never does, so the list may pass 300.
    const evicted: string[] = []
    await quiet(update($, testers, list => {
      // SendMessage spawns the same agentId again: its row stays and runs again, unless it already ended after the send.
      const before = ({ turnAt, endedAt }: Tester, at = turnAt ?? endedAt) => at === undefined || startedAt === undefined || at <= startedAt
      if (list.some(t => t.agentId === started.agentId)) return seats(tester(started.agentId, t => (t.isDone && before(t) ? resumed(startedAt)(t) : t))(list))
      const grown = [...list, { agentId: started.agentId!, label, feature, isDone: false, steps: [], startedAt }]
      while (grown.length > 300) {
        const hidden = grown.findIndex(t => t.hidden)
        const i = hidden >= 0 ? hidden : grown.findIndex(t => t.isDone && !waits(t))
        if (i < 0) break
        evicted.push(...grown.splice(i, 1).map(t => t.agentId))
      }
      return seats(grown)
    }))
    if (evicted.length) await quiet(update($, open, ids => ids.filter(k => !evicted.some(id => k.startsWith(`${id}|`) || k.startsWith(`${id}/`)))))
    await quiet(blinking($))
    // A pane opened unasked waits undrawn in a narrow terminal: one toast a session says where the steps are.
    void quiet($.ui.open({ id: PANE, title: TITLE }).then(async o => {
      let first = false
      if (!o.isPlaced) await update($, told, was => { first = !was; return true })
      if (first) $.ui.toast('sf-tester is running. /sf-tester-pane shows its steps.')
    }))
    return started
  })

  on('tool.call', async ($, e, next) => {
    // A finished tester whose sf-tester tools run again was resumed, a hidden one too: it runs again, timed from now.
    // The call is a step of the new run, so the ending kept for a cut turn goes.
    if (e.agentId && e.tool.startsWith(PREFIX) && (await read($, testers)).some(t => t.agentId === e.agentId && (t.isDone || t.kept))) {
      const now = await $.clock.now().catch(() => undefined)
      await quiet(update($, testers, list => seats(tester(e.agentId, t => ({ ...(t.isDone ? resumed(now)(t) : t), kept: undefined }))(list))))
      await quiet(blinking($))
    }
    if (!e.agentId || !e.tool.startsWith(PREFIX)) return next(e)
    const args = e as unknown as Args
    const id = e.tool_use_id
    if (short(e.tool) === 'scenario') {
      const ran = await next(e)
      if (!('isError' in ran && ran.isError) && !('deny' in ran && ran.deny)) {
        // The server's answer can overrule the result the tester passed; a text that is not JSON leaves the tester's result.
        let got: Served = {}
        try { got = JSON.parse(String(ran.text ?? '')) ?? {} } catch {}
        await quiet(update($, testers, tester(e.agentId, mark(args, got))))
      }
      return ran
    }
    // A known route is planned steps: they show pending until the one call returns.
    const tool = short(e.tool)
    const route = (t: Tester) => tool === 'run_route' && Array.isArray(args.steps)
      ? (args.steps as { tool: string; args?: Args }[]).map((s, i): Step => ({ id: `${id}:${i}`, text: phrase(s.tool, s.args ?? {}), mark: 'pending', level: level(t, s.args ?? {}, short(s.tool)), route: true }))
      : []
    const shown = !HIDDEN.has(tool) || tool === 'run_route'
    const t0 = await $.clock.now().catch(() => undefined)
    if (shown) await quiet(update($, testers, tester(e.agentId, addSteps(x => [...(HIDDEN.has(tool) ? [] : [{ id, text: phrase(e.tool, args), mark: 'running' as Mark, level: level(x, args, tool) }]), ...route(x)]))))
    const ran = await next(e)
    const t1 = await $.clock.now().catch(() => undefined)
    const failed = 'deny' in ran && ran.deny !== undefined || 'isError' in ran && ran.isError === true
    if (!failed) {
      const text = String(ran.text ?? '')
      await quiet(update($, testers, tester(e.agentId, t => ({ ...t, form: formAfter(tool, args, text, t.form), ...(tool === 'map_feature' && { parents: parentsOf(text) }), ...seen(t, tool, args, text, t1) }))))
    }
    if (!shown) return ran
    const error = failed ? ('deny' in ran && ran.deny ? ran.deny : why(ran.text)) : undefined
    // A route that failed before any step (BAD_ARGS) names no step, so its first step takes the cross.
    const failedAt = failed ? Number(String(ran.text ?? '').match(/"failedAt":(\d+)/)?.[1] ?? 0) : -1
    const ms = t0 !== undefined && t1 !== undefined ? t1 - t0 : undefined
    await quiet(update($, testers, tester(e.agentId, mapSteps(s => {
      if (s.id === id) return { ...s, mark: failed ? 'failed' : 'done', error, ms }
      if (!s.id.startsWith(`${id}:`)) return s
      const i = Number(s.id.slice(id.length + 1))
      return !failed || i < failedAt ? { ...s, mark: 'done' } : i === failedAt ? { ...s, mark: 'failed', error } : { ...s, mark: 'pending' }
    }))))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const endedAt = await $.clock.now().catch(() => undefined)
      const turnStart = endedAt !== undefined && typeof e.durationMs === 'number' ? endedAt - e.durationMs : undefined
      const ended = tester(e.agentId, t => {
        // Still done: continued with no repeat spawn yet and no sf-tester call, so the resume runs here, from this turn's start.
        const run = t.isDone ? resumed(turnStart)(t) : t
        // turnAt: a repeat spawn that resolves after this never sets the tester running again. The kept ending is used up.
        return { ...run, ...verdict(cutBy(e), (run.scenarios ?? []).map(s => s.status), said(e.answer ?? ''), { ...ends(run), isDone: true, endedAt }, run.kept, run.steps.length), turnAt: endedAt, kept: undefined }
      })
      // The digit it held is free at once for a running tester that has none.
      await quiet(update($, testers, list => { const after = ended(list); return after === list ? list : seats(after) }))
      if (!(await read($, testers)).some(t => !t.isDone)) { tick?.cancel(); tick = undefined }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Clear and Dismiss hide a tester rather than drop it, so it can come back with its history.
    const list = (await read($, testers)).filter(t => !t.hidden)
    const lit = still || await read($, blink)
    const opened = await read($, open)
    const pick = await read($, picked)
    const clock = await $.clock.now().catch(() => undefined)
    const running = list.filter(t => !t.isDone)
    const done = list.filter(t => t.isDone)
    const scenarios = running.flatMap(t => t.scenarios ?? [])
    const count = (status: Scenario['status']) => scenarios.filter(s => s.status === status).length
    // The pane's own body, not the screen: the tab row and the close mark take rows the screen still counts.
    const rows = e.props.scroll.bodyRows
    const cols = Math.max(1, e.props.bodyColumns)
    // Two columns per level, so a form's steps sit under its opener; ponytail: capped at 4, a deeper chain reads as 4.
    // Each step counts from the shallowest step so far in its list, so a scenario that begins inside a form opened
    // before it starts at the top and nests only under openers of its own.
    const relative = (list: Step[]) => { let base = Infinity; return list.map(s => (s.level ?? 0) - (base = Math.min(base, s.level ?? 0))) }
    // A row with a mark and a status or a time stays on one line, cut at its end, until a press opens it in full.
    const wrapOf = (full: boolean) => (full ? 'wrap' : 'truncate-end')
    const rowsOf = (text: string, width: number, full: boolean) => (full ? lines(text, width) : 1)
    const isOpen = (...keys: string[]) => keys.some(k => opened.includes(k))
    // Rows one step takes, its error included, inset columns in from the pane's edges before its own indent.
    const tall = (s: Step, depth: number, inset: number, full: boolean) => {
      const width = cols - inset - 2 - 2 * Math.min(depth, 4)
      return rowsOf(`${ICON[s.mark]} ${s.text}`, width - side(s).length, full) + (s.mark === 'failed' && s.error ? lines(s.error, width - 2) : 0)
    }
    // How many of a list's newest steps show: a count, or the run view's fit per list, already filtered and levelled.
    // key and n: the earlier-steps line's state key and the steps the fit would cut, shown or not.
    type Shown = { list: Step[]; at: number[]; from: number; key: string; n: number }
    type Fit = number | Map<Step[], Shown>
    // skip: the step Current Action shows, left out of the list while it runs; full: its rows wrap instead of being cut.
    const steps = (all: Step[], n: Fit, skip?: Step, full = false) => {
      const got = typeof n === 'number' ? undefined : n.get(all)
      const list = got?.list ?? (skip ? all.filter(s => s !== skip) : all)
      const from = got ? got.from : typeof n === 'number' ? Math.max(0, list.length - n) : list.length
      const at = (got?.at ?? relative(list)).slice(from)
      // The first row of a cut list, or an opened one, counts the steps the fit cuts and opens or folds the list.
      const earlier = got && got.n > 0 ? [(
        <Box paddingLeft={2}>
          <Button key={`open:${got.key}`} plain onPress={toggle(got.key)}>
            <Text color="subtle" wrap="truncate-end">{opened.includes(got.key) ? '▾' : '▸'} {got.n} earlier step{got.n === 1 ? '' : 's'}</Text>
          </Button>
        </Box>
      )] : []
      return [...earlier, ...list.slice(from).map((s, i) => (
      <Box flexDirection="column" paddingLeft={2 + 2 * Math.min(at[i]!, 4)}>
        <Box justifyContent="space-between">
          <Box flexShrink={1}><Text color={COLOR[s.mark]} bold={s.mark === 'failed'} wrap={wrapOf(full)}>{s.mark === 'running' && !lit ? ' ' : ICON[s.mark]} {s.text}</Text></Box>
          <Text color={s.route ? 'success' : 'warning'} dimColor>{side(s)}</Text>
        </Box>
        {s.mark === 'failed' && s.error && <Box paddingLeft={2}><Text color="error" wrap="wrap">{s.error}</Text></Box>}
      </Box>
    ))] }
    // A press on a requirement or a scenario opens or folds its steps; the key is tester|requirement[|scenario].
    // The pane's own toggles are tester/word, which no requirement name can make.
    const toggle = (key: string) => () => void quiet(update($, open, ids => (ids.includes(key) ? ids.filter(id => id !== key) : [...ids, key])))
    // The arrow of a row whose press opens steps: open while those steps show.
    const arrow = (open: boolean) => <Text color="subtle">{open ? ' ▾' : ' ▸'}</Text>
    // Indent ladder: requirement 0, scenario 2, its steps 4, a step's error 6; a blank line between scenarios.
    type Draw = { ended?: boolean; gap?: boolean; skip?: Step }
    // A failed or running scenario always shows its steps; any other once it or its requirement is pressed open.
    const always = (s: Scenario, ended: boolean) => s.status === 'FAIL' || (!ended && s.status === 'running')
    const shows = (t: Tester, crit: string, s: Scenario, ended: boolean) => always(s, ended)
      || opened.includes(`${t.agentId}|${crit}|${s.title}`) || opened.includes(`${t.agentId}|${crit}`)
    // A scenario's status as drawn. Once the tester is done, one it never ended was not finished, not still to run.
    const tag = (s: Scenario, ended: boolean) => (ended && (s.status === 'pending' || s.status === 'running') ? ['not finished', 'warning'] as const : look(s.status))
    const scenario = (t: Tester, crit: string, s: Scenario, n: Fit, { ended = false, gap = false, skip }: Draw = {}) => {
      const [label, color] = tag(s, ended)
      const key = `${t.agentId}|${crit}|${s.title}`
      // A press opens the row in full; the arrow marks a scenario whose steps the press also opens.
      const full = isOpen(key, `${t.agentId}|${crit}`)
      const folds = !always(s, ended) && s.steps.length > 0
      const { beside, under } = who(s, cols - 2 - (s.status === 'FAIL' ? 4 : 0), label, full)
      // A Button holds only Text, so the title is the pressable part and the status stays right-aligned beside it.
      const name = [
        <Text bold wrap={wrapOf(full)}>{s.kind === 'negative' ? '−' : '+'} {s.title}</Text>,
        folds && arrow(full),
      ]
      const line = [
        <Box justifyContent="space-between">
          <Box flexShrink={1}><Button key={`open:${key}`} plain onPress={toggle(key)}>{name}</Button></Box>
          <Box>
            <Text> </Text>
            {beside && <Text color="suggestion">{beside}  </Text>}
            <Text bold color={color}>{label}</Text>
          </Box>
        </Box>,
        under && <Box paddingLeft={2}><Text color="suggestion" wrap="wrap">{under}</Text></Box>,
      ]
      if (s.status === 'FAIL') {
        return (
          <Box flexDirection="column" paddingLeft={2} marginTop={gap ? 1 : 0}>
            <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
              {line}
              {steps(s.steps, n, skip, full)}
              {s.reason && <Box paddingLeft={2}><Text color="error" wrap="wrap">{s.reason}</Text></Box>}
            </Box>
          </Box>
        )
      }
      return <Box flexDirection="column" paddingLeft={2} marginTop={gap ? 1 : 0}>{line}{shows(t, crit, s, ended) && steps(s.steps, n, skip, full)}</Box>
    }
    // The scenarios of a requirement whose steps a press opens: none of them, and the requirement has no arrow.
    const folding = (g: ReturnType<typeof groups>[number], ended: boolean) => g.run.filter(s => !always(s, ended) && s.steps.length > 0)
    const requirements = (t: Tester, n: Fit, { ended, skip, gs = groups(t), flush }: Omit<Draw, 'gap'> & { gs?: ReturnType<typeof groups>; flush?: boolean } = {}) => gs.map((g, i) => {
      const key = `${t.agentId}|${g.name}`
      const fold = folding(g, !!ended)
      const all = fold.length > 0 && fold.every(s => isOpen(key, `${key}|${s.title}`))
      // A press always shows: on an open arrow it closes the requirement and each scenario opened by itself.
      const shut = () => void quiet(update($, open, ids => ids.filter(id => id !== key && !g.run.some(s => id === `${key}|${s.title}`))))
      return (
        <Box flexDirection="column" marginTop={flush && i === 0 ? 0 : 1}>
          {g.name && (
            <Button key={`open:${key}`} plain onPress={all ? shut : toggle(key)}>
              <Text bold wrap={wrapOf(isOpen(key))}>Requirement: {g.name}</Text>{fold.length > 0 && arrow(all)}
            </Button>
          )}
          {g.run.map((s, j) => scenario(t, g.name, s, n, { ended, gap: j > 0, skip }))}
        </Box>
      )
    })
    // Rows of each requirement and scenario line (a failed one's border and reason); ended: also the steps a
    // finished block shows, which it draws whole.
    const heads = (t: Tester, gs: ReturnType<typeof groups>, ended = false) => gs.reduce((a, g) => a + 1 + (g.name ? rowsOf(`Requirement: ${g.name} ▸`, cols, isOpen(`${t.agentId}|${g.name}`)) : 0) + g.run.reduce((b, s, i) => {
      const box = s.status === 'FAIL' ? 4 : 0
      const full = isOpen(`${t.agentId}|${g.name}|${s.title}`, `${t.agentId}|${g.name}`)
      const { beside, under } = who(s, cols - 2 - box, tag(s, ended)[0], full)
      const right = ` ${beside && `${beside}  `}${tag(s, ended)[0]}`
      const at = relative(s.steps)
      return b + (i > 0 ? 1 : 0) + rowsOf(`${s.kind === 'negative' ? '−' : '+'} ${s.title}${!always(s, ended) && s.steps.length > 0 ? ' ▸' : ''}`, cols - 2 - box - right.length, full) + (under ? lines(under, cols - 2 - box - 2) : 0)
        + (box ? 2 + (s.reason ? lines(s.reason, cols - 2 - box - 2) : 0) : 0)
        + (ended && shows(t, g.name, s, true) ? s.steps.reduce((c, x, j) => c + tall(x, at[j]!, box ? 6 : 2, full), 0) : 0)
    }, 0), 0)
    // Every tester waiting for an answer shows, then the last three other finished ones; a header row counts the
    // older ones and a press on it shows them all.
    const waiting = done.filter(waits)
    const finished = done.filter(t => !waits(t))
    const older = finished.length - 3
    const recent = isOpen('more') ? finished : finished.slice(-3)
    // Done counts every ending with a result, so a FAIL that waits with a question is in Done, in FAIL and in waiting.
    const counted = done.filter(t => t.result !== 'BLOCKED')
    const pass = counted.filter(t => t.result === 'PASS').length
    const fail = counted.filter(t => t.result === 'FAIL').length
    const stop = counted.filter(stopped).length
    const totals = `Running ${running.length} · Done ${counted.length}`
    const plain = counted.filter(t => t.result === 'DONE').length
    const counts = [`${pass} PASS`, `${fail} FAIL`, ...(stop ? [`${stop} STOPPED`] : []), ...(plain ? [`${plain} DONE`] : [])]
    const wait = waiting.length ? ` · ${waiting.length} waiting` : ''
    // The status line; too wide for one row, its counts take a row of their own in place of a bracket that wraps.
    const one = `${totals} (${counts.join(', ')})${wait}`
    const status = one.length <= cols ? [one] : [`${totals}${wait}`, counts.join(' · ')]
    const clear = done.some(t => !waits(t))
    // A digit picks a running tester while the pane folds testers to rows; a finished block has no digit, so no key
    // ever hides a block and moves the next one under the same key.
    const digit = (t: Tester) => (t.digit ? String(t.digit) : undefined)
    // The keys row, under the two status lines so a change of focus moves neither: Clear, then one dim hint that names
    // the host's focus key while the pane lacks the keyboard. The hint goes first, under 20 rows or too narrow for both.
    const may = !e.props.isFocused && rows >= 20
    // The block's own words: a scenario under way is RUNNING and only a pending one is to run, each shown above 0.
    const tally = `Scenarios ${count('PASS')} PASS · ${count('FAIL')} FAIL${count('running') ? ` · ${count('running')} RUNNING` : ''}${count('pending') ? ` · ${count('pending')} to run` : ''}`
    // The header's rows: the status line, the scenario counts, the keys row and the older row. The keys row is held
    // with or without the keyboard, so a change of focus never changes which testers fold.
    const top = status.reduce((a, x) => a + lines(x, cols), 0) + (clear || (rows >= 20 && (running.length > 1 || waiting.length > 0)) ? 1 : 0) + (older > 0 ? 1 : 0) + (scenarios.length > 0 ? lines(tally, cols) : 0)
    // What a running tester's block and its one-row form both read: how many scenarios passed and failed, the
    // running scenario and step, and the RUNNING text with the elapsed time.
    const gist = (t: Tester) => {
      const sc = t.scenarios ?? []
      const now = [...sc].reverse().find(s => s.status === 'running')
      const elapsed = t.startedAt === undefined || clock === undefined ? '' : `  ${took(clock - t.startedAt)}`
      return { sc, now, elapsed, passed: passedOf(sc), fails: sc.filter(s => s.status === 'FAIL').length,
        step: [...(now?.steps ?? t.steps)].reverse().find(s => s.mark === 'running') }
    }
    // A digit picks its tester; the same digit again lets go.
    const choose = (t: Tester) => () => void quiet(update($, picked, id => (id === t.agentId ? '' : t.agentId)))
    // One running tester as one row: its digit, state, fail count, elapsed time and N of M, then its feature and the
    // running step. N of M shows while the feature keeps 20 columns beside it, the step while it keeps 8 beside
    // those 20, and the feature takes the rest.
    const row = (t: Tester, gap: boolean) => {
      const { sc, elapsed, passed, fails, step } = gist(t)
      const failed = fails > 0 ? ` · ${fails} FAIL` : ''
      const start = `${digit(t) ? '1: ' : ''}▸ ● RUNNING${failed}${elapsed}`
      const least = Math.min(20, title(t).length)
      const of = sc.length > 0 ? ` · ${passed} of ${sc.length} passed` : ''
      const tail = `${elapsed}${start.length + of.length + 3 + least <= cols ? of : ''} · `
      const free = cols - start.length - tail.length + elapsed.length
      const few = Math.min(8, step?.text.length ?? 0)
      const text = step && free - least - 5 >= few ? step.text : undefined
      const name = clip(title(t), text ? free - 5 - few : free)
      return (
        <Box marginTop={gap ? 1 : 0}>
          <Button key={`pick:${t.agentId}`} hotkey={digit(t)} plain onPress={choose(t)}>
            <Text wrap="truncate-end">
              <Text bold color="warning">▸ ● RUNNING</Text><Text color="error">{failed}</Text><Text color="subtle">{tail}</Text><Text>{name}</Text>
              {text && <Text color="warning"> · {lit ? ICON.running : ' '} {text}</Text>}
            </Text>
          </Button>
        </Box>
      )
    }
    // One block per running tester, and the rows it holds: its fixed rows and the steps its share kept.
    // keyed: the pane folds the others to rows, so this block shows its digit and the mark of the one in full.
    const block = (t: Tester, share: number, keyed = false) => {
      const { sc, now, elapsed, passed, fails, step } = gist(t)
      // The run view: elapsed time and how many scenarios passed, one bar cell per scenario in its colour.
      const wide = Math.min(cols, 40)
      const cell = Math.max(1, Math.floor(wide / Math.max(1, sc.length)))
      // More scenarios than cells: a cell stands for several, and shows a failed one first, then a running, then a pending one.
      const bar = sc.length <= wide ? sc.map(s => s.status as string) : Array.from({ length: wide }, (_, i) => {
        const part = sc.slice(Math.floor(i * sc.length / wide), Math.floor((i + 1) * sc.length / wide)).map(s => s.status as string)
        return ['FAIL', 'running', 'pending'].find(x => part.includes(x)) ?? part[0]!
      })
      // The tester's header and what the page showed are one row each until pressed open.
      const titleKey = `${t.agentId}/title`
      const seenKey = `${t.agentId}/seen`
      const toastRows = (t.toasts ?? []).reduce((a, x) => a + rowsOf(`toast  "${x.text}"`, cols - 2 - (x.at === undefined ? 0 : 9), isOpen(seenKey)), 0)
      const notes = t.toasts?.length || t.errors !== undefined ? 2 + toastRows + (t.errors === undefined ? 0 : 1) : 0
      // The Current Action header, built once so its wrapped rows are budgeted as well as drawn: the running
      // scenario's requirement, else its own title, else the tester's header as drawn above.
      const about = now?.requirement || now?.title || title(t)
      const as = t.persona ? ` · as ${t.persona}` : ''
      const header = lines(`Current Action - ${about}${as}`, cols - 4)
      // Rows besides the steps: the RUNNING block, each requirement and scenario line (a failed one's border and
      // reason), the notes, and the Current Action box, kept free between steps so the list holds its size.
      const gs = groups(t)
      // The RUNNING line, the bar and the counts are one row each, the bar and counts only with scenarios.
      const roomy = 2 + rowsOf(title(t), cols, isOpen(titleKey)) + (sc.length ? 2 + heads(t, gs) : 0) + notes + 3 + header + (step ? lines(`${ICON.running} ${step.text}`, cols - 4) : 1)
      // The newest steps that fit the rows left, the running scenario's first, then the others newest first; once one
      // list is cut, an older one gets only what it reserved (its line, or its whole height when shorter); an open one
      // passes on what it did not use.
      const lists = sc.length === 0 ? [{ all: t.steps, inset: 0, here: true, key: `${t.agentId}/earlier`, full: isOpen(titleKey) }]
        : gs.flatMap(g => g.run.filter(s => shows(t, g.name, s, false)).map(s => ({ all: s.steps, inset: s.status === 'FAIL' ? 6 : 2, here: s === now, key: `${t.agentId}|${g.name}|${s.title}|earlier`, full: isOpen(`${t.agentId}|${g.name}|${s.title}`, `${t.agentId}|${g.name}`) })))
      const fit = new Map<Step[], Shown>()
      const order = [...lists.filter(l => l.here), ...lists.filter(l => !l.here).reverse()].map(l => {
        const list = step ? l.all.filter(s => s !== step) : l.all
        const at = relative(list)
        // must: a failed scenario's failed step, which stays in view with the steps after it whatever the room.
        const must = l.inset === 6 ? list.findLastIndex(s => s.mark === 'failed') : -1
        // least: the rows the list cannot give up, those steps and one row for a step or the earlier-steps line.
        const least = (must > 0 || (must < 0 && list.length) ? 1 : 0) + (must < 0 ? 0 : list.slice(must).reduce((a, x, j) => a + tall(x, at[must + j]!, l.inset, l.full), 0))
        return { ...l, list, at, must, least }
      })
      // What a block gives up when its share is short, in order: the steps it need not show, then its bar and its
      // counts, so a failed step and the Current Action box both stay; with several running the pane then folds.
      const need = order.reduce((a, l) => a + l.least, 0)
      const snug = sc.length > 0 && roomy + need > share
      const fixed = roomy - (snug ? 2 : 0)
      // Every list holds its least rows back from the lists served before it.
      let left = share - fixed - need
      let kept = 0
      for (const { all, inset, key, list, at, full, must, least } of order) {
        left += least
        // The newest steps that fit the room; a cut list then drops its oldest shown steps until its line fits. An open
        // list keeps its steps out of the budget but pays for its line, and one that fits whole is charged either way.
        let k = 0
        let room = left
        const hs: number[] = []
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const h = tall(list[i]!, at[i]!, inset, full)
          if (h > room && (must < 0 || i < must)) break
          room -= h
          hs.push(h)
          k += 1
        }
        const cut = k < list.length
        while (cut && k > 0 && room < 1 && (must < 0 || list.length - k < must)) { room += hs.pop()!; k -= 1 }
        const open = cut && opened.includes(key)
        left = open ? Math.max(0, left - 1) : cut ? 0 : Math.max(0, room)
        const from = open ? 0 : list.length - k
        fit.set(all, { list, at, from, key, n: list.length - k })
        kept += (cut ? 1 : 0) + list.slice(from).reduce((a, x, j) => a + tall(x, at[from + j]!, inset, full), 0)
      }
      const state = <Text wrap="truncate-end"><Text bold color="warning">{keyed ? '▾ ' : ''}● RUNNING</Text><Text color="subtle">{elapsed}</Text></Text>
      // Beside it the count and the fails; a row too narrow for both drops the word passed, then the count.
      const ahead = (keyed ? (t.digit ? 5 : 2) : 0) + 9 + elapsed.length
      const fail = fails ? `${fails} FAIL` : ''
      const tally = [`${passed} of ${sc.length} passed`, `${passed} of ${sc.length}`].find(x => ahead + 1 + x.length + (fail ? 3 + fail.length : 0) <= cols) ?? ''
      const node = (
        <Box flexDirection="column" marginTop={1}>
          <Box justifyContent="space-between">
            <Box>{keyed ? <Button key={`pick:${t.agentId}`} hotkey={digit(t)} plain onPress={choose(t)}>{state}</Button> : state}</Box>
            {sc.length > 0 && <Text color="subtle">{tally}{tally && fail && ' · '}<Text color="error">{fail}</Text></Text>}
          </Box>
          {sc.length > 0 && !snug && (
            <Text wrap="truncate-end">{bar.map(status => <Text color={status === 'pending' ? 'subtle' : look(status)[1]}>{(CELL[status] ?? '▰').repeat(cell)}</Text>)}</Text>
          )}
          <Button key={`open:${titleKey}`} plain onPress={toggle(titleKey)}><Text bold color="suggestion" wrap={wrapOf(isOpen(titleKey))}>{title(t)}</Text></Button>
          {sc.length > 0 && !snug && (
            <Text color="subtle" wrap="truncate-end">
              {sc.filter(s => s.kind === 'positive').length} positive · {sc.filter(s => s.kind === 'negative').length} negative
            </Text>
          )}
          {/* The step in Current Action leaves the list until it ends, so it never shows twice. */}
          {sc.length === 0 ? steps(t.steps, fit, step, isOpen(titleKey)) : requirements(t, fit, { skip: step, gs })}
          {notes > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Button key={`open:${seenKey}`} plain onPress={toggle(seenKey)}><Text color="subtle" bold wrap="truncate-end">SEEN ON THE PAGE</Text></Button>
              {(t.toasts ?? []).map(x => (
                <Box justifyContent="space-between" paddingLeft={2}>
                  <Box flexShrink={1}><Text wrap={wrapOf(isOpen(seenKey))}><Text color="subtle">toast  </Text>"{x.text}"</Text></Box>
                  <Text color="subtle">{x.at === undefined ? '' : ` ${new Date(x.at).toTimeString().slice(0, 8)}`}</Text>
                </Box>
              ))}
              {t.errors !== undefined && <Box paddingLeft={2}><Text wrap="truncate-end"><Text color="subtle">errors </Text><Text color={t.errors ? 'error' : 'success'}>{t.errors} on the page</Text></Text></Box>}
            </Box>
          )}
          {/* Current Action comes last: the running step, the requirement it serves and who is logged in, so coming and going
              moves nothing above it. */}
          {step && (
            <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginTop={1}>
              <Text wrap="wrap"><Text color="subtle">Current Action - </Text><Text bold>{about}</Text><Text color="subtle">{as}</Text></Text>
              <Text color="warning" wrap="wrap">{lit ? ICON.running : ' '} {step.text}</Text>
            </Box>
          )}
        </Box>
      )
      return { node, used: fixed + kept, least: fixed + need }
    }
    const bad = (t: Tester) => t.steps.filter(s => s.mark === 'failed').length
    const verdictOf = (t: Tester) => {
      const run = t.scenarios ?? []
      return t.result === 'BLOCKED' ? 'BLOCKED · waiting for you' : `${stopped(t) ? 'STOPPED' : t.result}${t.cause ? ` · ${t.cause}` : ''} · ${run.length > 0 ? `${passedOf(run)} of ${run.length} scenarios passed` : `${t.steps.length} step${t.steps.length === 1 ? '' : 's'}${t.result === 'DONE' && bad(t) ? `, ${bad(t)} failed` : ''}`}`
    }
    const pressOf = (t: Tester) => (waits(t) ? 'Dismiss' : 'Clear')
    // When it ran and for how long, dim after the verdict: at level 0 both, at 1 the duration, at 2 neither.
    const whenOf = (t: Tester, drop: number) => {
      const at = t.startedAt === undefined || drop > 0 ? [] : [new Date(t.startedAt).toTimeString().slice(0, 5)]
      const ran = t.startedAt === undefined || t.endedAt === undefined || drop > 1 ? [] : [took(t.endedAt - t.startedAt)]
      return ` ${[...at, ...ran, ''].join(' · ')}`
    }
    // No verdict is cut: the rows drop the clock time first, then the duration, and all of them the same parts.
    const drop = [0, 1].find(l => [...waiting, ...recent].every(t => verdictOf(t).length + whenOf(t, l).length + pressOf(t).length <= cols)) ?? 2
    // A finished or waiting block and the rows it draws. One that does not fit its room shows its failed scenarios
    // and its first unfinished one under a row that counts the others and opens them.
    const ending = (t: Tester, room: number) => {
      const run = t.scenarios ?? []
      const hasScenarios = run.length > 0
      // Steps outside any scenario (a login, a context read) fold under one line of their own.
      const loose = `${t.agentId}/steps`
      const says = verdictOf(t)
      const press = pressOf(t)
      const when = whenOf(t, drop)
      const gs = groups(t)
      // Folded, a block keeps its failed scenarios and the first unfinished one; the fold row counts the others.
      const next = run.find(s => s.status !== 'PASS' && s.status !== 'FAIL')
      const short = gs.map(g => ({ ...g, run: g.run.filter(s => s.status === 'FAIL' || s === next) })).filter(g => g.run.length > 0)
      const more = run.length - short.reduce((a, g) => a + g.run.length, 0)
      const passes = passedOf(run)
      const rest = more === passes ? `${passes} passed scenario${passes === 1 ? '' : 's'}` : `${passes ? `${passes} passed · ` : ''}${more - passes} more not finished`
      const all = `${t.agentId}/all`
      // The rule and its blank row, the verdict beside its time and its press, the feature, the question.
      const fixedRows = 2 + lines(says, cols - when.length - press.length) + rowsOf(title(t), cols, isOpen(`${t.agentId}/title`)) + (t.asked ? lines(`Question: ${t.asked}`, cols) : 0)
      const tail = t.steps.length === 0 ? 0 : 2 + (opened.includes(loose) ? relative(t.steps).reduce((a, at, j) => a + tall(t.steps[j]!, at, 0, true), 0) : 0)
      const whole = fixedRows + heads(t, gs, true) + tail
      // Folded, the others are one row under a blank one (the kept ones' own blank row, or one more when none is kept);
      // a block that folding makes one row shorter at most stays whole. A waiting block always folds.
      const folded = fixedRows + heads(t, short, true) + (short.length ? 1 : 2)
      const fits = more === 0 || folded + 1 >= whole || (!waits(t) && whole <= room)
      // Pressed open it is one list again, the scenarios that did not pass first.
      const passed = (s: Scenario) => Number(s.status === 'PASS')
      const first = gs.map(g => ({ ...g, run: [...g.run].sort((a, b) => passed(a) - passed(b)) })).sort((a, b) => passed(a.run[0]!) - passed(b.run[0]!))
      // One block per finished feature: the verdict, the feature, each requirement, then the loose steps.
      const node = (
        <Box flexDirection="column" marginTop={1}>
          <Text color="subtle">{'─'.repeat(Math.min(cols, 40))}</Text>
          <Box justifyContent="space-between">
            <Box flexShrink={1}><Text bold wrap="wrap" color={t.result === 'PASS' ? 'success' : t.result === 'FAIL' ? 'error' : t.result === 'DONE' && !bad(t) ? 'subtle' : 'warning'}>{says}</Text></Box>
            {/* One finished test or one wait nobody will answer is hidden by hand; one resumed since this draw stays. */}
            <Box><Text color="subtle">{when}</Text>
            <Button key={`hide:${t.agentId}`} plain onPress={() => void quiet(update($, testers, tester(t.agentId, x => (x.isDone ? { ...x, hidden: true } : x))))}>
              <Text color="subtle">{press}</Text>
            </Button></Box>
          </Box>
          <Button key={`open:${t.agentId}/title`} plain onPress={toggle(`${t.agentId}/title`)}><Text wrap={wrapOf(isOpen(`${t.agentId}/title`))}>{title(t)}</Text></Button>
          {t.asked && <Text color="warning" wrap="wrap">Question: {t.asked}</Text>}
          {/* The fold row sits above the scenarios it opens, so a press never moves it. */}
          {!fits && (
            <Box marginTop={1}>
              <Button key={`open:${all}`} plain onPress={toggle(all)}><Text color="subtle" wrap="truncate-end">{isOpen(all) ? '▾' : '▸'} {rest}</Text></Button>
            </Box>
          )}
          {requirements(t, Infinity, { ended: true, gs: fits ? gs : isOpen(all) ? first : short, flush: !fits })}
          {(fits || isOpen(all)) && t.steps.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Button key={`open:${loose}`} plain onPress={toggle(loose)}>
                <Text color="subtle">{hasScenarios ? `Steps outside a scenario (${t.steps.length})` : `Steps (${t.steps.length})`}</Text>{arrow(opened.includes(loose))}
              </Button>
              {opened.includes(loose) && steps(t.steps, Infinity, undefined, true)}
            </Box>
          )}
        </Box>
      )
      // A folded block pressed open is charged what it draws: every scenario under its fold row.
      return { node, used: fits ? whole : isOpen(all) ? whole + 1 : folded }
    }
    // The pane's rows are one budget with one owner: spare. Claims run in the order of the lines below, and each
    // takes what the ones before it left. First the header.
    let spare = rows - top
    const claim = <T extends { used: number }>(x: T) => { spare -= x.used; return x }
    // Then each waiting block, the newest first, above the running blocks so its question stays in view.
    const asks = [...waiting].reverse().map(t => claim(ending(t, spare)))
    // Then the running testers, an equal share each.
    const share = Math.floor(spare / Math.max(1, running.length))
    // A full block needs its fixed rows and the least rows of its step lists. With a share below that for any
    // tester, one shows in full, the one a digit picked, else the first, and each other is one row.
    const even = running.map(t => block(t, share))
    const tight = running.length > 1 && even.some(b => b.least > share)
    const lead = running.find(t => t.agentId === pick) ?? running[0]
    // The one-row testers take their rows first, under one blank row and above the block in full, so a block
    // taller than the pane never pushes them out of it.
    const rest = running.filter(t => t !== lead)
    const blocks = tight ? [...rest.map((t, i) => ({ node: row(t, i === 0), used: i === 0 ? 2 : 1 })), block(lead!, spare - rest.length - 1, true)] : even
    blocks.forEach(claim)
    // The hint shows while it has something to reach: a key (Clear, the digits of a folded pane), else a Dismiss.
    const HINT = clear || tight ? 'ctrl+x tab to use keys' : 'ctrl+x tab, then tab to Dismiss'
    const keyed = may && (clear || tight || waiting.length > 0) && (clear ? 'c: Clear · '.length : 0) + HINT.length <= cols
    // Last the finished blocks, the newest first.
    const last = [...recent].reverse().map(t => claim(ending(t, spare)))
    return (
      <Box flexDirection="column">
        {status.map(x => <Text bold wrap="wrap">{x}</Text>)}
        {scenarios.length > 0 && <Text color="subtle" wrap="wrap">{tally}</Text>}
        {(clear || keyed) && (
          <Box>
            {/* Clear hides the finished tests; a running tester and a question waiting for you stay. */}
            {clear && (
              <Button key="clear" hotkey="c" plain onPress={() => {
                // Hides every finished tester as the state stands at the press, not at the draw.
                void quiet(update($, testers, l => l.map(t => (t.isDone && !waits(t) ? { ...t, hidden: true } : t))))
              }}>
                <Text color="subtle">Clear</Text>
              </Button>
            )}
            {clear && keyed && <Text color="subtle"> · </Text>}
            {keyed && <Text dimColor>{HINT}</Text>}
          </Box>
        )}
        {older > 0 && (
          <Button key="more" hotkey="m" plain onPress={toggle('more')}>
            <Text dimColor wrap="truncate-end">{isOpen('more') ? '▾' : '▸'} {older} older finished</Text>
          </Button>
        )}
        {list.length === 0 && <Text dimColor>No sf-tester to show.</Text>}
        {asks.map(b => b.node)}
        {blocks.map(b => b.node)}
        {last.map(b => b.node)}
      </Box>
    )
  })
}
