import { expect, mock, test } from 'claude-code/testing'

import { cutBy, said, verdict } from '../hooks/register'
import type { End, Tester } from '../types'

const PANE = {
  plugin: 'sf-tester-pane',
  component: 'Pane',
  requestId: 'sf-tester-pane',
  props: { title: 'sf-tester', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  surface: 'terminal',
} as const

// The column a Text starts at in the drawn tree: every Box above it adds its paddingLeft, paddingX and a border.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
// A Text with Texts inside is one line on screen, so its words are joined rather than read part by part.
const words = (d: Drawn): string => (d.children ?? []).map(k => (typeof k === 'string' ? k : k && typeof k === 'object' ? words(k as Drawn) : '')).join('')
const indent = (node: Drawn, match: RegExp, at = 0): number | undefined => {
  const kids = node.children ?? []
  if (node.type === 'Text') return match.test(words(node)) ? at : undefined
  const p = node.props ?? {}
  const inner = at + Number(p.paddingLeft ?? 0) + Number(p.paddingX ?? 0) + (p.borderStyle ? 1 : 0)
  for (const k of kids) {
    const hit = k && typeof k === 'object' ? indent(k as Drawn, match, inner) : undefined
    if (hit !== undefined) return hit
  }
  return undefined
}

// How many drawn lines (outermost Texts, their nested Texts joined) pass the check.
const texts = (n: Drawn, has: (s: string) => boolean): number => (n.type === 'Text' ? (has(words(n)) ? 1 : 0)
  : (n.children ?? []).reduce((a: number, k) => a + (k && typeof k === 'object' ? texts(k as Drawn, has) : 0), 0))

// A finished tester puts the keys row in the header, so every run measured after it has the same rows above it.
const keysRow = async ($: any) => {
  const { agentId } = await $.agent.spawn({ prompt: 'Requirement: Earlier.', description: 'e', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.turn.complete({ agentId, answer: 'RESULT k: PASS', durationMs: 1, isAborted: false, turnId: agentId, reason: 'answer' } as never)
}

const ROUTE = [
  { tool: 'sf_click', args: { recordId: 'a00', role: 'combobox', name: 'Size' } },
  { tool: 'sf_click', args: { role: 'option', name: 'Large' } },
  { tool: 'sf_wait', args: { text: 'Size chosen' } },
]

test('a known route reads as a QA scenario, ticks up to the failed step and ends with the verdict', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => (e.tool === 'mcp__sf-tester__sf_run_route'
    ? { isError: true, result: {}, text: '{"code":"ROUTE_STEP_FAILED","evidence":{"failedAt":1}}' }
    : { result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ prompt: 'Timed benchmark run combobox@record-tab/C1 of the sf-tester.\n\nRequirement: Choose "Large" in the Size picklist.\n\nA known route', description: 'bench', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_start', tool_use_id: 't0', agentId: 'a1', session: 'new' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_launch_action', tool_use_id: 't1', agentId: 'a1', recordId: 'a00', apiName: 'SfUiProbe__c.Inputs_Flow' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_run_route', tool_use_id: 't2', agentId: 'a1', steps: ROUTE } as never)
  // A call from a loop that is not a tester stays out of the pane.
  await $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: 't3', agentId: 'other', name: 'Stray' } as never)

  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
  expect(await ui.find({ type: 'Text', text: /^Scenarios/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /picklist\.$/ }))?.text).toBe('C1: Choose "Large" in the Size picklist.')
  expect(await ui.find({ type: 'Text', text: /start|run_route/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /action/ }))?.text).toBe('✓ Click the "Inputs Flow" action')
  expect((await ui.find({ type: 'Text', text: /Open the/ }))?.text).toBe('✓ Open the "Size" picklist')
  expect((await ui.find({ type: 'Text', text: /^✗/ }))?.text).toBe('✗ Choose "Large"')
  expect((await ui.find({ type: 'Text', text: /Wait/ }))?.text).toBe('· Wait for "Size chosen"')
  expect(await ui.find({ type: 'Text', text: /Stray/ })).toBeUndefined()
  await ui.unmount()

  await $.turn.complete({ agentId: 'a1', answer: 'RESULT combobox@record-tab/C1: FAIL', durationMs: 1, isAborted: false, turnId: 'u1', reason: 'answer' } as never)
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 0 · Done 1 (0 PASS, 1 FAIL)')
  expect((await ui.find({ type: 'Text', text: /^FAIL/ }))?.text).toBe('FAIL · 4 steps')
  expect((await ui.find({ type: 'Text', text: /^C1:/ }))?.text).toBe('C1: Choose "Large" in the Size picklist.')
  await ui.unmount()
})

test('a spawn of another agent type adds no tester', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'x1' }))
  await $.agent.spawn({ prompt: 'look around', description: 'explore', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' } } as never)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /No sf-tester/ }))).toBeDefined()
  await ui.unmount()
})

test('scenarios group the steps, a passed one folds, a failed one keeps its broken step, error and reason', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a2' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => (e.tool === 'mcp__sf-tester__sf_wait'
    ? { isError: true, result: {}, text: '{"code":"TIMEOUT","message":"no text \\"Enter a Reason\\" in 10000 ms"}' }
    : { result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const call = (n: number, tool: string, args: object) => $.tool.call({ tool: `mcp__sf-tester__${tool}`, tool_use_id: `u${n}`, agentId: 'a2', ...args } as never)

  await $.agent.spawn({ prompt: 'Check this.\n\nRequirement: Closing a case needs a Reason.', description: 'case', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, 'sf_scenario', { plan: [{ title: 'A case with a Reason closes', kind: 'positive' }, { title: 'No Reason is refused', kind: 'negative' }], start: 'A case with a Reason closes' })
  await call(2, 'sf_click', { role: 'option', name: 'Closed' })
  await call(3, 'sf_scenario', { end: 'A case with a Reason closes', result: 'PASS', start: 'No Reason is refused' })
  await call(4, 'sf_save', {})
  await call(5, 'sf_wait', { text: 'Enter a Reason' })
  await call(6, 'sf_scenario', { end: 'No Reason is refused', result: 'FAIL', reason: 'the case saved with no Reason' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
  expect((await ui.find({ type: 'Text', text: /^Scenarios/ }))?.text).toBe('Scenarios 1 PASS · 1 FAIL')
  expect((await ui.find({ type: 'Text', text: /^Closing/ }))?.text).toBe('Closing a case needs a Reason.')
  expect((await ui.find({ type: 'Text', text: /positive ·/ }))?.text).toBe('1 positive · 1 negative')
  expect((await ui.find({ type: 'Text', text: /^\+ / }))?.text).toBe('+ A case with a Reason closes')
  // A passed scenario folds to its line: its step is not drawn.
  expect(await ui.find({ type: 'Text', text: /Choose "Closed"/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^− / }))?.text).toBe('− No Reason is refused')
  expect((await ui.find({ type: 'Text', text: /Save$/ }))?.text).toBe('✓ Save')
  expect((await ui.find({ type: 'Text', text: /^✗ / }))?.text).toBe('✗ Wait for "Enter a Reason"')
  expect((await ui.find({ type: 'Text', text: /^TIMEOUT/ }))?.text).toBe('TIMEOUT: no text "Enter a Reason" in 10000 ms')
  expect((await ui.find({ type: 'Text', text: /saved with no Reason/ }))?.text).toBe('the case saved with no Reason')
  await ui.unmount()
})

test('a finished feature is its own block: verdict, requirement, then each scenario, an unended one not finished', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a3' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const call = (n: number, args: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `v${n}`, agentId: 'a3', ...args } as never)

  await $.agent.spawn({ prompt: 'Requirement 1: The code check refuses ab and accepts ABC.', description: 'code', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, { plan: [{ title: 'ab is refused', kind: 'negative' }, { title: 'ABC is accepted', kind: 'positive' }], start: 'ab is refused' })
  await call(2, { end: 'ab is refused', result: 'PASS', start: 'ABC is accepted' })
  await $.turn.complete({ agentId: 'a3', answer: 'All checked.', durationMs: 1, isAborted: false, turnId: 'w1', reason: 'answer' } as never)

  const ui = await $.ui.mount(PANE)
  // One scenario never ended and no RESULT line came: the run stopped, it did not pass.
  expect((await ui.find({ type: 'Text', text: /^STOPPED ·/ }))?.text).toBe('STOPPED · 1 of 2 scenarios passed')
  expect((await ui.find({ type: 'Text', text: /^The code check/ }))?.text).toBe('The code check refuses ab and accepts ABC.')
  expect((await ui.find({ type: 'Text', text: /^− / }))?.text).toBe('− ab is refused')
  expect((await ui.find({ type: 'Text', text: /not finished/ }))?.text).toBe('not finished')
  await ui.unmount()
})

test('each requirement groups its scenarios, and every scenario run counts, an org-rule check too', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a4' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const call = (n: number, args: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `x${n}`, agentId: 'a4', ...args } as never)

  await $.agent.spawn({ prompt: 'Requirement: Case closing.', description: 'case', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, { plan: [
    { title: 'Closing with a Reason saves', kind: 'positive', requirement: 'Close with a Reason', source: 'requirement' },
    { title: 'Reason_Required blocks a blank Reason', kind: 'negative', requirement: 'Reopen', source: 'org rule', technique: 'invalid partition' },
  ], start: 'Closing with a Reason saves' })
  await call(2, { end: 'Closing with a Reason saves', result: 'PASS', start: 'Reason_Required blocks a blank Reason' })
  await call(3, { end: 'Reason_Required blocks a blank Reason', result: 'FAIL', reason: 'the case saved with a blank Reason' })

  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Scenarios/ }))?.text).toBe('Scenarios 1 PASS · 1 FAIL')
  expect((await ui.find({ type: 'Text', text: /^Requirement: Close/ }))?.text).toBe('Requirement: Close with a Reason')
  expect((await ui.find({ type: 'Text', text: /^Requirement: Reopen/ }))?.text).toBe('Requirement: Reopen')
  // One indent ladder: requirement 0, scenario 2.
  const tree = (await ui.drawn()) as Drawn
  expect([/^Requirement: Close/, /^\+ Closing/].map(re => indent(tree, re))).toEqual([0, 2])
  await ui.unmount()

  await $.turn.complete({ agentId: 'a4', answer: 'done', durationMs: 1, isAborted: false, turnId: 'y1', reason: 'answer' } as never)
  ui = await $.ui.mount(PANE)
  // The org-rule check ran, so it counts: 1 of 2 passed, and the run is a FAIL.
  expect((await ui.find({ type: 'Text', text: /^FAIL ·/ }))?.text).toBe('FAIL · 1 of 2 scenarios passed')
  await ui.unmount()
})

test('the current step blinks, and a finished test shows when it ran and opens its steps on a press', async ($, on) => {
  const start = Date.UTC(2026, 9, 21, 6, 30, 0)
  const clock = mock.clock(on, { now: start })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a5' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'z1') await held; return { result: {}, text: '{"ok":true}' } })
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ prompt: 'Requirement: Next opens the second screen.', description: 'next', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  const clicking = $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: 'z1', agentId: 'a5', name: 'Next' } as never)
  await clock.advance(0) // the call is held open: let its step land first
  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Click "Next"/ }))?.text).toBe('> Click "Next"')
  await ui.unmount()
  await clock.advance(500)
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Click "Next"/ }))?.text).toBe('  Click "Next"')
  await ui.unmount()

  release()
  await clicking
  await clock.advance(80_500) // 81 s after the spawn
  await $.turn.complete({ agentId: 'a5', answer: 'RESULT next: PASS', durationMs: 1, isAborted: false, turnId: 'z9', reason: 'answer' } as never)
  const at = new Date(start).toTimeString().slice(0, 5)
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^PASS ·/ }))?.text).toBe('PASS · 1 step')
  expect((await ui.find({ type: 'Text', text: /1m 21s/ }))?.text).toBe(` ${at} · 1m 21s · `)
  // Folded until pressed: the finished test's steps are not drawn.
  expect(await ui.find({ type: 'Text', text: /Click "Next"/ })).toBeUndefined()
  await ui.press({ key: 'open:a5/steps' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Click "Next"/ }))?.text).toBe('✓ Click "Next"')
  await ui.unmount()
})

test('a finished scenario opens its own steps on a press, and a requirement opens all of its scenarios', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a6' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const scenario = (n: number, args: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `s${n}`, agentId: 'a6', ...args } as never)
  const click = (n: number, name: string) => $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: `c${n}`, agentId: 'a6', name } as never)

  await $.agent.spawn({ prompt: 'Requirement: Count never below zero.', description: 'count', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await scenario(1, { plan: [
    { title: 'Count -1 is blocked', kind: 'negative', requirement: 'Count' },
    { title: 'Count 0 saves', kind: 'positive', requirement: 'Count' },
  ], start: 'Count -1 is blocked' })
  await click(1, 'Minus')
  await scenario(2, { end: 'Count -1 is blocked', result: 'PASS', start: 'Count 0 saves' })
  await click(2, 'Zero')
  await scenario(3, { end: 'Count 0 saves', result: 'PASS' })
  await $.turn.complete({ agentId: 'a6', answer: 'done', durationMs: 1, isAborted: false, turnId: 'q1', reason: 'answer' } as never)

  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Click "Minus"/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Click "Zero"/ })).toBeUndefined()
  // One scenario pressed: only its steps open.
  await ui.press({ key: 'open:a6|Count|Count -1 is blocked' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Click "Minus"/ }))?.text).toBe('✓ Click "Minus"')
  expect(await ui.find({ type: 'Text', text: /Click "Zero"/ })).toBeUndefined()
  // The requirement pressed: every scenario under it opens.
  await ui.press({ key: 'open:a6|Count' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Click "Zero"/ }))?.text).toBe('✓ Click "Zero"')
  await ui.unmount()
})

test('steps indent by how deep they act: a form under its opener, a mapped child under its parent, an iframe under both', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a7' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const TEXT: Record<string, string> = {
    m2: '{"outcome":"blocked"}',
    m4: '{"outcome":"saved"}',
    m6: '{"components":{"probePanel":{"children":["probeChild"]}}}',
  }
  on('tool.call', (_, e) => ({ result: {}, text: TEXT[e.tool_use_id] ?? '{"ok":true}' }))
  const call = (n: number, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `m${n}`, agentId: 'a7', ...args } as never)

  await $.agent.spawn({ prompt: 'Requirement: Levels.', description: 'levels', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(0, 'create_record', { objectApiName: 'Probe__c' })
  await call(1, 'set_fields', { values: { Name: 'x' } })
  await call(2, 'save')
  await call(21, 'api', { path: '/query' })
  await call(3, 'set_fields', { values: { Count__c: 1 } })
  await call(4, 'save')
  await call(5, 'assert_field', { field: 'Name', expected: 'x' })
  await call(6, 'map_feature', { flexiPages: ['Probe_Page'] })
  await call(7, 'click', { recordId: 'a00', lwcApiName: 'probePanel', name: 'Go' })
  await call(8, 'click', { recordId: 'a00', lwcApiName: 'probeChild', name: 'Deep' })
  await call(9, 'measure', { recordId: 'a00', lwcApiName: 'probeChild', frame: 'iframe', name: 'Inner' })

  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 40, columns: 80 } } as never)
  const tree = (await ui.drawn()) as Drawn
  // Page 2; the form 4 until a save saves (a blocked one keeps it open), an API read 2 inside it; the mapped parent 4, its child 6, an iframe in it 8.
  expect([/New Probe dialog/, /form \(Name\)/, /Read data from the API/, /form \(Count\)/, /Confirm Name/, /Map the page/, /Click "Go"/, /Click "Deep"/, /Measure "Inner"/].map(re => indent(tree, re)))
    .toEqual([2, 4, 2, 4, 2, 2, 4, 6, 8])
  await ui.unmount()
})

test('Clear drops the finished tests and keeps a running one', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `c${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (feature: string) => $.agent.spawn({ prompt: `Requirement: ${feature}`, description: feature, subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)

  await spawn('Finished one.')
  await $.turn.complete({ agentId: 'c1', answer: 'RESULT f: PASS', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await spawn('Still running.')
  // The running tester's finished scenario, opened by a press, stays open through Clear.
  const scenario = (n: number, args: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `k${n}`, agentId: 'c2', ...args } as never)
  await scenario(1, { plan: [{ title: 'Kept open', kind: 'positive', requirement: 'Still' }], start: 'Kept open' })
  await $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: 'k2', agentId: 'c2', name: 'Kept' } as never)
  await scenario(3, { end: 'Kept open', result: 'PASS' })

  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Finished one/ }))?.text).toBe('Finished one.')
  await ui.press({ key: 'open:c2|Still|Kept open' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Click "Kept"/ }))?.text).toBe('✓ Click "Kept"')
  await ui.press({ key: 'clear' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^Finished one/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Still running/ }))?.text).toBe('Still running.')
  expect((await ui.find({ type: 'Text', text: /Click "Kept"/ }))?.text).toBe('✓ Click "Kept"')
  expect(await ui.find({ type: 'Text', text: /Clear/ })).toBeUndefined()
  await ui.unmount()
})

test('a scenario that starts inside a form opened before it starts at the top, and nests from there', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a8' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => ({ result: {}, text: e.tool_use_id === 'k2' ? '{"outcome":"blocked"}' : '{"ok":true}' }))
  const call = (n: number, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `k${n}`, agentId: 'a8', ...args } as never)

  await $.agent.spawn({ prompt: 'Requirement: Inside.', description: 'inside', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(0, 'create_record', { objectApiName: 'Probe__c' })
  await call(1, 'scenario', { plan: [{ title: 'Blank Tags blocked', kind: 'negative' }, { title: 'Edit to -1 blocked', kind: 'negative' }], start: 'Blank Tags blocked' })
  await call(2, 'save')
  await call(3, 'api', { path: '/query' })
  await call(4, 'scenario', { end: 'Blank Tags blocked', result: 'PASS', start: 'Edit to -1 blocked' })
  await call(5, 'cancel')
  await call(6, 'edit_record', { recordId: 'a00' })
  await call(7, 'set_fields', { values: { Count__c: -1 } })

  let ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:a8||Blank Tags blocked' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  const tree = (await ui.drawn()) as Drawn
  // Steps sit at 4 inside a scenario: the first one's form steps and its API read share it; in the second, Cancel leaves the
  // form it began in and the Edit dialog's fields nest under their opener.
  expect([/^. Save$/, /Read data/, /^. Cancel$/, /Edit dialog/, /form \(Count\)/].map(re => indent(tree, re))).toEqual([4, 4, 4, 4, 6])
  await ui.unmount()
})

test('the run view: elapsed time and ended count, a bar per scenario, Current Action with the persona, route or explore with times, what the page showed', async ($, on) => {
  const start = Date.UTC(2026, 9, 22, 4, 14, 0)
  const clock = mock.clock(on, { now: start })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'r1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  const TEXT: Record<string, string> = {
    p3: '{"toasts":[{"type":"success","title":"Order Product updated"}]}',
    p4: '{"errors":[],"dropped":0}',
  }
  on('tool.call', async (_, e) => {
    if (e.tool_use_id === 'p2') await clock.advance(400)
    if (e.tool_use_id === 'p6') await held
    return { result: {}, text: TEXT[e.tool_use_id] ?? '{"ok":true}' }
  })
  const call = (n: number, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `p${n}`, agentId: 'r1', ...args } as never)

  await $.agent.spawn({ prompt: 'Requirement: Quantity changes with the + button.', description: 'qty', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(0, 'login_as', { user: 'sales-rep' })
  await call(1, 'scenario', { plan: [{ title: 'Discount copied', kind: 'positive' }, { title: '+ three times saves 4', kind: 'positive' }, { title: '− at 1 stays 1', kind: 'negative' }], start: 'Discount copied' })
  await call(9, 'scenario', { end: 'Discount copied', result: 'FAIL', reason: 'hidden', start: '+ three times saves 4' })
  await call(5, 'run_route', { steps: [{ tool: 'sf_open_record', args: { recordId: 'a00' } }] })
  await call(2, 'click', { name: '+' })
  await call(3, 'toasts')
  await call(4, 'page_errors')
  await clock.advance(41_000)
  const pressing = call(6, 'click', { name: 'Next' })
  await clock.advance(0)

  // A tall pane, so the running scenario's window holds all five steps.
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^● RUNNING/ }))?.text).toBe('● RUNNING  41s')
  expect((await ui.find({ type: 'Text', text: /of 3/ }))?.text).toBe('0 of 3 passed · 1 FAIL')
  // One cell per run scenario, each state its own shape: a cross failed, an arrow running, hollow pending.
  expect((await ui.find({ type: 'Text', text: /^✗+▷+▱+$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Current Action/ }))?.text).toBe('Current Action - + three times saves 4 · as sales-rep')
  expect((await ui.find({ type: 'Text', text: /^sales-rep/ }))?.text).toBe('sales-rep  ')
  expect((await ui.find({ type: 'Text', text: / route/ }))?.text).toBe(' route')
  expect((await ui.find({ type: 'Text', text: / explore 0\.4s/ }))?.text).toBe(' explore 0.4s')
  expect((await ui.find({ type: 'Text', text: /SEEN ON THE PAGE/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Order Product updated/ }))?.text).toBe('toast  "Order Product updated"')
  expect((await ui.find({ type: 'Text', text: /on the page/ }))?.text).toBe('errors 0 on the page')
  await ui.unmount()
  release()
  await pressing
})

test('a tester continued after its answer runs again: its next sf-tester call draws it running, timed from the resume', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 6, 0, 0) })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'g4' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: Resume.', description: 'resume', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.turn.complete({ agentId: 'g4', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'r9', reason: 'answer' } as never)
  // Twenty minutes for the answer, then the continued tester starts its scenario.
  await clock.advance(20 * 60_000)
  // A plain Read is not an sf-tester call: the tester stays done.
  await $.tool.call({ tool: 'Read', tool_use_id: 'r00', agentId: 'g4', file_path: '/x' } as never)
  const still = await $.ui.mount(PANE)
  // Waiting for an answer is not done: the header counts it apart.
  expect((await still.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 0 · Done 0 (0 PASS, 0 FAIL) · 1 waiting')
  await still.unmount()
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'r1', agentId: 'g4', plan: [{ title: 'It resumes', kind: 'positive' }], start: 'It resumes' } as never)
  await clock.advance(5_000)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^● RUNNING/ }))?.text).toBe('● RUNNING  5s')
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'r2', agentId: 'g4', end: 'It resumes', result: 'PASS' } as never)
  await $.turn.complete({ agentId: 'g4', answer: 'All checked.', durationMs: 1, isAborted: false, turnId: 'r8', reason: 'answer' } as never)
  const done = await $.ui.mount(PANE)
  expect((await done.find({ type: 'Text', text: /^PASS ·/ }))?.text).toBe('PASS · 1 of 1 scenarios passed')
  await done.unmount()
})

test('persona: a scenario keeps its planned persona, Current Action shows who is logged in, and sf_start ends a Login As', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 7, 0, 0) })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'pe' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  let release2 = () => {}
  const held2 = new Promise<void>(r => { release2 = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'pe9') await held; if (e.tool_use_id === 'pe8') await held2; return { result: {}, text: '{"ok":true}' } })
  const call = (n: number, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `pe${n}`, agentId: 'pe', ...args } as never)
  await $.agent.spawn({ prompt: 'Requirement: Personas.', description: 'p', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, 'scenario', { plan: [{ title: 'As admin', kind: 'positive', persona: 'admin' }, { title: 'As whoever', kind: 'positive' }] })
  await call(2, 'login_as', { user: 'sales-rep' })
  await call(3, 'scenario', { start: 'As admin' })
  const pressing = call(9, 'click', { name: 'Go' })
  await clock.advance(0) // the call is held open: let its step land first
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  // Planned as admin, so its row says admin; the tester is logged in as sales-rep, so Current Action says so.
  expect((await ui.find({ type: 'Text', text: /^admin/ }))?.text).toBe('admin  ')
  expect((await ui.find({ type: 'Text', text: /^Current Action/ }))?.text).toBe('Current Action - As admin · as sales-rep')
  await ui.unmount()
  release()
  await pressing
  await call(4, 'scenario', { end: 'As admin', result: 'PASS' })
  // Back to the alias owner: the next scenario, planned with no persona, takes none.
  await call(5, 'start', { org: 'x', session: 'new' })
  await call(6, 'scenario', { start: 'As whoever' })
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect(await ui.find({ type: 'Text', text: /^sales-rep/ })).toBeUndefined()
  await ui.unmount()
  // A scenario planned as admin starts after sf_start, before any Login As: Current Action names no one, not the plan's persona.
  await call(7, 'scenario', { end: 'As whoever', result: 'PASS', plan: [{ title: 'Planned admin', kind: 'positive', persona: 'admin' }], start: 'Planned admin' })
  const again = call(8, 'click', { name: 'Go' })
  await clock.advance(0)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Current Action/ }))?.text).toBe('Current Action - Planned admin')
  await ui.unmount()
  release2()
  await again
})

test('a toast raised again by a new save is listed again; one repeated for the same action is not', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'to' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => ({ result: {}, text: e.tool.endsWith('_toasts') || e.tool.endsWith('_wait') ? '{"toasts":[{"title":"Saved"}]}' : e.tool.endsWith('_save') ? '{"outcome":"saved","toasts":[{"title":"Created"}]}' : '{"ok":true}' }))
  const call = (n: number, tool: string) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `to${n}`, agentId: 'to' } as never)
  const saved = async () => { const ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never); const n = texts((await ui.drawn()) as Drawn, s => s.includes('Saved')); const created = await ui.find({ type: 'Text', text: /Created/ }); await ui.unmount(); return [n, !!created] }
  await $.agent.spawn({ prompt: 'Requirement: Toasts.', description: 't', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, 'save')
  await call(2, 'toasts')
  await call(3, 'wait') // repeats the same save's toast
  await call(4, 'save')
  await call(5, 'toasts') // the second save's own toast
  // Two windows, two Saved; a save's own result carries its toast too.
  expect(await saved()).toEqual([2, true])

  await call(6, 'press') // Enter saves again: a new window
  await call(7, 'toasts')
  await $.tool.call({ tool: 'mcp__sf-tester__sf_run_route', tool_use_id: 'to8', agentId: 'to', steps: [{ tool: 'sf_click', args: { name: 'Save' } }] } as never)
  await call(9, 'toasts')
  // Four windows by now; the pane keeps the last three toasts, all of them Saved.
  expect((await saved())[0]).toBe(3)
})

test('a continued tester that answers with no sf-tester call is timed from that turn, not the first', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 9, 0, 0) })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'nc' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: Quiet.', description: 'p', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.turn.complete({ agentId: 'nc', answer: 'BLOCKED: which users?', durationMs: 1, isAborted: false, turnId: 'nc1', reason: 'answer' } as never)
  // Continued, it reads a file and answers: no sf-tester call, so no resume reset ran.
  await $.tool.call({ tool: 'Read', tool_use_id: 'nc2', agentId: 'nc', file_path: '/x' } as never)
  await clock.advance(60 * 60_000) // an hour waiting for the answer
  await $.turn.complete({ agentId: 'nc', answer: 'Read the diff; nothing to run.', durationMs: 90_000, isAborted: false, turnId: 'nc3', reason: 'answer' } as never)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^DONE ·/ }))).toBeDefined()
  // Timed from this turn's own start: the hour waiting is left out.
  expect((await ui.find({ type: 'Text', text: /· 1m 30s · $/ }))).toBeDefined()
  // Answered, its old question goes with the wait.
  expect(await ui.find({ type: 'Text', text: /^Question: / })).toBeUndefined()
  await ui.unmount()
})

test('at the cap of 300 only the oldest finished test leaves: every running tester stays', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `cap${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'c', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await spawn('Requirement: The oldest run, still going.')
  await spawn('Requirement: An old finished run.')
  await $.turn.complete({ agentId: 'cap2', answer: 'RESULT o: PASS', durationMs: 1, isAborted: false, turnId: 'c3', reason: 'answer' } as never)
  for (let i = 0; i < 299; i++) await spawn(`Requirement: Run ${i}.`)
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^The oldest run, still going\.$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Run 298\.$/ }))).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^An old finished run\.$/ })).toBeUndefined()
  await ui.unmount()
})
test('a click that failed before arming opens no toast window', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'fx' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => e.tool_use_id === 'fx2' ? { isError: true, result: {}, text: '{"code":"NOT_FOUND"}' } : ({ result: {}, text: '{"toasts":[{"title":"Saved"}]}' }))
  await $.agent.spawn({ prompt: 'Requirement: Failed click.', description: 'f', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_toasts', tool_use_id: 'fx1', agentId: 'fx' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: 'fx2', agentId: 'fx', name: 'Nope' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_toasts', tool_use_id: 'fx3', agentId: 'fx' } as never)
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never)
  const tree = (await ui.drawn()) as Drawn
  expect(texts(tree, s => s.includes('Saved'))).toBe(1)
  await ui.unmount()
})

test('a Login As step inside a route sets the Current Action persona', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 10, 0, 0) })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'rl' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'rl2') await held; return { result: {}, text: '{"ok":true}' } })
  await $.agent.spawn({ prompt: 'Requirement: Routed login.', description: 'r', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_run_route', tool_use_id: 'rl1', agentId: 'rl', steps: [{ tool: 'sf_login_as', args: { user: 'sales-rep' } }, { tool: 'sf_open_record', args: {} }] } as never)
  const going = $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: 'rl2', agentId: 'rl', name: 'Go' } as never)
  await clock.advance(0)
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Current Action/ }))?.text).toBe('Current Action - Routed login. · as sales-rep')
  await ui.unmount()
  release()
  await going
})

test('a status the pane no longer lists, as OBSERVED from an older tester, draws as itself instead of breaking the pane', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ob' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const call = (n: number, args: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `ob${n}`, agentId: 'ob', ...args } as never)
  await $.agent.spawn({ prompt: 'Requirement: Old run.', description: 'old', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, { plan: [{ title: 'Seen only', kind: 'negative' }, { title: 'Still to run', kind: 'positive' }], start: 'Seen only' })
  await call(2, { end: 'Seen only', result: 'OBSERVED' })
  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^OBSERVED$/ }))?.text).toBe('OBSERVED')
  // An unnumbered Requirement line names the feature too.
  expect((await ui.find({ type: 'Text', text: /^Old run\.$/ }))?.text).toBe('Old run.')
  await ui.unmount()
  await $.turn.complete({ agentId: 'ob', answer: 'done', durationMs: 1, isAborted: false, turnId: 'ob9', reason: 'answer' } as never)
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^OBSERVED$/ }))?.text).toBe('OBSERVED')
  await ui.unmount()
})

test('the header is the first line that starts with Requirement, however it is numbered, never a mention mid-line', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `hd${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const headers = [
    ['Check the NonFunctionalRequirement: speed first.\nRequirement 1: First thing.\nRequirement 2: Second thing.', 'First thing.'],
    ['Each Requirement: line below is word for word.\nRequirement #2: Hash numbered.', 'Hash numbered.'],
    ['requirement 3 (admin): Lower case.', 'Lower case.'],
  ]
  for (const [prompt] of headers) await $.agent.spawn({ prompt, description: 'fallback', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never)
  for (const [, header] of headers) expect((await ui.find({ type: 'Text', text: new RegExp(`^${header!.replace('.', '\\.')}$`) }))?.text).toBe(header)
  expect(await ui.find({ type: 'Text', text: /^fallback$/ })).toBeUndefined()
  await ui.unmount()
})

test('a BLOCKED tester waits for you with its question and a Dismiss, stays through the cap, and draws its continued run', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `bk${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'b', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await spawn('Requirement: Needs an app.')
  await $.turn.complete({ agentId: 'bk1', answer: 'No app named.\n\n**BLOCKED:** which app? Sales or Service', durationMs: 1, isAborted: false, turnId: 'b1', reason: 'answer' } as never)
  await spawn('Requirement: A finished run.')
  await $.turn.complete({ agentId: 'bk2', answer: 'RESULT f: PASS', durationMs: 1, isAborted: false, turnId: 'b2', reason: 'answer' } as never)
  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^BLOCKED ·/ }))?.text).toBe('BLOCKED · waiting for you')
  expect((await ui.find({ type: 'Text', text: /^Question: / }))?.text).toBe('Question: which app? Sales or Service')
  // Every finished row can be hidden alone: the waiting one by Dismiss, the other by its own Clear.
  expect([!!(await ui.find({ key: 'hide:bk1' })), !!(await ui.find({ key: 'hide:bk2' }))]).toEqual([true, true])
  expect(texts((await ui.drawn()) as Drawn, s => s === 'Dismiss')).toBe(1)
  await ui.unmount()
  // At the cap of 300 a finished run leaves first; the waiting one stays.
  for (let i = 0; i < 299; i++) await spawn(`Requirement: Run ${i}.`)
  await $.turn.complete({ agentId: 'bk3', answer: 'RESULT r: PASS', durationMs: 1, isAborted: false, turnId: 'b3', reason: 'answer' } as never)
  await spawn('Requirement: One more.')
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^BLOCKED ·/ }))?.text).toBe('BLOCKED · waiting for you')
  expect(await ui.find({ type: 'Text', text: /^Run 0\.$/ })).toBeUndefined()
  await ui.unmount()
  // Answered and continued, it runs again and ends on its own verdict.
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'b4', agentId: 'bk1', plan: [{ title: 'Opens in Sales', kind: 'positive' }], start: 'Opens in Sales' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'b5', agentId: 'bk1', end: 'Opens in Sales', result: 'PASS' } as never)
  await $.turn.complete({ agentId: 'bk1', answer: 'Checked in Sales.', durationMs: 1, isAborted: false, turnId: 'b6', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect(await ui.find({ type: 'Text', text: /^BLOCKED ·/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Question: / })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^PASS · 1 of 1/ }))?.text).toBe('PASS · 1 of 1 scenarios passed')
  await ui.unmount()
})

test('only a BLOCKED line of its own waits: one in a table cell or a list item does not, and an aborted turn never does', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `bl${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  const run = async (answer: string, isAborted = false) => {
    await $.agent.spawn({ prompt: `Requirement: Run ${n + 1}.`, description: 'b', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    await $.turn.complete({ agentId: `bl${n}`, answer, durationMs: 1, isAborted, turnId: `bl${n}`, reason: 'answer' } as never)
  }
  // The waiting one first: three finished runs after it would push it out of the last three.
  await run('Stopped.\n`BLOCKED` which users?')
  await run('| State | BLOCKED |\n- BLOCKED earlier, then went on')
  await run('BLOCKED: no app', true)
  // A RESULT line last gives the verdict, with a BLOCKED line before it.
  await run('BLOCKED: one persona\nRESULT u: FAIL')
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  const tree = (await ui.drawn()) as Drawn
  expect([texts(tree, s => s.startsWith('BLOCKED ·')), texts(tree, s => s.startsWith('STOPPED ·')), texts(tree, s => s.startsWith('DONE ·')), texts(tree, s => s.startsWith('FAIL ·')), texts(tree, s => s.startsWith('Question: '))]).toEqual([1, 1, 1, 1, 1])
  expect((await ui.find({ type: 'Text', text: /^Question: / }))?.text).toBe('Question: which users?')
  await ui.unmount()
})

test('BLOCKED waits only on the last line: one earlier in a report that failed a scenario leaves it FAIL, and punctuation before the question goes', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `bz${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: Mid report.', description: 'b', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'bz0', agentId: 'bz1', plan: [{ title: 'Saves', kind: 'positive' }], start: 'Saves' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'bz1', agentId: 'bz1', end: 'Saves', result: 'FAIL', reason: 'no save' } as never)
  await $.turn.complete({ agentId: 'bz1', answer: 'Could not test:\n* BLOCKED: as qa-user, TOO_MANY_SESSIONS\nBLOCKED: qa-user could not log in\nThat is all.', durationMs: 1, isAborted: false, turnId: 'bz2', reason: 'answer' } as never)
  await $.agent.spawn({ prompt: 'Requirement: Dotted.', description: 'b', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.turn.complete({ agentId: 'bz2', answer: 'No users named.\n\n**BLOCKED** \u2014 Which users?', durationMs: 1, isAborted: false, turnId: 'bz3', reason: 'answer' } as never)
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  const tree = (await ui.drawn()) as Drawn
  expect([texts(tree, s => s.startsWith('FAIL ·')), texts(tree, s => s.startsWith('BLOCKED ·')), texts(tree, s => s.startsWith('Question: '))]).toEqual([1, 1, 1])
  expect((await ui.find({ type: 'Text', text: /^Question: / }))?.text).toBe('Question: Which users?')
  await ui.unmount()
})

test('Dismiss drops one waiting row, a row Clear one finished test, and Clear the finished tests but no waiting one', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `w${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'w', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  const end = (agentId: string, answer: string) => $.turn.complete({ agentId, answer, durationMs: 1, isAborted: false, turnId: agentId, reason: 'answer' } as never)
  await spawn('Requirement: Wait one.')
  await end('w1', 'BLOCKED: which app?')
  await spawn('Requirement: Wait two.')
  await end('w2', 'BLOCKED: which users?')
  await spawn('Requirement: Done one.')
  await end('w3', 'RESULT d: PASS')
  await spawn('Requirement: Done two.')
  await end('w4', 'RESULT d: FAIL')
  await spawn('Requirement: Still running.')
  const shows = async (ui: { find: (q: object) => Promise<unknown> }) => Promise.all(['Wait one.', 'Wait two.', 'Done one.', 'Done two.', 'Still running.'].map(async f => !!(await ui.find({ type: 'Text', text: new RegExp(`^${f.replace('.', '\\.')}$`) }))))
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never)
  await ui.press({ key: 'hide:w1' })
  await ui.press({ key: 'hide:w3' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never)
  expect(await shows(ui)).toEqual([false, true, false, true, true])
  await ui.press({ key: 'clear' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never)
  expect(await shows(ui)).toEqual([false, true, false, false, true])
  // Only a waiting row is left finished, so there is nothing for Clear to hide.
  expect(await ui.find({ key: 'clear' })).toBeUndefined()
  await ui.unmount()
})

// Spawns one tester per answer and returns the pane's drawn texts that start with a prefix.
const lastLines = async ($: any, on: any, tag: string, answers: string[]) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `${tag}${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  for (const [i, answer] of answers.entries()) {
    await $.agent.spawn({ prompt: `Requirement: ${tag} ${i}.`, description: tag, subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    await $.turn.complete({ agentId: `${tag}${i + 1}`, answer, durationMs: 1, isAborted: false, turnId: `${tag}${i}`, reason: 'answer' } as never)
  }
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  const tree = (await ui.drawn()) as Drawn
  const got = (prefix: string) => { const out: string[] = []; const walk = (d: Drawn) => { if (d.type === 'Text') { const t = (d.children ?? []).filter(k => typeof k === 'string').join(''); if (t.startsWith(prefix)) out.push(t) } (d.children ?? []).forEach(k => k && typeof k === 'object' && walk(k as Drawn)) }; walk(tree); return out.sort() }
  await ui.unmount()
  return got
}

test('the question drops markup that closes the BLOCKED line, and keeps markup of its own', async ($, on) => {
  const got = await lastLines($, on, 'mk', ['`BLOCKED: which app?`', '**BLOCKED: which users?**', 'BLOCKED: test in `Sales` or `Service`',
    'BLOCKED: **which org?**', '**BLOCKED:** which is **required**', '`BLOCKED`: test in `Sales`'])
  expect(got('Question: ')).toEqual(['Question: test in `Sales`', 'Question: test in `Sales` or `Service`', 'Question: which app?', 'Question: which is **required**', 'Question: which org?', 'Question: which users?'])
})

test('a * bullet on the last line is a list item, not a wait', async ($, on) => {
  const got = await lastLines($, on, 'bu', ['Could not test:\n* BLOCKED: as qa-user, TOO_MANY_SESSIONS'])
  expect([got('BLOCKED ·').length, got('DONE ·').length]).toEqual([0, 1])
})

test('a code fence or Windows line ends around the BLOCKED line still wait', async ($, on) => {
  const got = await lastLines($, on, 'fe', ['No org named.\n```\nBLOCKED: which org?\n```\n', 'No app.\n~~~text\nBLOCKED: which app?\n\n~~~', 'No users.\r\nBLOCKED: which users?\r\n',
    'No env.\nBLOCKED: which env?\n```c++', 'No box.\n```BLOCKED:which-box'])
  expect(got('Question: ')).toEqual(['Question: which app?', 'Question: which env?', 'Question: which org?', 'Question: which users?', 'Question: which-box'])
})

test('a tester Clear or Dismiss removed comes back running, with its header, at its next sf-tester call', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 23, 9, 0, 0) })
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `ra${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'r', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await spawn('Requirement: Cleared then answered.')
  await $.turn.complete({ agentId: 'ra1', answer: 'RESULT r: PASS', durationMs: 1, isAborted: false, turnId: 'ra1', reason: 'answer' } as never)
  await spawn('Requirement: Dismissed then answered.')
  await $.turn.complete({ agentId: 'ra2', answer: 'BLOCKED: which users?', durationMs: 1, isAborted: false, turnId: 'ra2', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  await ui.press({ key: 'hide:ra2' })
  await ui.press({ key: 'clear' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^No sf-tester/ }))).toBeDefined()
  await ui.unmount()
  await clock.advance(10 * 60_000)
  for (const id of ['ra1', 'ra2']) await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `${id}s`, agentId: id, plan: [{ title: `${id} goes on`, kind: 'positive' }], start: `${id} goes on` } as never)
  await clock.advance(3_000)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 2 · Done 0 (0 PASS, 0 FAIL)')
  expect([!!(await ui.find({ type: 'Text', text: /^Cleared then answered\.$/ })), !!(await ui.find({ type: 'Text', text: /^Dismissed then answered\.$/ }))]).toEqual([true, true])
  // Timed from its return, not from its first start.
  expect((await ui.find({ type: 'Text', text: /^● RUNNING/ }))?.text).toBe('● RUNNING  3s')
  await ui.unmount()
  // Another subagent's sf-tester call, never a tester here, adds nothing.
  await $.tool.call({ tool: 'mcp__sf-tester__sf_whoami', tool_use_id: 'x1', agentId: 'stranger' } as never)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 2 · Done 0 (0 PASS, 0 FAIL)')
  await ui.unmount()
})

test('a hidden tester comes back with its history, also when it answers again without an sf-tester call', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'hb' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: Kept history.', description: 'h', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'hb1', agentId: 'hb', plan: [{ title: 'Ran before', kind: 'negative' }], start: 'Ran before' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: 'hb2', agentId: 'hb', end: 'Ran before', result: 'PASS' } as never)
  await $.turn.complete({ agentId: 'hb', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'hb3', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  await ui.press({ key: 'hide:hb' })
  await ui.unmount()
  // Answered, it asks again with no sf-tester call: it is waiting again, with the new question.
  await $.turn.complete({ agentId: 'hb', answer: 'BLOCKED: which users?', durationMs: 1, isAborted: false, turnId: 'hb4', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Question: / }))?.text).toBe('Question: which users?')
  // Its scenarios from before the Dismiss are still there.
  expect((await ui.find({ type: 'Text', text: /Ran before/ }))?.text).toBe('− Ran before')
  await ui.unmount()
})

test('two sf-tester calls of a hidden tester bring back one row', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'pc' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: One row.', description: 'p', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.turn.complete({ agentId: 'pc', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'pc1', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  await ui.press({ key: 'hide:pc' })
  await ui.unmount()
  await Promise.all(['pc2', 'pc3'].map(id => $.tool.call({ tool: 'mcp__sf-tester__sf_whoami', tool_use_id: id, agentId: 'pc' } as never)))
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
  await ui.unmount()
})

test('at the cap a hidden waiting tester leaves first, so it no longer comes back', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `hc${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'c', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await spawn('Requirement: Hidden wait.')
  await $.turn.complete({ agentId: 'hc1', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'hc1', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  await ui.press({ key: 'hide:hc1' })
  await ui.unmount()
  for (let i = 0; i < 300; i++) await spawn(`Requirement: Run ${i}.`)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_whoami', tool_use_id: 'hc0', agentId: 'hc1' } as never)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 300 · Done 0 (0 PASS, 0 FAIL)')
  await ui.unmount()
})

test('at the cap a hidden tester leaves before an older finished one that still shows', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `ho${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'c', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await spawn('Requirement: Older visible pass.')
  await $.turn.complete({ agentId: 'ho1', answer: 'RESULT v: PASS', durationMs: 1, isAborted: false, turnId: 'ho1', reason: 'answer' } as never)
  await spawn('Requirement: Newer hidden wait.')
  await $.turn.complete({ agentId: 'ho2', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'ho2', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  await ui.press({ key: 'hide:ho2' })
  await ui.unmount()
  for (let i = 0; i < 299; i++) await spawn(`Requirement: Run ${i}.`)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_whoami', tool_use_id: 'ho0', agentId: 'ho2' } as never)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 299 · Done 1 (1 PASS, 0 FAIL)')
  await ui.unmount()
})

test('a tester continued with SendMessage keeps its one row and its feature, timed from the answer', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 24, 12, 0, 0) })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'sm' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: One row.', description: 'p', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.turn.complete({ agentId: 'sm', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'sm1', reason: 'answer' } as never)
  await clock.advance(20 * 60_000)
  await $.agent.spawn({ prompt: 'Test in SF UI App.', description: 'p', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  // Running from the answer itself, before any sf-tester call, and timed from it, not from the first run.
  let ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
  expect((await ui.find({ type: 'Text', text: /^● RUNNING/ }))?.text).toBe('● RUNNING  0s')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__sf-tester__sf_whoami', tool_use_id: 'sm2', agentId: 'sm' } as never)
  ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
  expect(await ui.find({ type: 'Text', text: 'p' })).toBeUndefined()
  await ui.unmount()
})

for (const scenario of [false, true]) {
  test(`the running step shows once, in Current Action, ${scenario ? 'in a scenario' : 'outside a scenario'}`, async ($, on) => {
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'd1' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    let release = () => {}
    const held = new Promise<void>(r => { release = r })
    on('tool.call', async (_, e) => { if (e.tool_use_id === 'held') await held; return { result: {}, text: '{"ok":true}' } })
    const call = (id: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: id, agentId: 'd1', ...args } as never)
    await $.agent.spawn({ prompt: 'Requirement: Once.', description: 'd', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    if (scenario) await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive' }], start: 'One' })
    await call('a', 'click', { name: 'Done' })
    const pressing = call('held', 'click', { name: 'Now' })
    await new Promise(r => setTimeout(r, 0))
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
    const tree = (await ui.drawn()) as Drawn
    expect(['Now', 'Done'].map(name => texts(tree, s => s.endsWith(`Click "${name}"`)))).toEqual([1, 1])
    await ui.unmount()
    release()
    await pressing
  })
}

test('Current Action comes and goes below the steps: every line above it stays where it was', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 24, 9, 0, 0) })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'nb' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'held') await held; return { result: {}, text: '{"ok":true}' } })
  const call = (id: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: id, agentId: 'nb', ...args } as never)
  await $.agent.spawn({ prompt: 'Requirement: Still text.', description: 'nb', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive' }], start: 'One' })
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) await call(`c${i}`, 'click', { name: `Step ${i}` })
  // The drawn texts in order, from the top of the pane.
  const lines = async () => {
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 24, columns: 80 } } as never)
    const out: string[] = []
    const walk = (d: Drawn) => { if (d.type === 'Text') return void out.push(words(d)); (d.children ?? []).forEach(k => k && typeof k === 'object' && walk(k as Drawn)) }
    walk((await ui.drawn()) as Drawn)
    await ui.unmount()
    return out
  }
  const between = await lines()
  const pressing = call('held', 'click', { name: 'Now' })
  await new Promise(r => setTimeout(r, 0))
  const during = await lines()
  const now = during.findIndex(s => s.startsWith('Current Action'))
  expect(now).toBeGreaterThan(during.findIndex(s => s.endsWith('Click "Step 8"')))
  expect(during.slice(0, now)).toEqual(between)
  release()
  await pressing
})

test('a requirement header reads the same while its first step runs and after it ends', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'rh' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'held') await held; return { result: {}, text: '{"ok":true}' } })
  const call = (id: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: id, agentId: 'rh', ...args } as never)
  await $.agent.spawn({ prompt: 'Requirement: Header.', description: 'rh', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive', requirement: 'R1' }], start: 'One' })
  const header = async () => {
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
    const pressable = !!(await ui.find({ key: 'open:rh|R1' }))
    await ui.unmount()
    return pressable
  }
  const pressing = call('held', 'click', { name: 'First' })
  await new Promise(r => setTimeout(r, 0))
  const during = await header()
  release()
  await pressing
  expect([during, await header()]).toEqual([true, true])
})

test('a continued tester that ends before its repeat spawn resolves keeps its new verdict', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 24, 11, 0, 0) })
  let spawns = 0
  on('agent.spawn', async () => {
    // The second spawn resolves only after the continued turn has already ended.
    if (++spawns === 2) {
      await clock.advance(2_000)
      await $.turn.complete({ agentId: 'lt', answer: 'BLOCKED: which org?', durationMs: 1_000, isAborted: false, turnId: 'lt2', reason: 'answer' } as never)
    }
    return { model: 'sonnet', agentId: 'lt' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (prompt: string) => $.agent.spawn({ prompt, description: 'lt', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await spawn('Requirement: Late spawn.')
  await $.turn.complete({ agentId: 'lt', answer: 'BLOCKED: which app?', durationMs: 1, isAborted: false, turnId: 'lt1', reason: 'answer' } as never)
  await clock.advance(60_000)
  await spawn('Sales.')
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toBe('Running 0 · Done 0 (0 PASS, 0 FAIL) · 1 waiting')
  expect((await ui.find({ type: 'Text', text: /^Question: / }))?.text).toBe('Question: which org?')
  await ui.unmount()
})

test('a failed step shows its error code once, whether or not its message already starts with it', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ec' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => e.tool_use_id === 'coded'
    ? { isError: true, result: {}, text: '{"code":"APP_UNAVAILABLE","message":"APP_UNAVAILABLE: SfUi_App is not a Lightning app this user can open"}' }
    : { isError: true, result: {}, text: '{"code":"LOCATOR_TIMEOUT","message":"page.goto: Timeout 30000ms exceeded."}' })
  await $.agent.spawn({ prompt: 'Requirement: Errors.', description: 'ec', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_login_as', tool_use_id: 'coded', agentId: 'ec', user: 'platform' } as never)
  await $.tool.call({ tool: 'mcp__sf-tester__sf_wait', tool_use_id: 'timeout', agentId: 'ec', text: 'Saved' } as never)
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^APP_UNAVAILABLE/ }))?.text).toBe('APP_UNAVAILABLE: SfUi_App is not a Lightning app this user can open')
  expect((await ui.find({ type: 'Text', text: /^LOCATOR_TIMEOUT/ }))?.text).toBe('LOCATOR_TIMEOUT: page.goto: Timeout 30000ms exceeded.')
  await ui.unmount()
})

test('Current Action names the requirement its running scenario serves', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ca' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'held') await held; return { result: {}, text: '{"ok":true}' } })
  const call = (id: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: id, agentId: 'ca', ...args } as never)
  await $.agent.spawn({ prompt: 'Requirement: The Bump action saves the Count entered in it.', description: 'ca', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call('s', 'scenario', { plan: [{ title: 'Count 42 saves', kind: 'positive', requirement: 'Bump saves Count' }], start: 'Count 42 saves' })
  const pressing = call('held', 'click', { name: 'Save' })
  await new Promise(r => setTimeout(r, 0))
  const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
  expect((await ui.find({ type: 'Text', text: /^Current Action/ }))?.text).toBe('Current Action - Bump saves Count')
  // The requirement stands out from the dimmed label around it.
  expect(((await ui.find({ type: 'Text', text: /^Bump saves Count$/ })) as { props?: { bold?: boolean } } | undefined)?.props?.bold).toBe(true)
  await ui.unmount()
  release()
  await pressing
})

test('a Current Action header that wraps takes its extra row from the step window, so the pane does not overflow', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `wr${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  // Visible steps for one running tester whose scenario serves the given requirement.
  const shown = async (id: string, requirement: string) => {
    await $.agent.spawn({ prompt: 'Requirement: Wrap.', description: 'w', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const call = (k: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `${id}${k}`, agentId: id, ...args } as never)
    await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive', requirement }], start: 'One' })
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) await call(`c${i}`, 'click', { name: `Step ${i}` })
    // A pane body 21 rows high, too short for all twelve steps.
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 21 } }, viewport: { rows: 24, columns: 80 } } as never)
    const count = texts((await ui.drawn()) as Drawn, s => /Click "Step \d+"$/.test(s))
    await ui.unmount()
    await $.turn.complete({ agentId: id, answer: 'RESULT w: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return count
  }
  await keysRow($)
  const short = await shown('wr2', 'Short')
  // 60 characters with its label: one row of the pane's 60 columns, two of the 56 inside the box's border and padding.
  const long = await shown('wr3', 'The header wraps only inside its own border')
  expect(long).toBe(short - 1)
  // Three 30-character words wrap to three rows by word, where a character count says two; the Requirement line
  // above the scenario is cut to one row, so only the header's two extra rows go.
  const words = await shown('wr4', `${'a'.repeat(30)} ${'b'.repeat(30)} ${'c'.repeat(30)}`)
  expect(words).toBe(short - 2)
})

test('Current Action names a scenario with no requirement, or an empty one, by its own title, not the brief\'s first line', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `ti${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  let held = Promise.resolve()
  on('tool.call', async (_, e) => { if (e.tool_use_id.endsWith('held')) await held; return { result: {}, text: '{"ok":true}' } })
  const header = async (id: string, plan: object) => {
    let release = () => {}
    held = new Promise<void>(r => { release = r })
    await $.agent.spawn({ prompt: 'Requirement 1: The first one.\nRequirement 2: The second one.', description: 't', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const call = (k: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `${id}${k}`, agentId: id, ...args } as never)
    await call('s', 'scenario', { plan: [plan], start: 'Second one saves' })
    const pressing = call('held', 'click', { name: 'Save' })
    await new Promise(r => setTimeout(r, 0))
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
    const text = (await ui.find({ type: 'Text', text: /^Current Action/ }))?.text
    await ui.unmount()
    release()
    await pressing
    await $.turn.complete({ agentId: id, answer: 'RESULT t: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return text
  }
  expect(await header('ti1', { title: 'Second one saves', kind: 'positive' })).toBe('Current Action - Second one saves')
  expect(await header('ti2', { title: 'Second one saves', kind: 'positive', requirement: '' })).toBe('Current Action - Second one saves')
})

test('a loose step names its tester by the header drawn above it, lane and all, and an empty Requirement line falls back to the task', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `lo${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  let held = Promise.resolve()
  on('tool.call', async (_, e) => { if (e.tool_use_id.endsWith('held')) await held; return { result: {}, text: '{"ok":true}' } })
  const box = async (id: string, prompt: string, description: string) => {
    let release = () => {}
    held = new Promise<void>(r => { release = r })
    await $.agent.spawn({ prompt, description, subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const pressing = $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: `${id}held`, agentId: id, name: 'Go' } as never)
    await new Promise(r => setTimeout(r, 0))
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 60, columns: 80 } } as never)
    const text = (await ui.find({ type: 'Text', text: /^Current Action/ }))?.text
    await ui.unmount()
    release()
    await pressing
    await $.turn.complete({ agentId: id, answer: 'RESULT x: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return text
  }
  expect(await box('lo1', 'Timed benchmark run entry/C1 of the sf-tester.', 'bench')).toBe('Current Action - C1: entry/C1')
  expect(await box('lo2', 'Check this.\nRequirement:   \nMore.', 'Empty requirement')).toBe('Current Action - Empty requirement')
})

// The kit paints nothing, so the fit is read as how many steps show: a step that wraps to three rows takes three.
test('the run view fits the pane by rows: a step that wraps or fails takes its rows, and the height is the body, not the screen', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `fit${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // A wait on a text starting with N fails with a Playwright-style message over four lines.
  on('tool.call', (_, e) => (e.tool === 'mcp__sf-tester__sf_wait'
    ? { isError: true, result: {}, text: JSON.stringify({ code: 'NOT_FOUND', message: String((e as { text?: string }).text).startsWith('N') ? 'a\nb\nc\nd' : '0 elements with text "Discard"' }) }
    : { result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  // Steps drawn for one running tester with 30 steps, in a pane bodyRows high on an 80-row screen.
  const shown = async (args: (i: number) => object, bodyRows = 30, tool = 'click', open = false) => {
    const id = `fit${n + 1}`
    await $.agent.spawn({ prompt: 'Requirement: Fit.', description: 'f', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const call = (k: string, name: string, a: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${name}`, tool_use_id: `${id}${k}`, agentId: id, ...a } as never)
    await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive' }], start: 'One' })
    for (let i = 1; i <= 30; i++) await call(`c${i}`, tool, args(i))
    const mount = () => $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } }, viewport: { rows: 80, columns: 80 } } as never)
    // A press on the scenario opens its rows in full.
    if (open) { const first = await mount(); await first.press({ key: `open:${id}||One` }); await first.unmount() }
    const ui = await mount()
    const count = texts((await ui.drawn()) as Drawn, s => /^[✓✗] /.test(s))
    // Folded again, so the finished block does not draw its steps beside the next run.
    if (open) await ui.press({ key: `open:${id}||One` })
    await ui.unmount()
    await $.turn.complete({ agentId: id, answer: 'RESULT f: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return count
  }
  await keysRow($)
  const short = await shown(i => ({ name: `S${i}` }))
  // About 110 characters: cut to one row, and once the scenario is pressed open three rows of the 40-odd columns a
  // step's text has beside its "explore" label.
  const long = await shown(i => ({ name: `${'word '.repeat(20)}${i}` }))
  const opened = await shown(i => ({ name: `${'word '.repeat(20)}${i}` }), 30, 'click', true)
  // Each failed step draws its error on a row of its own.
  const failed = await shown(i => ({ text: `F${i}` }), 30, 'wait')
  // Each line of an error is a row of its own: a step and a four-line error take five.
  const multiline = await shown(i => ({ text: `N${i}` }), 30, 'wait')
  // A word wider than the row fills the row it starts on before it breaks, as the terminal's hard wrap does.
  const unbroken = await shown(i => ({ name: `${'x'.repeat(30)}${'y'.repeat(42)}${i}` }), 30, 'click', true)
  const tall = await shown(i => ({ name: `S${i}` }), 60)
  expect(short).toBeGreaterThan(3)
  expect(short).toBeLessThan(30)
  expect(long).toBe(short)
  expect(opened).toBeGreaterThan(0)
  expect(opened).toBeLessThanOrEqual(Math.ceil(short / 3))
  expect(failed).toBeGreaterThan(0)
  expect(failed).toBeLessThanOrEqual(Math.ceil(short / 2))
  expect(multiline).toBeGreaterThan(0)
  expect(multiline).toBeLessThanOrEqual(Math.ceil(short / 5))
  // "✓ Click" then a 75-character word at 43 columns: two rows, not the three a fresh row for the word would count.
  expect(unbroken).toBeGreaterThan(Math.ceil(short / 3))
  expect(tall).toBeGreaterThan(short)
})

test('scenarios that show their steps share one row budget, the running one served first', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `sh${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  // A screen about the pane's height, so the old per-scenario window is as tight as the body's.
  const count = async (id: string) => {
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 33, columns: 80 } } as never)
    const drawn = (await ui.drawn()) as Drawn
    await ui.unmount()
    await $.turn.complete({ agentId: id, answer: 'RESULT s: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return [texts(drawn, s => /^✓ /.test(s)), texts(drawn, s => s === '✓ Click "R12"')]
  }
  const run = async (titles: string[]) => {
    const id = `sh${n + 1}`
    await $.agent.spawn({ prompt: 'Requirement: Share.', description: 's', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const call = (k: string, name: string, a: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${name}`, tool_use_id: `${id}${k}`, agentId: id, ...a } as never)
    // Planned in reverse, so the scenario that runs last draws first and only its priority can serve it first.
    await call('p', 'scenario', { plan: [...titles].reverse().map(title => ({ title, kind: 'negative' })) })
    for (const [j, title] of titles.entries()) {
      await call(`s${j}`, 'scenario', { start: title })
      for (let i = 1; i <= 36 / titles.length; i++) await call(`c${j}-${i}`, 'click', { name: `${j === titles.length - 1 ? 'R' : title}${i}` })
      // Every scenario but the last fails, so it keeps its steps open beside the running one.
      if (j < titles.length - 1) await call(`e${j}`, 'scenario', { end: title, result: 'FAIL', reason: 'r' })
    }
    return count(id)
  }
  const [single] = await run(['Only'])
  const [total, newest] = await run(['A', 'B', 'Last'])
  expect(total).toBeLessThanOrEqual(single!)
  expect(newest).toBe(1)
})

test('a step aimed by exact text or at an unnamed element names what it aimed at, never ""', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'aim' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  const call = (k: string, tool: string, args: object) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: k, agentId: 'aim', ...args } as never)
  await $.agent.spawn({ prompt: 'Requirement: Aim.', description: 'a', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call('1', 'hover', { text: 'Discard' })
  await call('2', 'hover', { role: 'img', name: '', nth: 3 })
  await call('3', 'click', { text: 'Add New Document' })
  await call('4', 'on_top', { text: 'Issue Date' })
  await call('5', 'measure', { selector: '.td-col-left' })
  // The server's own defaults: an unnamed aim is a button, and on_top or measure with no name is the scope itself.
  await call('6', 'hover', { name: '' })
  await call('7', 'click', { role: 'button', name: '' })
  await call('8', 'click', { role: 'link', name: 'Edit', nth: 2 })
  await call('9', 'hover', { name: 'Edit', row: 'Acme' })
  await call('10', 'on_top', { lwcApiName: 'c-x', role: 'img' })
  await call('11', 'measure', { inModal: true })
  await call('12', 'click', { role: 'checkbox', row: 'Order one' })
  // The server's scope order (frame, dialog, component), and text before name when both are given.
  await call('13', 'on_top', { inModal: true, lwcApiName: 'c-x' })
  await call('14', 'measure', { lwcApiName: 'c-y', row: 'Acme', nth: 2 })
  await call('15', 'measure', { frame: 'iframe[name^=vfFrameId]' })
  await call('16', 'click', { role: 'link', name: 'Edit', text: 'Edit record' })
  await call('17', 'click', { role: 'checkbox', row: 'Acme', column: 'Active' })
  await call('18', 'measure', { name: '', selector: '.x' })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 60 } }, viewport: { rows: 60, columns: 80 } } as never)
  const drawn = (await ui.drawn()) as Drawn
  await ui.unmount()
  for (const line of ['✓ Hover over "Discard"', '✓ Hover over the unnamed img no. 3', '✓ Click "Add New Document"', '✓ Check what is on top of "Issue Date"', '✓ Measure ".td-col-left"',
    '✓ Hover over the unnamed button', '✓ Click the unnamed button', '✓ Click the "Edit" link no. 2', '✓ Hover over "Edit" on row Acme', '✓ Check what is on top of "c-x"', '✓ Measure the dialog', '✓ Click the checkbox on row Order one',
    '✓ Check what is on top of the dialog', '✓ Measure "c-y"', '✓ Measure the frame', '✓ Click "Edit record"', '✓ Click the checkbox on row Acme under "Active"', '✓ Measure the unnamed button']) {
    expect([line, texts(drawn, s => s === line)]).toEqual([line, 1])
  }
})

test('a toast is one row until pressed open, then its wrapped rows come from the step window', async ($, on) => {
  let n = 0
  let title = ''
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `tw${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => ({ result: {}, text: e.tool.endsWith('_save') ? JSON.stringify({ outcome: 'saved', toasts: [1, 2, 3].map(i => ({ title: `${title}${i}` })) }) : '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const shown = async (toast: string, open = false) => {
    title = toast
    const id = `tw${n + 1}`
    await $.agent.spawn({ prompt: 'Requirement: Toast rows.', description: 't', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const call = (k: string, tool: string, a: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `${id}${k}`, agentId: id, ...a } as never)
    await call('save', 'save')
    for (let i = 1; i <= 30; i++) await call(`c${i}`, 'click', { name: `S${i}` })
    if (open) { const first = await $.ui.mount(PANE); await first.press({ key: `open:${id}/seen` }); await first.unmount() }
    const ui = await $.ui.mount({ ...PANE, viewport: { rows: 80, columns: 80 } } as never)
    const count = texts((await ui.drawn()) as Drawn, s => /^✓ Click/.test(s))
    await ui.unmount()
    await $.turn.complete({ agentId: id, answer: 'RESULT t: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return count
  }
  await keysRow($)
  const short = await shown('Saved ')
  // About 135 characters: cut to one row each, and once SEEN ON THE PAGE is pressed open three rows each with or
  // without a time column, so three toasts take six rows more.
  expect(await shown(`${'word '.repeat(26)}`)).toBe(short)
  expect(await shown(`${'word '.repeat(26)}`, true)).toBe(short - 6)
})

test('a pane narrower than 20 columns is measured at its own width', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'nw' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  const call = (k: string, a: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: k, agentId: 'nw', ...a } as never)
  await $.agent.spawn({ prompt: 'Requirement: Narrow.', description: 'n', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  for (let i = 1; i <= 30; i++) await call(`c${i}`, { name: `Step number ${i}` })
  // The header pressed open, so the loose steps wrap.
  const first = await $.ui.mount(PANE)
  await first.press({ key: 'open:nw/title' })
  await first.unmount()
  const shown = async (bodyColumns: number) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows: 60 } }, viewport: { rows: 80, columns: 80 } } as never)
    const count = texts((await ui.drawn()) as Drawn, s => /^✓ Click/.test(s))
    await ui.unmount()
    return count
  }
  expect(await shown(16)).toBeLessThan(await shown(20))
  const ui = await $.ui.mount(PANE)
  expect(((await ui.find({ type: 'Text', text: /Step number 30/ })) as { props?: { wrap?: string } } | undefined)?.props?.wrap).toBe('wrap')
  await ui.unmount()
})

// Steps the fit cuts stay one press away: a first row counts them and opens the whole list.
const setup = ($: any, on: any, tag: string) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `${tag}${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {}, text: '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  return async () => {
    const id = `${tag}${n + 1}`
    await $.agent.spawn({ prompt: 'Requirement: Earlier.', description: 'e', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    const call = (k: string, name: string, a: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${name}`, tool_use_id: `${id}${k}`, agentId: id, ...a } as never)
    return { id, call }
  }
}
// What a mount draws after an optional press (the press lands in state, so the draw is a fresh mount).
const view = async ($: any, bodyRows: number, step: RegExp, press?: string, bodyColumns = 60) => {
  const mount = () => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } }, viewport: { rows: 80, columns: 80 } } as never)
  if (press) {
    const first = await mount()
    await first.press({ key: press })
    await first.unmount()
  }
  const ui = await mount()
  const drawn = (await ui.drawn()) as Drawn
  const line = (await ui.find({ type: 'Text', text: /earlier steps$/ }))?.text
  await ui.unmount()
  return { line, lines: texts(drawn, s => /earlier steps$/.test(s)), count: texts(drawn, s => step.test(s)), at: indent(drawn, /earlier steps$/) }
}

// The smallest bodyRows where `ok` holds, found by halving: what a pane needs only ever grows with its list.
const smallest = async (ok: (rows: number) => Promise<boolean>, lo = 10, hi = 140) => {
  if (!(await ok(hi))) throw new Error(`smallest: the predicate fails at ${hi} rows, so there is no threshold below it`)
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (await ok(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

test('a cut list in the run view starts with an earlier-steps line that opens and folds it, and the line takes a row', async ($, on) => {
  const spawn = setup($, on, 'er')
  const { id, call } = await spawn()
  await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive' }], start: 'One' })
  for (let i = 1; i <= 30; i++) await call(`c${i}`, 'click', { name: `S${i}` })
  const step = /^[✓✗] /
  // The tallest pane that still cuts the list: one row less than the pane that holds it whole.
  const b = (await smallest(async rows => (await view($, rows, step)).line === undefined)) - 1
  expect(b).toBeGreaterThan(10)
  const cut = await view($, b, step)
  const whole = await view($, b + 1, step)
  const key = `open:${id}||One|earlier`
  const open = await view($, b, step, key)
  // The whole list holds T steps; the cut one shows two fewer: the step the fit cut and the line's row.
  expect(whole.line).toBeUndefined()
  expect(whole.count).toBeGreaterThan(5)
  expect(cut.line).toBe('▸ 2 earlier steps')
  expect(cut.count).toBe(whole.count - 2)
  expect(open.line).toBe('▾ 2 earlier steps')
  expect(open.count).toBe(whole.count)
  // Pressing again folds it: the same mount state, key pressed a second time.
  expect(await view($, b, step, key)).toMatchObject({ line: '▸ 2 earlier steps', count: whole.count - 2 })
})

test('the earlier-steps line sits at the indent of the steps it hides', async ($, on) => {
  const spawn = setup($, on, 'ei')
  const { call } = await spawn()
  await call('s', 'scenario', { plan: [{ title: 'One', kind: 'positive' }], start: 'One' })
  for (let i = 1; i <= 30; i++) await call(`c${i}`, 'click', { name: `S${i}` })
  const cut = await view($, 20, /^✓ /)
  expect(cut.line).toBeDefined()
  // A scenario's steps start at column 4 in the run view (requirement 0, scenario 2, steps 4).
  expect(cut.at).toBe(4)
})

test('the loose steps of a tester with no scenarios get the earlier-steps line under their own key', async ($, on) => {
  const spawn = setup($, on, 'el')
  const { id, call } = await spawn()
  for (let i = 1; i <= 30; i++) await call(`c${i}`, 'click', { name: `S${i}` })
  const step = /^✓ /
  const cut = await view($, 20, step)
  expect(cut.line).toMatch(/^▸ \d+ earlier steps$/)
  expect(cut.count + Number(/\d+/.exec(cut.line!)![0])).toBe((await view($, 80, step)).count)
  const open = await view($, 20, step, `open:${id}/earlier`)
  expect(open.line).toMatch(/^▾ \d+ earlier steps$/)
  expect(open.count).toBe(30)
})

test('a failed scenario the running one leaves no room still shows its line, and opens on a press', async ($, on) => {
  const spawn = setup($, on, 'ef')
  const { id, call } = await spawn()
  await call('p', 'scenario', { plan: [{ title: 'Newer', kind: 'negative' }, { title: 'Older', kind: 'negative' }] })
  await call('s0', 'scenario', { start: 'Older' })
  for (let i = 1; i <= 3; i++) await call(`o${i}`, 'click', { name: `Old${i}` })
  await call('e0', 'scenario', { end: 'Older', result: 'FAIL', reason: 'r' })
  await call('s1', 'scenario', { start: 'Newer' })
  for (let i = 1; i <= 30; i++) await call(`n${i}`, 'click', { name: `New${i}` })
  const old = /^✓ Click "Old/
  const shut = await view($, 30, old)
  expect(shut.count).toBe(0)
  // One line for the running list and one for the failed one it left no room.
  expect(shut.lines).toBe(2)
  const open = await view($, 30, old, `open:${id}||Older|earlier`)
  expect(open.count).toBe(3)
  expect(open.lines).toBe(2)
})

test('the lines of older lists take rows too: three failed scenarios behind a cut running one cost the running list three steps', async ($, on) => {
  const spawn = setup($, on, 'eb')
  // The same run with the failed scenarios holding steps or not; the pane then draws the finished one as a row.
  const run = async (held: number) => {
    const { id, call } = await spawn()
    await call('p', 'scenario', { plan: ['F1', 'F2', 'F3', 'Run'].map(title => ({ title, kind: 'negative' })) })
    for (const title of ['F1', 'F2', 'F3']) {
      await call(`s${title}`, 'scenario', { start: title })
      for (let i = 1; i <= held; i++) await call(`${title}${i}`, 'click', { name: `${title}-${i}` })
      await call(`e${title}`, 'scenario', { end: title, result: 'FAIL', reason: 'r' })
    }
    await call('sr', 'scenario', { start: 'Run' })
    for (let i = 1; i <= 30; i++) await call(`r${i}`, 'click', { name: `Run${i}` })
    const got = await view($, 40, /^✓ Click "Run/)
    await $.turn.complete({ agentId: id, answer: 'RESULT x: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return got
  }
  // The held run goes first, so no finished tester's row is drawn beside it.
  await keysRow($)
  const held = await run(3)
  const bare = await run(0)
  // One line for the running list and one for each failed one, which hold steps to hide.
  expect(bare.lines).toBe(1)
  expect(held.lines).toBe(4)
  expect(held.count).toBe(bare.count - 3)
})

test('an open list takes no rows from the budget, so an older list behind it keeps its steps', async ($, on) => {
  const spawn = setup($, on, 'eo')
  const { id, call } = await spawn()
  await call('p', 'scenario', { plan: [{ title: 'Run', kind: 'negative' }, { title: 'Small', kind: 'negative' }, { title: 'Big', kind: 'negative' }] })
  for (const [title, n] of [['Small', 3], ['Big', 10]] as const) {
    await call(`s${title}`, 'scenario', { start: title })
    for (let i = 1; i <= n; i++) await call(`${title}${i}`, 'click', { name: `${title}${i}` })
    await call(`e${title}`, 'scenario', { end: title, result: 'FAIL', reason: 'r' })
  }
  await call('sr', 'scenario', { start: 'Run' })
  for (let i = 1; i <= 5; i++) await call(`r${i}`, 'click', { name: `Run${i}` })
  const small = /^✓ Click "Small/
  // The tallest pane that cuts the list in front of the older one, which then has no room left.
  const b = (await smallest(async rows => (await view($, rows, /^✓ Click "Big/)).count === 10)) - 1
  expect(b).toBeGreaterThan(10)
  expect((await view($, b, small)).count).toBe(0)
  expect((await view($, b, small, `open:${id}||Big|earlier`)).count).toBe(3)
})

test('an open list that has come to fit whole is charged like any other, so the list behind it gets what is left', async ($, on) => {
  const spawn = setup($, on, 'ec')
  // Step names carry the run's tag, since a finished run keeps its failed scenarios' steps on screen.
  const run = async (tag: string) => {
    const { id, call } = await spawn()
    await call('p', 'scenario', { plan: ['Run', 'Small', 'Big'].map(title => ({ title, kind: 'negative' })) })
    for (const title of ['Small', 'Big']) {
      await call(`s${title}`, 'scenario', { start: title })
      for (let i = 1; i <= 3; i++) await call(`${title}${i}`, 'click', { name: `${title}${tag}${i}` })
      await call(`e${title}`, 'scenario', { end: title, result: 'FAIL', reason: 'r' })
    }
    await call('sr', 'scenario', { start: 'Run' })
    for (let i = 1; i <= 5; i++) await call(`r${i}`, 'click', { name: `Run${i}` })
    return id
  }
  const done = (id: string) => $.turn.complete({ agentId: id, answer: 'RESULT x: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
  const of = (name: string, tag: string) => new RegExp(`^✓ Click "${name}${tag}`)
  // Without the key: the tallest pane that cuts the list behind Big.
  await keysRow($)
  const bare = await run('a')
  const p = (await smallest(async rows => (await view($, rows, of('Small', 'a'))).count === 3)) - 1
  expect(p).toBeGreaterThan(10)
  const want = await view($, p, of('Small', 'a'))
  expect(want.count).toBeLessThan(3)
  await done(bare)
  // With it: Big is cut and opened in a short pane, then drawn in that tall one, where it fits whole and draws no line.
  const id = await run('b')
  const q = (await smallest(async rows => (await view($, rows, of('Big', 'b'))).count === 3, 10, p)) - 1
  expect(q).toBeGreaterThan(10)
  // Big is cut with its line at q, and the press opens it, so the key really is in state.
  const cutBig = await view($, q, of('Big', 'b'))
  expect(cutBig.count).toBeLessThan(3)
  expect(cutBig.line).toBeDefined()
  expect((await view($, q, of('Big', 'b'), `open:${id}||Big|earlier`)).count).toBe(3)
  const got = await view($, p, of('Small', 'b'))
  expect(await view($, p, of('Big', 'b'))).toMatchObject({ count: 3 })
  expect(got.count).toBe(want.count)
  expect(got.lines).toBe(want.lines)
})

test('the row an older list reserved for its line comes back on its own turn: holding F steps costs the pane F rows', async ($, on) => {
  const spawn = setup($, on, 'eg')
  // A running scenario of 6 steps and one older failed scenario holding `held` steps.
  const run = async (held: number) => {
    const { id, call } = await spawn()
    await call('p', 'scenario', { plan: ['Run', 'Old'].map(title => ({ title, kind: 'negative' })) })
    await call('so', 'scenario', { start: 'Old' })
    for (let i = 1; i <= held; i++) await call(`o${i}`, 'click', { name: `Old${i}` })
    await call('eo', 'scenario', { end: 'Old', result: 'FAIL', reason: 'r' })
    await call('sr', 'scenario', { start: 'Run' })
    for (let i = 1; i <= 6; i++) await call(`r${i}`, 'click', { name: `Run${i}` })
    // The smallest pane that draws every list whole, so with no line.
    const b = await smallest(async rows => (await view($, rows, /^✓ /)).line === undefined)
    await $.turn.complete({ agentId: id, answer: 'RESULT x: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return b
  }
  await keysRow($)
  const bare = await run(0)
  expect(bare).toBeGreaterThan(10)
  expect(await run(3)).toBe(bare + 3)
})

test('a pane too short for its reservations still shows an older list its short step, never a line for nothing', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'en1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  on('tool.call', async (_, e) => { if (e.tool_use_id === 'held') await held; return { result: {}, text: '{"ok":true}' } })
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'Requirement: Short.', description: 's', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  const call = (k: string, name: string, a: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${name}`, tool_use_id: k, agentId: 'en1', ...a } as never)
  await call('p', 'scenario', { plan: ['Run', 'Old'].map(title => ({ title, kind: 'negative' })) })
  await call('so', 'scenario', { start: 'Old' })
  await call('o1', 'save')
  await call('eo', 'scenario', { end: 'Old', result: 'FAIL', reason: 'r' })
  await call('sr', 'scenario', { start: 'Run' })
  // The running scenario's one step is held in Current Action, so its list is empty, and 12 rows are fewer than the fixed ones.
  const pressing = call('held', 'click', { name: 'R' })
  await new Promise(r => setTimeout(r, 0))
  const got = await view($, 12, /^✓ Save/, undefined, 24)
  release()
  await pressing
  expect(got.count).toBe(1)
  expect(got.lines).toBe(0)
})

test('an older list reserves no more rows than it could ever use: a one-row step behind a two-row line costs the pane one row', async ($, on) => {
  const spawn = setup($, on, 'ek')
  // A running scenario and one older failed scenario holding `held` one-row Save steps, at 24 columns where its line wraps.
  const run = async (held: number) => {
    const { id, call } = await spawn()
    await call('p', 'scenario', { plan: ['Run', 'Old'].map(title => ({ title, kind: 'negative' })) })
    await call('so', 'scenario', { start: 'Old' })
    for (let i = 1; i <= held; i++) await call(`o${i}`, 'save')
    await call('eo', 'scenario', { end: 'Old', result: 'FAIL', reason: 'r' })
    await call('sr', 'scenario', { start: 'Run' })
    for (let i = 1; i <= 6; i++) await call(`r${i}`, 'click', { name: 'R' })
    const b = await smallest(async rows => (await view($, rows, /^✓ /, undefined, 24)).line === undefined)
    await $.turn.complete({ agentId: id, answer: 'RESULT x: PASS', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
    return b
  }
  await keysRow($)
  const bare = await run(0)
  expect(bare).toBeLessThan(140)
  expect(await run(1)).toBe(bare + 1)
})

// A scenario's end answers with the server's verdict, which can overrule the result the tester passed.
const ended = async ($: any, on: any, agentId: string, kind: string, text: string) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_: unknown, e: { end?: string }) => ({ result: {}, text: e.end ? text : '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  const call = (n: number, args: object) => $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `${agentId}${n}`, agentId, ...args } as never)
  await $.agent.spawn({ prompt: 'Check this.\n\nRequirement: Saving shows Saved.', description: 'save', subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  await call(1, { plan: [{ title: 'It saves', kind }], start: 'It saves' })
  await call(2, { end: 'It saves', result: 'PASS' })
  return $.ui.mount(PANE)
}

test('an overruled PASS shows as FAIL with the failed check as its reason', async ($, on) => {
  const text = '{"ok":true,"verdict":"FAIL","overruled":true,"checks":[{"tool":"sf_wait","expected":"Saved","pass":true},{"tool":"sf_wait","expected":"Saved","pass":false}]}'
  const ui = await ended($, on, 'a9', 'positive', text)
  expect((await ui.find({ type: 'Text', text: /^Scenarios/ }))?.text).toBe('Scenarios 0 PASS · 1 FAIL')
  expect((await ui.find({ type: 'Text', text: /^overruled/ }))?.text).toBe('overruled: sf_wait "Saved"')
  await ui.unmount()
})

test('a result that is not JSON leaves the result the tester passed', async ($, on) => {
  const ui = await ended($, on, 'a10', 'positive', 'not json')
  expect((await ui.find({ type: 'Text', text: /^Scenarios/ }))?.text).toBe('Scenarios 1 PASS · 0 FAIL')
  await ui.unmount()
})

test('a scenario the server says was unplanned is counted as positive', async ($, on) => {
  const ui = await ended($, on, 'a11', 'negative', '{"ok":true,"verdict":"PASS","unplanned":true,"checks":[]}')
  expect((await ui.find({ type: 'Text', text: /positive ·/ }))?.text).toBe('1 positive · 0 negative')
  await ui.unmount()
})

// Whole frames: the drawn tree as the text lines a terminal shows at a width. Padding and borders indent, a row is one
// line with its last part flush right, a Text wraps or is cut as its wrap says, a plain Button shows its hotkey.
const cut = (text: string, w: number, mode: string): string[] => {
  if (mode !== 'wrap') return [text.length > w ? `${text.slice(0, Math.max(0, w - 1))}…` : text]
  const out: string[] = []
  for (const line of text.split('\n')) {
    let cur = ''
    for (const [i, word] of line.split(' ').entries()) {
      if (i > 0 && cur.length + 1 + word.length > w && word.length <= w) { out.push(cur); cur = word; continue }
      cur = i === 0 ? word : `${cur} ${word}`
      while (cur.length > w) { out.push(cur.slice(0, w)); cur = cur.slice(w) }
    }
    out.push(cur)
  }
  return out
}
const nodes = (d: Drawn) => (d.children ?? []).filter(k => k && typeof k === 'object') as Drawn[]
const inline = (d: Drawn): string => (d.type === 'Button' && d.props?.hotkey ? `${d.props.hotkey}: ` : '')
  + (d.children ?? []).map(k => (typeof k === 'string' ? k : k && typeof k === 'object' ? inline(k as Drawn) : '')).join('')
const mode = (d: Drawn): string => (d.type === 'Text' && d.props?.wrap ? String(d.props.wrap) : nodes(d).map(mode).find(m => m !== 'wrap') ?? 'wrap')
const frame = (d: Drawn, w: number): string[] => {
  if (d.type !== 'Box') return cut(inline(d), w, mode(d))
  const p = d.props ?? {}
  const kids = nodes(d)
  const edge = p.borderStyle ? 1 : 0
  const pad = Number(p.paddingLeft ?? 0) + Number(p.paddingX ?? 0)
  const inner = Math.max(1, w - pad - Number(p.paddingX ?? 0) - 2 * edge)
  let body: string[]
  if (p.flexDirection === 'column') body = kids.flatMap(k => frame(k, inner))
  else if (p.justifyContent === 'space-between' && kids.length > 1) {
    const right = inline(kids.at(-1)!)
    const room = Math.max(1, inner - right.length)
    const left = kids.slice(0, -1)
    body = cut(left.map(inline).join(''), room, left.map(mode).find(m => m !== 'wrap') ?? 'wrap').map((l, i) => (i === 0 ? l.padEnd(room) + right : l))
  } else body = kids.length ? cut(kids.map(inline).join(''), inner, mode(d)) : []
  body = body.map(l => (edge ? `│${' '.repeat(pad)}${l.padEnd(inner)}${' '.repeat(Number(p.paddingX ?? 0))}│` : ' '.repeat(pad) + l))
  if (edge) body = [`╭${'─'.repeat(w - 2)}╮`, ...body, `╰${'─'.repeat(w - 2)}╯`]
  return [...Array(Number(p.marginTop ?? 0)).fill(''), ...body].map(l => l.trimEnd())
}

// One world per frame state: a clock at T0, testers f1, f2, ... and tool calls that hold, fail or raise a toast as asked.
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0)
const AT = new Date(T0).toTimeString().slice(0, 5)
const world = ($: any, on: any, isPlaced = true) => {
  const clock = mock.clock(on, { now: T0 })
  const gates: (() => void)[] = []
  const open: Promise<unknown>[] = []
  let n = 0
  let k = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `f${++n}` }))
  on('ui.open', () => ({ value: isPlaced ? { isPlaced } : { isPlaced, reason: 'narrow' } }))
  on('tool.call', async (_: unknown, e: { hold?: boolean; fail?: string; toast?: string; reply?: string }) => {
    if (e.hold) await new Promise<void>(r => gates.push(r))
    return e.fail ? { isError: true, result: {}, text: JSON.stringify({ code: 'TIMEOUT', message: e.fail }) }
      : { result: {}, text: e.toast ? JSON.stringify({ toasts: [{ title: e.toast }] }) : e.reply ?? '{"ok":true}' }
  })
  on('turn.complete', () => ({ text: '' }))
  const spawn = (feature: string) => $.agent.spawn({ prompt: `Requirement: ${feature}`, description: feature, subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
  const call = (id: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `k${++k}`, agentId: id, ...args } as never)
  // A call left running, so its step is the Current Action; release ends every held call.
  const hold = async (id: string, tool: string, args: object = {}) => { open.push(call(id, tool, { ...args, hold: true })); await clock.advance(0) }
  const end = (id: string, answer: string, isAborted = false) => $.turn.complete({ agentId: id, answer, durationMs: 1, isAborted, turnId: `t${id}`, reason: 'answer' } as never)
  const release = async () => { gates.forEach(r => r()); await Promise.all(open) }
  return { clock, spawn, call, hold, end, release }
}
type World = ReturnType<typeof world>
const plan = (titles: [string, 'positive' | 'negative'][], requirement?: string) => ({ plan: titles.map(([title, kind]) => ({ title, kind, ...(requirement && { requirement }) })) })
// A running tester with one scenario under way and a held step.
const busy = async (w: World, id: string, feature: string, button: string) => {
  await w.spawn(feature)
  await w.call(id, 'scenario', { ...plan([[`${button} works`, 'positive'], [`${button} twice is refused`, 'negative']]), start: `${button} works` })
  await w.call(id, 'open_record')
  await w.clock.advance(12_000)
  await w.hold(id, 'click', { role: 'button', name: button })
}
const STATES: Record<string, (w: World) => Promise<void>> = {
  'a run in progress with one failed scenario': async w => {
    await w.spawn('Closing a case needs a Reason, and the owner is told by email.')
    await w.call('f1', 'login_as', { user: 'sales-rep' })
    await w.call('f1', 'scenario', { ...plan([['A case with a Reason closes', 'positive'], ['A blank Reason is refused with a message under the field', 'negative'], ['The owner gets the email', 'positive']], 'Close with a Reason'), start: 'A case with a Reason closes' })
    await w.call('f1', 'click', { role: 'option', name: 'Closed' })
    await w.call('f1', 'save', { toast: 'Case closed' })
    await w.call('f1', 'scenario', { end: 'A case with a Reason closes', result: 'PASS', start: 'A blank Reason is refused with a message under the field' })
    await w.call('f1', 'save')
    await w.call('f1', 'wait', { text: 'Enter a Reason', fail: 'no text "Enter a Reason" in 10000 ms' })
    await w.call('f1', 'scenario', { end: 'A blank Reason is refused with a message under the field', result: 'FAIL', reason: 'the case saved with no Reason', start: 'The owner gets the email' })
    await w.call('f1', 'open_related_list', { relationship: 'EmailMessages' })
    await w.clock.advance(41_000)
    await w.hold('f1', 'wait', { text: 'Case closed: owner notified' })
  },
  'a finished FAIL': async w => {
    await w.spawn('Count never goes below zero.')
    await w.call('f1', 'scenario', { ...plan([['Count -1 is blocked', 'negative'], ['Count 0 saves', 'positive']], 'Count'), start: 'Count -1 is blocked' })
    await w.call('f1', 'set_fields', { values: { Count__c: -1 } })
    await w.call('f1', 'save')
    await w.call('f1', 'scenario', { end: 'Count -1 is blocked', result: 'FAIL', reason: 'saved with Count -1', start: 'Count 0 saves' })
    await w.call('f1', 'save')
    await w.call('f1', 'scenario', { end: 'Count 0 saves', result: 'PASS' })
    await w.clock.advance(81_000)
    await w.end('f1', 'One scenario failed.')
  },
  'a finished tester with no result line': async w => {
    await w.spawn('The code check refuses ab and accepts ABC.')
    await w.call('f1', 'scenario', { ...plan([['ab is refused', 'negative'], ['ABC is accepted', 'positive']]), start: 'ab is refused' })
    await w.call('f1', 'fill', { name: 'Code', value: 'ab' })
    await w.call('f1', 'scenario', { end: 'ab is refused', result: 'PASS' })
    await w.clock.advance(30_000)
    await w.end('f1', 'I ran out of turns.')
  },
  'two running testers': async w => {
    await busy(w, 'f1', 'Next opens the second screen.', 'Next')
    await busy(w, 'f2', 'Back keeps what was typed on the first screen.', 'Back')
  },
  'three running testers': async w => {
    await busy(w, 'f1', 'Next opens the second screen.', 'Next')
    await busy(w, 'f2', 'Back keeps what was typed on the first screen.', 'Back')
    await busy(w, 'f3', 'Finish saves the record.', 'Finish')
  },
  'a tester waiting with a question': async w => {
    await w.spawn('Reopening a closed case clears the Reason.')
    await w.clock.advance(5_000)
    await w.end('f1', 'No app named.\n\nBLOCKED: which app should I test in, Sales or Service?')
  },
  'no tester': async () => {},
}
const frameAt = async ($: any, bodyColumns: number) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns } } as never)
  const lines = frame((await ui.drawn()) as Drawn, bodyColumns)
  await ui.unmount()
  return lines
}
// Set to true and run the tests to print every state's frame at 40 and 60 columns.
const DUMP = false
const FRAMES: Record<string, string[]> = {
  'a run in progress with one failed scenario': [
    `Running 1 · Done 0 (0 PASS, 0 FAIL)`,
    `Scenarios 1 PASS · 1 FAIL · 1 RUNNING`,
    ``,
    `● RUNNING  41s                        1 of 3 passed · 1 FAIL`,
    `▰▰▰▰▰▰▰▰▰▰▰▰▰✗✗✗✗✗✗✗✗✗✗✗✗✗▷▷▷▷▷▷▷▷▷▷▷▷▷`,
    `Closing a case needs a Reason, and the owner is told by ema…`,
    `2 positive · 1 negative`,
    ``,
    `Requirement: Close with a Reason ▸`,
    `  + A case with a Reason closes ▸            sales-rep  PASS`,
    ``,
    `  ╭────────────────────────────────────────────────────────╮`,
    `  │ − A blank Reason is refused with a message under… FAIL │`,
    `  │   ✓ Save                                  explore 0.0s │`,
    `  │   ✗ Wait for "Enter a Reason"             explore 0.0s │`,
    `  │     TIMEOUT: no text "Enter a Reason" in 10000 ms      │`,
    `  │   the case saved with no Reason                        │`,
    `  ╰────────────────────────────────────────────────────────╯`,
    ``,
    `  + The owner gets the email              sales-rep  RUNNING`,
    `    ✓ Open the "EmailMessages" related list     explore 0.0s`,
    ``,
    `SEEN ON THE PAGE`,
    `  toast  "Case closed"                              ${AT}:00`,
    ``,
    `╭──────────────────────────────────────────────────────────╮`,
    `│ Current Action - Close with a Reason · as sales-rep      │`,
    `│ > Wait for "Case closed: owner notified"                 │`,
    `╰──────────────────────────────────────────────────────────╯`,
  ],
  'a finished FAIL': [
    `Running 0 · Done 1 (0 PASS, 1 FAIL)`,
    `c: Clear · ctrl+x tab to use keys`,
    ``,
    `────────────────────────────────────────`,
    `FAIL · 1 of 2 scenarios passed        ${AT} · 1m 21s · Clear`,
    `Count never goes below zero.`,
    ``,
    `Requirement: Count ▸`,
    `  ╭────────────────────────────────────────────────────────╮`,
    `  │ − Count -1 is blocked                             FAIL │`,
    `  │   ✓ Fill out the form (Count)             explore 0.0s │`,
    `  │   ✓ Save                                  explore 0.0s │`,
    `  │   saved with Count -1                                  │`,
    `  ╰────────────────────────────────────────────────────────╯`,
    ``,
    `  + Count 0 saves ▸                                     PASS`,
  ],
  'a finished tester with no result line': [
    `Running 0 · Done 1 (0 PASS, 0 FAIL, 1 STOPPED)`,
    `c: Clear · ctrl+x tab to use keys`,
    ``,
    `────────────────────────────────────────`,
    `STOPPED · 1 of 2 scenarios passed        ${AT} · 30s · Clear`,
    `The code check refuses ab and accepts ABC.`,
    ``,
    `  − ab is refused ▸                                     PASS`,
    ``,
    `  + ABC is accepted                             not finished`,
  ],
  'two running testers': [
    `Running 2 · Done 0 (0 PASS, 0 FAIL)`,
    `Scenarios 0 PASS · 0 FAIL · 2 RUNNING · 2 to run`,
    ``,
    `● RUNNING  24s                                 0 of 2 passed`,
    `Next opens the second screen.`,
    ``,
    `  + Next works                                       RUNNING`,
    `    ✓ Open the record                           explore 0.0s`,
    ``,
    `  − Next twice is refused                             to run`,
    ``,
    `╭──────────────────────────────────────────────────────────╮`,
    `│ Current Action - Next works                              │`,
    `│ > Click the "Next" button                                │`,
    `╰──────────────────────────────────────────────────────────╯`,
    ``,
    `● RUNNING  12s                                 0 of 2 passed`,
    `Back keeps what was typed on the first screen.`,
    ``,
    `  + Back works                                       RUNNING`,
    `    ✓ Open the record                           explore 0.0s`,
    ``,
    `  − Back twice is refused                             to run`,
    ``,
    `╭──────────────────────────────────────────────────────────╮`,
    `│ Current Action - Back works                              │`,
    `│ > Click the "Back" button                                │`,
    `╰──────────────────────────────────────────────────────────╯`,
  ],
  'three running testers': [
    `Running 3 · Done 0 (0 PASS, 0 FAIL)`,
    `Scenarios 0 PASS · 0 FAIL · 3 RUNNING · 3 to run`,
    `ctrl+x tab to use keys`,
    ``,
    `2: ▸ ● RUNNING  24s · 0 of 2 passed · Back keeps what was t…`,
    `3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the reco…`,
    ``,
    `1: ▾ ● RUNNING  36s                            0 of 2 passed`,
    `▷▷▷▷▷▷▷▷▷▷▷▷▷▷▷▷▷▷▷▷▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱`,
    `Next opens the second screen.`,
    `1 positive · 1 negative`,
    ``,
    `  + Next works                                       RUNNING`,
    `    ✓ Open the record                           explore 0.0s`,
    ``,
    `  − Next twice is refused                             to run`,
    ``,
    `╭──────────────────────────────────────────────────────────╮`,
    `│ Current Action - Next works                              │`,
    `│ > Click the "Next" button                                │`,
    `╰──────────────────────────────────────────────────────────╯`,
  ],
  'a tester waiting with a question': [
    `Running 0 · Done 0 (0 PASS, 0 FAIL) · 1 waiting`,
    `ctrl+x tab, then tab to Dismiss`,
    ``,
    `────────────────────────────────────────`,
    `BLOCKED · waiting for you               ${AT} · 5s · Dismiss`,
    `Reopening a closed case clears the Reason.`,
    `Question: which app should I test in, Sales or Service?`,
  ],
  'no tester': [
    `Running 0 · Done 0 (0 PASS, 0 FAIL)`,
    `No sf-tester to show.`,
  ],
}
for (const [name, build] of Object.entries(STATES)) {
  test(`whole frame: ${name}`, async ($, on) => {
    const w = world($, on)
    await build(w)
    if (DUMP) for (const cols of [40, 60]) (globalThis as any).console.log([`=== ${name} @ ${cols}`, ...(await frameAt($, cols))].join('\n'))
    const got = await frameAt($, 60)
    await w.release()
    expect(got).toEqual(FRAMES[name])
    // A 30-row pane holds every state whole, so the header never scrolls off.
    expect(got.length).toBeLessThanOrEqual(30)
  })
}

// A turn that ends with no RESULT line and no question. Before: 'DONE · 0 of 2 scenarios passed', 'PASS · 1 of 2
// scenarios passed', 'PASS · 1 of 1 scenarios passed' (aborted) and 'DONE · 1 step' (no scenario), all counted as Done.
test('a tester that ends with no result and no question is STOPPED, never PASS, and the header counts it apart', async ($, on) => {
  const w = world($, on)
  const two = plan([['One', 'positive'], ['Two', 'positive']])
  // f1: a scenario still running. f2: one PASS, one never started. f3: every scenario PASS, then aborted. f4: no scenario at all, DONE.
  for (const f of ['Unfinished.', 'Half done.', 'Aborted.', 'No scenario.']) await w.spawn(f)
  await w.call('f1', 'scenario', { ...two, start: 'One' })
  await w.call('f2', 'scenario', { ...two, start: 'One' })
  await w.call('f2', 'scenario', { end: 'One', result: 'PASS' })
  await w.call('f3', 'scenario', { ...plan([['One', 'positive']]), start: 'One' })
  await w.call('f3', 'scenario', { end: 'One', result: 'PASS' })
  await w.call('f4', 'click', { name: 'Go' })
  await w.end('f1', 'Out of turns.')
  await w.end('f2', 'Out of turns.')
  await w.end('f3', 'RESULT cut off', true)
  await w.end('f4', 'Read the diff; nothing to run.')
  // A whole run with no RESULT line keeps its verdict from its scenarios, and a failed scenario is a FAIL even unfinished.
  await w.spawn('Whole.')
  await w.call('f5', 'scenario', { ...plan([['One', 'positive']]), start: 'One' })
  await w.call('f5', 'scenario', { end: 'One', result: 'PASS' })
  await w.end('f5', 'All checked.')
  await w.spawn('Failed early.')
  await w.call('f6', 'scenario', { ...two, start: 'One' })
  await w.call('f6', 'scenario', { end: 'One', result: 'FAIL', reason: 'r' })
  await w.end('f6', 'Out of turns.')
  const head = (await frameAt($, 60))[0]
  // Only the last three finished testers show, so the newest three are read, then hidden to show the first three.
  const read = async () => (await frameAt($, 60)).filter(l => /^(STOPPED|PASS|FAIL|DONE) ·/.test(l)).map(l => l.replace(/ {2,}.*$/, '')).reverse()
  const newest = await read()
  const ui = await $.ui.mount(PANE)
  for (const id of ['f4', 'f5', 'f6']) await ui.press({ key: `hide:${id}` })
  await ui.unmount()
  expect([...(await read()), ...newest]).toEqual(['STOPPED · 0 of 2 scenarios passed', 'STOPPED · 1 of 2 scenarios passed', 'STOPPED · aborted · 1 of 1 scenarios passed', 'DONE · 1 step', 'PASS · 1 of 1 scenarios passed', 'FAIL · 0 of 2 scenarios passed'])
  expect(head).toMatch(/^Running 0 · Done 6 \(1 PASS, 1 FAIL, 3 STOPPED, 1 DONE\)/)
  const stopped = await $.ui.mount(PANE)
  expect(((await stopped.find({ type: 'Text', text: /^STOPPED/ })) as { props?: { color?: string } } | undefined)?.props?.color).toBe('warning')
  await stopped.unmount()
})

test('a pane that cannot be placed raises one toast for the session, not one per spawn', async ($, on) => {
  const w = world($, on, false)
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  await w.spawn('First.')
  await w.spawn('Second.')
  await w.clock.advance(0)
  expect(toasts).toEqual(['sf-tester is running. /sf-tester-pane shows its steps.'])
})

test('a placed pane raises no toast', async ($, on) => {
  const w = world($, on)
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  await w.spawn('First.')
  await w.clock.advance(0)
  expect(toasts).toEqual([])
})

test('Clear shows its key, a finished block has none, and a hint names the focus key until the pane has the keyboard', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Still running.', 'Next')
  for (const [i, answer] of ['RESULT a: PASS', 'BLOCKED: which app?'].entries()) { await w.spawn(`Done ${i}.`); await w.end(`f${i + 2}`, answer) }
  const at = async (props: object) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80, ...props } } as never)
    const tree = (await ui.drawn()) as Drawn
    const keys = await Promise.all(['clear', 'hide:f3', 'hide:f2', 'pick:f1'].map(async key => { const b = (await ui.find({ key })) as { props?: { hotkey?: string } } | undefined; return b ? b.props?.hotkey ?? 'none' : 'absent' }))
    await ui.unmount()
    const cols = (props as { bodyColumns?: number }).bodyColumns ?? 80
    return { keys, head: frame(tree, cols)[0], lines: frame(tree, cols) }
  }
  const idle = await at({})
  // Clear and Dismiss on a finished block are Buttons with no key, and one running tester alone needs no pick.
  expect(idle.keys).toEqual(['c', 'none', 'none', 'absent'])
  expect(idle.lines.filter(l => /(Clear|Dismiss)$/.test(l)).map(l => l.match(/\S+ \S+ \S+$/)![0])).toEqual(['0s · Dismiss', '0s · Clear'])
  // Clear sits in the keys row under the status line, beside the focus hint, never on the status line itself.
  const HEAD = 'Running 1 · Done 1 (1 PASS, 0 FAIL) · 1 waiting'
  expect(idle.lines.slice(0, 3)).toEqual([HEAD, 'Scenarios 0 PASS · 0 FAIL · 1 RUNNING · 1 to run', 'c: Clear · ctrl+x tab to use keys'])
  // Focused, the keys work, so the hint goes and the keys stay.
  const TALLY = 'Scenarios 0 PASS · 0 FAIL · 1 RUNNING · 1 to run'
  expect((await at({ isFocused: true })).lines.slice(0, 3)).toEqual([HEAD, TALLY, 'c: Clear'])
  // The hint goes first: in a pane under 20 rows, and in one too narrow for both. A wrapped status line takes no key with it.
  expect((await at({ scroll: { offset: 0, bodyRows: 19 } })).lines.slice(0, 3)).toEqual([HEAD, TALLY, 'c: Clear'])
  const narrow = async (bodyColumns: number) => (await at({ bodyColumns })).lines.filter((l, i) => i < 2 || l.startsWith('c: '))
  expect(await narrow(33)).toEqual(['Running 1 · Done 1 · 1 waiting', '1 PASS · 0 FAIL', 'c: Clear · ctrl+x tab to use keys'])
  expect(await narrow(32)).toEqual(['Running 1 · Done 1 · 1 waiting', '1 PASS · 0 FAIL', 'c: Clear'])
  await w.release()
})

test('a digit picks a running tester while the pane folds, and never hides a block: no finished block has a key', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'First.', 'Next')
  await busy(w, 'f2', 'Second.', 'Back')
  await busy(w, 'f3', 'Third.', 'Finish')
  for (const i of [4, 5]) { await w.spawn(`Done ${i}.`); await w.end(`f${i}`, 'RESULT a: PASS') }
  const ui = await $.ui.mount(PANE)
  const key = async (k: string) => ((await ui.find({ key: k })) as { props?: { hotkey?: string } } | undefined)?.props?.hotkey
  expect(await Promise.all(['pick:f1', 'pick:f2', 'pick:f3', 'hide:f4', 'hide:f5', 'clear'].map(key))).toEqual(['1', '2', '3', undefined, undefined, 'c'])
  const lines = frame((await ui.drawn()) as Drawn, 60)
  // The one in full carries the open arrow, each row the closed one: a mark that needs no colour. The rows come first.
  expect(lines.filter(l => /^\d: /.test(l)).map(l => l.slice(0, 14))).toEqual(['2: ▸ ● RUNNING', '3: ▸ ● RUNNING', '1: ▾ ● RUNNING'])
  // The digit's press picks and hides nothing.
  await ui.press({ key: 'pick:f2' })
  await ui.unmount()
  expect((await frameAt($, 60)).filter(l => /^PASS ·/.test(l)).length).toBe(2)
  expect((await frameAt($, 60))[2]).toBe('c: Clear · ctrl+x tab to use keys')
  await w.release()
})

test('with room for every block no digit is drawn, and no hint for keys that do not exist', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'First.', 'Next')
  await busy(w, 'f2', 'Second.', 'Back')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 70 } } } as never)
  const lines = frame((await ui.drawn()) as Drawn, 60)
  expect([await ui.find({ key: 'pick:f1' }), await ui.find({ key: 'pick:f2' })]).toEqual([undefined, undefined])
  await ui.unmount()
  expect([lines.filter(l => /^\d: /.test(l)).length, lines.filter(l => /^● RUNNING/.test(l)).length, lines.some(l => l.includes('ctrl+x'))]).toEqual([0, 2, false])
  await w.release()
})

test('a pane with no hotkey shows no focus hint', async ($, on) => {
  const w = world($, on)
  await w.spawn('Only running.')
  expect((await frameAt($, 60))[0]).toBe('Running 1 · Done 0 (0 PASS, 0 FAIL)')
})

test('a status row is one line with its status whole, and a press opens its text in full', async ($, on) => {
  const w = world($, on)
  await STATES['a run in progress with one failed scenario']!(w)
  const cutRows = await frameAt($, 40)
  // Narrower still, the requirement row is cut too, its arrow with it in this drawing.
  expect((await frameAt($, 30)).some(l => l === 'Requirement: Close with a Rea…')).toBe(true)
  // Title, requirement, scenario, step and toast: one row each at 40 columns, the right-hand status or time whole.
  expect(cutRows.filter(l => l.includes('…'))).toEqual([
    'Closing a case needs a Reason, and the …',
    '  │ − A blank Reason is refused … FAIL │',
    '  │   ✗ Wait for "Enter … explore 0.0s │',
    '    ✓ Open the "EmailMessa… explore 0.0s',
  ])
  expect(cutRows.includes(`  toast  "Case closed"          ${AT}:00`)).toBe(true)
  // How the toast and a step of a scenario are drawn, in a pane tall enough to hold every step.
  const tall = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 80 } } } as never
  const wraps = async () => {
    const ui = await $.ui.mount(tall)
    const got = await Promise.all([/^toast/, /^✗ Wait for/].map(async text => ((await ui.find({ type: 'Text', text })) as { props?: { wrap?: string } } | undefined)?.props?.wrap))
    await ui.unmount()
    return got
  }
  expect(await wraps()).toEqual(['truncate-end', 'truncate-end'])
  const ui = await $.ui.mount(PANE)
  for (const key of ['f1/title', 'f1|Close with a Reason', 'f1/seen']) await ui.press({ key: `open:${key}` })
  await ui.unmount()
  expect(await wraps()).toEqual(['wrap', 'wrap'])
  const open = await frameAt($, 40)
  expect(open.filter(l => l.includes('…'))).toEqual([])
  expect(open[open.indexOf('Closing a case needs a Reason, and the') + 1]).toBe('owner is told by email.')
  // The titles the cut rows lost are drawn to their last word.
  expect(['Requirement: Close with a Reason ▾', 'closes ▾', 'field'].map(end => open.some(l => l.replace(/ *│$/, '').replace(/ +PASS$/, '').endsWith(end)))).toEqual([true, true, true])
  // Prose still wraps: the failed scenario's reason and the Current Action step.
  expect(cutRows.some(l => l.includes('notified"'))).toBe(true)
  await w.release()
})

test('a finished verdict is never cut: a short row drops the clock time, then the duration, then wraps the verdict whole', async ($, on) => {
  const w = world($, on)
  await STATES['a finished FAIL']!(w)
  const row = async (cols: number) => { const lines = await frameAt($, cols); const i = lines.findIndex(l => l.startsWith('FAIL ·')); return lines.slice(i, lines.indexOf('Count never goes below zero.')) }
  const rows: string[][] = []
  for (const cols of [60, 53, 52, 45, 44, 36, 30]) rows.push(await row(cols))
  expect(rows).toEqual([
    [`FAIL · 1 of 2 scenarios passed        ${AT} · 1m 21s · Clear`],
    [`FAIL · 1 of 2 scenarios passed ${AT} · 1m 21s · Clear`],
    ['FAIL · 1 of 2 scenarios passed        1m 21s · Clear'],
    ['FAIL · 1 of 2 scenarios passed 1m 21s · Clear'],
    ['FAIL · 1 of 2 scenarios passed         Clear'],
    ['FAIL · 1 of 2 scenarios passed Clear'],
    ['FAIL · 1 of 2 scenarios  Clear', 'passed'],
  ])
})

test('a finished block keeps its verdict row and its header to one line each, and a press opens the header', async ($, on) => {
  const w = world($, on)
  await STATES['a finished tester with no result line']!(w)
  const rows = async () => (await frameAt($, 40)).filter(l => /^(STOPPED ·|The code|ABC)/.test(l))
  expect(await rows()).toEqual(['STOPPED · 1 of 2 scenarios passed  Clear', 'The code check refuses ab and accepts A…'])
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:f1/title' })
  await ui.unmount()
  expect((await rows()).slice(1)).toEqual(['The code check refuses ab and accepts', 'ABC.'])
})

test('the steps a press opens on a finished block show in full', async ($, on) => {
  const w = world($, on)
  await w.spawn('Loose.')
  await w.call('f1', 'click', { name: 'A button with a name too long for one row of a narrow pane' })
  await w.end('f1', 'RESULT l: PASS')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:f1/steps' })
  await ui.unmount()
  const lines = await frameAt($, 40)
  expect([lines.some(l => l.includes('…')), lines.some(l => l.includes('narrow pane"'))]).toEqual([false, true])
})

test('finished testers past the last three are counted in a header row, and a press on it shows them all', async ($, on) => {
  const w = world($, on)
  const verdicts = async () => { const lines = await frameAt($, 60); return [lines.filter(l => /^(PASS|FAIL) ·/.test(l)).length, lines.find(l => l.includes('older'))] }
  for (const i of [1, 2, 3]) { await w.spawn(`Run ${i}.`); await w.end(`f${i}`, 'RESULT r: PASS') }
  // Three finished: all show, so there is nothing to count.
  expect(await verdicts()).toEqual([3, undefined])
  for (const i of [4, 5]) { await w.spawn(`Run ${i}.`); await w.end(`f${i}`, 'RESULT r: FAIL') }
  expect(await verdicts()).toEqual([3, 'm: ▸ 2 older finished'])
  // The row sits in the header, above every block whose number it changes.
  const lines = await frameAt($, 60)
  expect(lines.findIndex(l => l.includes('older'))).toBeLessThan(lines.findIndex(l => l.startsWith('──')))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'more' })
  await ui.unmount()
  expect(await verdicts()).toEqual([5, 'm: ▾ 2 older finished'])
})

// Twelve scenarios, the seventh failed: 31 rows drawn whole, three more than a 30-row pane has under its two header rows.
const twelve = async (w: World) => {
  await w.spawn('Twelve checks.')
  const titles = Array.from({ length: 12 }, (_, i) => `Check ${i + 1}`)
  await w.call('f1', 'scenario', { ...plan(titles.map(t => [t, 'positive'])), start: titles[0] })
  for (const [i, t] of titles.entries()) await w.call('f1', 'scenario', { end: t, result: i === 6 ? 'FAIL' : 'PASS', ...(i === 6 && { reason: 'the seventh broke' }), ...(i < 11 && { start: titles[i + 1] }) })
  await w.call('f1', 'open_record')
  await w.end('f1', 'RESULT a: FAIL')
}
const pressed = async ($: any, key: string, rows = 30) => {
  const ui = await $.ui.mount(PANE)
  await ui.press({ key })
  await ui.unmount()
  const tall = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } } as never)
  const lines = frame((await tall.drawn()) as Drawn, 60)
  await tall.unmount()
  return lines
}

// The row of a folded block that counts its hidden scenarios, in each of its wordings.
const isFoldRow = (l: string) => /^[▸▾] \d+ (passed scenarios|passed · \d+ more not finished|more not finished)$/.test(l)

test('a finished block that does not fit its rows shows its verdict, its failed scenarios, then a row that counts and opens the rest', async ($, on) => {
  const w = world($, on)
  await twelve(w)
  const short = await frameAt($, 60)
  expect(short).toEqual([
    'Running 0 · Done 1 (0 PASS, 1 FAIL)',
    'c: Clear · ctrl+x tab to use keys',
    '',
    '────────────────────────────────────────',
    `FAIL · 11 of 12 scenarios passed          ${AT} · 0s · Clear`,
    'Twelve checks.',
    '',
    '▸ 11 passed scenarios',
    '  ╭────────────────────────────────────────────────────────╮',
    '  │ + Check 7                                         FAIL │',
    '  │   the seventh broke                                    │',
    '  ╰────────────────────────────────────────────────────────╯',
  ])
  // The press opens the others in the one list under the row, the failed one still first, and the loose steps come back.
  const open = await pressed($, 'open:f1/all')
  const at = (text: string) => open.findIndex(l => l.includes(text))
  expect([at('▾ 11 passed scenarios') < at('Check 7'), at('Check 7') < at('Check 1 '), open.filter(l => l.endsWith(' PASS')).length, open.at(-1)]).toEqual([true, true, 11, 'Steps outside a scenario (1) ▸'])
  expect(await pressed($, 'open:f1/all')).toEqual(short)
  // Whole, the block is 33 rows under the two header rows: at 35 it shows as before, in the order run, and at 34 it is short.
  const rows = async (n: number) => { const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: n } } } as never); const l = frame((await ui.drawn()) as Drawn, 60); await ui.unmount(); return l }
  const whole = await rows(35)
  expect([whole.length, whole.some(l => l.includes('passed scenarios')), whole.findIndex(l => l.includes('Check 1 ')) < whole.findIndex(l => l.includes('Check 7'))]).toEqual([35, false, true])
  expect(await rows(34)).toEqual(short)
})

test('finished blocks get the rows the running blocks leave, and a block with nothing to fold is never short', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Still running.', 'Next')
  await w.spawn('Count never goes below zero.')
  await w.call('f2', 'scenario', { ...plan([['Count -1 is blocked', 'negative'], ['Count 0 saves', 'positive'], ['Count 1 saves', 'positive']]), start: 'Count -1 is blocked' })
  await w.call('f2', 'scenario', { end: 'Count -1 is blocked', result: 'FAIL', reason: 'saved with Count -1', start: 'Count 0 saves' })
  await w.call('f2', 'scenario', { end: 'Count 0 saves', result: 'PASS', start: 'Count 1 saves' })
  await w.call('f2', 'scenario', { end: 'Count 1 saves', result: 'PASS' })
  await w.end('f2', 'One failed.')
  await w.spawn('Which app?')
  await w.end('f3', 'BLOCKED: which app should I test in?')
  const at = async (n: number) => { const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: n } } } as never); const l = frame((await ui.drawn()) as Drawn, 60); await ui.unmount(); return l }
  // Three header rows, 15 for the running block, 5 for the question and 13 for the finished block whole: 36 rows.
  const fits = await at(36)
  expect([fits.length, fits.some(l => l.includes('passed scenarios')), fits.at(-1)]).toEqual([36, false, '  + Count 1 saves                                       PASS'])
  const short = await at(35)
  expect([short.length, short.includes('▸ 2 passed scenarios'), short.at(-1)]).toEqual([33, true, '  ╰────────────────────────────────────────────────────────╯'])
  // The waiting block has no scenario to fold, so it keeps its question in any pane.
  expect((await at(10)).some(l => l.startsWith('Question: which app'))).toBe(true)
  await w.release()
})

test('a finished block with no scenario to fold keeps its opened steps in a pane too short for them', async ($, on) => {
  const w = world($, on)
  await w.spawn('Loose.')
  for (const name of ['A', 'B', 'C']) await w.call('f1', 'click', { name })
  await w.end('f1', 'RESULT l: PASS')
  const lines = await pressed($, 'open:f1/steps', 5)
  expect([lines.some(isFoldRow), lines.filter(l => l.includes('✓ Click')).length]).toEqual([false, 3])
})

test('the older-finished row is a header row too: it takes one step row from a running tester', async ($, on) => {
  const w = world($, on)
  await w.spawn('Runs on.')
  for (let i = 0; i < 40; i++) await w.call('f1', 'click', { name: `S${i}` })
  const steps = async () => (await frameAt($, 60)).filter(l => l.includes('✓ Click')).length
  for (const i of [2, 3, 4]) { await w.spawn(`Done ${i}.`); await w.end(`f${i}`, 'RESULT r: PASS') }
  const three = await steps()
  await w.spawn('Done 5.')
  await w.end('f5', 'RESULT r: PASS')
  expect([(await frameAt($, 60))[2], await steps()]).toEqual(['m: ▸ 1 older finished', three - 1])
})

test('a finished block that folding makes no shorter stays whole in any pane', async ($, on) => {
  const w = world($, on)
  // One passed scenario beside a failed one: the row that counts it would take the rows it frees.
  await STATES['a finished FAIL']!(w)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 10 } } } as never)
  const lines = frame((await ui.drawn()) as Drawn, 60)
  await ui.unmount()
  expect([lines.some(isFoldRow), lines.at(-1)]).toEqual([false, '  + Count 0 saves ▸                                     PASS'])
})

test('the running share counts every header row, the one held for the keys row too: two testers draw 59 lines in a 61-row pane', async ($, on) => {
  const w = world($, on)
  for (const id of ['f1', 'f2']) {
    await w.spawn(`Run ${id}.`)
    for (let i = 0; i < 40; i++) await w.call(id, 'click', { name: `S${i}` })
    await w.hold(id, 'save')
  }
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 61 } } } as never)
  const lines = frame((await ui.drawn()) as Drawn, 60)
  await ui.unmount()
  // The status line and a row held for the keys row, drawn or not, then 29 rows each: an old share of 30 drew 62.
  expect(lines.length).toBe(59)
  await w.release()
})

test('giving the pane the keyboard never changes which testers fold: the keys row is held in both focus states', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next does its job.', 'Next')
  await busy(w, 'f2', 'Back does its job.', 'Back')
  const draw = async (cols: number, rows: number, isFocused: boolean) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused, bodyColumns: cols, scroll: { offset: 0, bodyRows: rows } } } as never)
    const f = frame((await ui.drawn()) as Drawn, cols)
    await ui.unmount()
    return f
  }
  const folded = (f: string[]) => f.some(l => /^\d: ▸/.test(l))
  const flips: string[] = []
  for (const cols of [40, 60]) for (let rows = 12; rows <= 40; rows += 1) if (folded(await draw(cols, rows, false)) !== folded(await draw(cols, rows, true))) flips.push(`${cols}x${rows}`)
  // 28 rows fold the second tester; with the keyboard the digits stay, and only the hint goes.
  const [off, onKeys] = [await draw(60, 28, false), await draw(60, 28, true)]
  await w.release()
  expect(flips).toEqual([])
  expect([folded(off), off[2], onKeys[2], onKeys[3]?.slice(0, 14)]).toEqual([true, 'ctrl+x tab to use keys', '', '2: ▸ ● RUNNING'])
})

// The lines that open a running tester's block or stand for it as one row, as drawn in a pane `rows` high, with
// the elapsed time left out.
const runRows = async ($: any, rows = 30) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } } as never)
  const lines = frame((await ui.drawn()) as Drawn, 60)
  await ui.unmount()
  return { n: lines.length, heads: lines.filter(l => /● RUNNING/.test(l)).map(l => l.replace(/  \d+s/, '').replace(/ {2,}(\d+ of)/, ' | $1')) }
}

test('with too few rows for every tester one shows in full, the first until a digit picks, and each other is one row', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next opens the second screen.', 'Next')
  await busy(w, 'f2', 'Back keeps what was typed.', 'Back')
  await busy(w, 'f3', 'Finish saves the record.', 'Finish')
  const ROW = ['', '2: ▸ ● RUNNING · 0 of 2 passed · Back keeps what was t…', '3: ▸ ● RUNNING · 0 of 2 passed · Finish saves the reco…']
  const FULL = ['1: ▾ ● RUNNING | 0 of 2 passed', '2: ▾ ● RUNNING | 0 of 2 passed', '3: ▾ ● RUNNING | 0 of 2 passed']
  // With no pick the first is the one in full; the pane is the three header rows, a blank row, two rows and its block.
  expect(await runRows($)).toEqual({ n: 3 + 1 + 2 + 15, heads: [ROW[1], ROW[2], FULL[0]] })
  // A step that begins on another tester changes nothing: the full block does not follow the last move.
  await w.clock.advance(1_000)
  await w.hold('f3', 'save')
  expect((await runRows($)).heads.map(l => l.slice(0, 14))).toEqual(['2: ▸ ● RUNNING', '3: ▸ ● RUNNING', '1: ▾ ● RUNNING'])
  const press = async (key: string) => { const ui = await $.ui.mount(PANE); await ui.press({ key }); await ui.unmount() }
  // A digit picks: f2 shows in full. The same digit again lets go, and the first shows in full again.
  await press('pick:f2')
  expect((await runRows($)).heads.map(l => l.slice(0, 14))).toEqual(['1: ▸ ● RUNNING', '3: ▸ ● RUNNING', '2: ▾ ● RUNNING'])
  await press('pick:f2')
  expect((await runRows($)).heads.map(l => l.slice(0, 14))).toEqual(['2: ▸ ● RUNNING', '3: ▸ ● RUNNING', '1: ▾ ● RUNNING'])
  // A tester keeps its digit when another ends: f3 stays 3, and a new tester takes the free 1.
  await press('pick:f3')
  await w.release()
  await w.end('f1', 'RESULT a: PASS')
  await busy(w, 'f4', 'Cancel closes the screen.', 'Cancel')
  expect((await runRows($)).heads.map(l => l.slice(0, 14))).toEqual(['2: ▸ ● RUNNING', '1: ▸ ● RUNNING', '3: ▾ ● RUNNING'])
  // A tester that goes on after its end takes the lowest free digit, not the one another tester now holds.
  await w.call('f1', 'open_record')
  expect((await runRows($)).heads.map(l => l.slice(0, 14))).toEqual(['4: ▸ ● RUNNING', '2: ▸ ● RUNNING', '1: ▸ ● RUNNING', '3: ▾ ● RUNNING'])
  // Once the picked tester ends, the first running one shows in full again.
  await w.end('f3', 'RESULT a: PASS')
  expect((await runRows($)).heads.map(l => l.slice(0, 14))).toEqual(['2: ▸ ● RUNNING', '1: ▸ ● RUNNING', '4: ▾ ● RUNNING'])
  await w.release()
})

test('two testers keep their blocks at 30 rows: short of 15 rows each, a block drops its bar and counts before one folds', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next opens the second screen.', 'Next')
  await busy(w, 'f2', 'Back keeps what was typed.', 'Back')
  const BAR = /^[▱▷▰✗]+$/
  const at = async (rows: number) => { const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } } as never); const l = frame((await ui.drawn()) as Drawn, 60); await ui.unmount(); return { n: l.length, bars: l.filter(x => BAR.test(x)).length, full: l.filter(x => /^(\d: ▾ )?● RUNNING/.test(x)).length, rows: l.filter(x => /^\d: ▸/.test(x)).length } }
  // Two header rows, a row held for the keys row, and two blocks of 15: whole from 33 rows.
  expect(await at(33)).toEqual({ n: 32, bars: 2, full: 2, rows: 0 })
  // From 29 to 32 rows each block is 13 rows, with no bar and no counts.
  expect(await at(32)).toEqual({ n: 28, bars: 0, full: 2, rows: 0 })
  expect(await at(29)).toEqual({ n: 28, bars: 0, full: 2, rows: 0 })
  // One row less folds one tester to a row, and the one in full has its bar back.
  expect(await at(28)).toEqual({ n: 3 + 15 + 2, bars: 1, full: 1, rows: 1 })
  await w.release()
})

test('a one-row tester shows its fail count, and its header while no step runs', async ($, on) => {
  const w = world($, on)
  await w.spawn('Count never goes below zero.')
  await w.call('f1', 'scenario', { ...plan([['Count -1 is blocked', 'negative'], ['Count 0 saves', 'positive']]), start: 'Count -1 is blocked' })
  await w.call('f1', 'scenario', { end: 'Count -1 is blocked', result: 'FAIL', reason: 'saved', start: 'Count 0 saves' })
  await w.spawn('Not started yet.')
  await w.clock.advance(5_000)
  await busy(w, 'f3', 'Finish saves the record.', 'Finish')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'pick:f3' })
  await ui.unmount()
  // The row is one line: with N of M the header would have under 20 columns, so N of M goes and the fail count stays.
  expect((await runRows($)).heads.slice(0, 2)).toEqual(['1: ▸ ● RUNNING · 1 FAIL · Count never goes below zero.', '2: ▸ ● RUNNING · Not started yet.'])
  // The step's mark blinks in a row as it does in Current Action.
  await w.hold('f1', 'save')
  await w.hold('f3', 'save')
  const marks: string[] = []
  // At 80 columns the row has room for its step.
  for (const _ of [0, 1]) { marks.push((await frameRC($, 80, 30)).find(l => l.startsWith('1: '))?.match(/· (.) Save$/)?.[1] ?? ''); await w.clock.advance(500) }
  expect(marks.sort()).toEqual([' ', '>'])
  await w.release()
})

// Three testers on a held step, with the blink flag stored false as a reload mid-blink leaves it: whether the running
// mark shows in a one-row tester and in Current Action, and how many times the blink timer was asked for.
const motion = async ($: any, on: any) => {
  let timers = 0
  let n = 0
  const gates: (() => void)[] = []
  on('clock.every', async () => { timers += 1; await new Promise<void>(r => gates.push(r)); return { value: undefined } })
  on('state.get', (_: unknown, e: unknown, next: (e: unknown) => unknown) => (JSON.stringify(e).includes('"blink"') ? { value: { value: false, version: 1 } } : next(e)))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `m${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', async (_: unknown, e: { hold?: boolean }) => { if (e.hold) await new Promise<void>(r => gates.push(r)); return { result: {}, text: '{"ok":true}' } })
  const open: Promise<unknown>[] = []
  for (const [id, button] of [['m1', 'Next'], ['m2', 'Back'], ['m3', 'Finish']] as const) {
    await $.agent.spawn({ prompt: `Requirement: ${button}.`, description: button, subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never)
    await $.tool.call({ tool: 'mcp__sf-tester__sf_scenario', tool_use_id: `${id}s`, agentId: id, ...plan([['One', 'positive'], ['Two', 'negative']]), start: 'One' } as never)
    open.push($.tool.call({ tool: 'mcp__sf-tester__sf_click', tool_use_id: `${id}c`, agentId: id, role: 'button', name: button, hold: true } as never))
  }
  let lines: string[] = []
  // The held calls draw their step a few ticks after they start.
  for (let i = 0; i < 50 && !lines.some(l => l.includes('"Finish" button')); i++) { await Promise.resolve(); lines = await frameAt($, 60) }
  const marks = [lines.find(l => l.startsWith('2: '))?.includes('· > Click the "Back"'), lines.includes(`│ > Click the "Next" button${' '.repeat(32)}│`)]
  gates.forEach(r => r())
  await Promise.all(open)
  return { timers, marks, row: lines.find(l => l.startsWith('2: ')) }
}

test('the running mark blinks on a half-second timer by default: unlit, a row and Current Action draw a space for it', async ($, on) => {
  expect(await motion($, on)).toEqual({ timers: 1, marks: [false, false], row: '2: ▸ ● RUNNING · 0 of 2 passed · Back. ·   Click the "Back"…' })
})

test('with the blink option off no timer starts and the running mark is always drawn', { options: { blink: false } }, async ($, on) => {
  expect(await motion($, on)).toEqual({ timers: 0, marks: [true, true], row: '2: ▸ ● RUNNING · 0 of 2 passed · Back. · > Click the "Back"…' })
})

// The header and each finished block's verdict, newest block first, with what marks a scenario as failed or unended.
const verdicts = async ($: any) => {
  const f = await frameAt($, 60)
  return [f[0] ?? '', ...f.filter(l => /^(STOPPED|PASS|FAIL|DONE|BLOCKED) ·|not finished|│ [+−] |│   \S/.test(l)).map(l => l.replace(/ +\d\d:\d\d.*$/, '').replace(/^[ │]+|[ │]+$/g, '').replace(/ {2,}/g, ' ~ '))]
}
const one = plan([['One', 'positive']])
const two = plan([['One', 'positive'], ['Two', 'positive']])

test('a scenario started and ended in one call ends: a FAIL with its reason drawn, a PASS as a PASS', async ($, on) => {
  const w = world($, on)
  await w.spawn('Fails.')
  await w.call('f1', 'scenario', { ...one, start: 'One', end: 'One', result: 'FAIL', reason: 'no such tab' })
  await w.end('f1', 'One failed: no such tab.')
  expect(await verdicts($)).toEqual(['Running 0 · Done 1 (0 PASS, 1 FAIL)', 'FAIL · 0 of 1 scenarios passed', '+ One ~ FAIL', 'no such tab'])
  await w.spawn('Passes.')
  await w.call('f2', 'scenario', { ...one, start: 'One', end: 'One', result: 'PASS' })
  await w.end('f2', 'All checked.')
  await w.spawn('Mixed.')
  await w.call('f3', 'scenario', { ...two, start: 'One', end: 'One', result: 'FAIL', reason: 'no such tab' })
  await w.call('f3', 'scenario', { start: 'Two' })
  await w.call('f3', 'scenario', { end: 'Two', result: 'PASS' })
  await w.end('f3', 'One failed.')
  const got = await verdicts($)
  expect(got[0]).toBe('Running 0 · Done 3 (1 PASS, 2 FAIL)')
  expect(got.filter(l => / · /.test(l)).slice(1, 3)).toEqual(['FAIL · 1 of 2 scenarios passed', 'PASS · 1 of 1 scenarios passed'])
  expect(got.some(l => /not finished/.test(l))).toBe(false)
})

// A turn that ends for the reason given: an answer, an abort, a refusal or an API error.
const turn = ($: any, id: string, reason: string, answer = '') => $.turn.complete({ agentId: id, answer, durationMs: 1, isAborted: reason === 'aborted', turnId: `t${id}${reason}`, reason } as never)
const passOne = async (w: World, id: string) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.call(id, 'scenario', { end: 'One', result: 'PASS' }) }

test('a turn that ends on an API error or a refusal is never a PASS, with every scenario passed', async ($, on) => {
  const w = world($, on)
  for (const [i, reason] of ['error', 'refusal', 'aborted'].entries()) {
    await w.spawn(`Ends on ${reason}.`)
    await passOne(w, `f${i + 1}`)
    await turn($, `f${i + 1}`, reason)
  }
  const got = await verdicts($)
  expect(got[0]).toBe('Running 0 · Done 3 (0 PASS, 0 FAIL, 3 STOPPED)')
  expect(got.slice(1).every(l => /^STOPPED ·/.test(l))).toBe(true)
  // A last line BLOCKED of a turn that did not answer does not wait either.
  await w.spawn('Cut question.')
  await turn($, 'f4', 'error', 'BLOCKED: which app?')
  expect((await verdicts($))[0]).toBe('Running 0 · Done 4 (0 PASS, 0 FAIL, 4 STOPPED)')
})

test('a run that had a result keeps it when a later turn with no sf-tester call does not answer', async ($, on) => {
  const w = world($, on)
  for (const [i, reason] of ['aborted', 'error'].entries()) {
    await w.spawn(`Passed, then ${reason}.`)
    await passOne(w, `f${i + 1}`)
    await w.end(`f${i + 1}`, 'All checked.')
    await w.clock.advance(60_000)
    await turn($, `f${i + 1}`, reason)
  }
  await w.spawn('Waiting, then aborted.')
  await w.end('f3', 'BLOCKED: which app?')
  await turn($, 'f3', 'aborted')
  const f = await frameAt($, 60)
  expect(f[0]).toBe('Running 0 · Done 2 (2 PASS, 0 FAIL) · 1 waiting')
  // The run keeps its own time too: the cut turn a minute later adds nothing.
  expect(f.filter(l => /^PASS · 1 of 1 scenarios passed .* · 0s · Clear$/.test(l)).length).toBe(2)
  expect(f.some(l => l === 'Question: which app?')).toBe(true)
  // A later turn that answers still gives the run its new verdict.
  await w.end('f1', 'One more thing.\nBLOCKED: which user?')
  expect((await frameAt($, 60))[0]).toBe('Running 0 · Done 1 (1 PASS, 0 FAIL) · 2 waiting')
})

test('a tester that answers with no scenario is DONE with its step count, counted as DONE; one that did not answer is STOPPED', async ($, on) => {
  const w = world($, on)
  await w.spawn('Read only.')
  await w.call('f1', 'click', { name: 'Go' })
  await w.end('f1', 'Checked, all good.')
  expect(await verdicts($)).toEqual(['Running 0 · Done 1 (0 PASS, 0 FAIL, 1 DONE)', 'DONE · 1 step'])
  const ui = await $.ui.mount(PANE)
  expect(((await ui.find({ type: 'Text', text: /^DONE/ })) as { props?: { color?: string } } | undefined)?.props?.color).toBe('subtle')
  await ui.unmount()
  await w.spawn('Cut.')
  await w.call('f2', 'click', { name: 'Go' })
  await turn($, 'f2', 'error')
  expect((await verdicts($))[0]).toBe('Running 0 · Done 2 (0 PASS, 0 FAIL, 1 STOPPED, 1 DONE)')
})

test('a failed scenario wins over a RESULT PASS line, and a RESULT line counts on a line of its own, never inside a sentence', async ($, on) => {
  const w = world($, on)
  await w.spawn('Says PASS.')
  await w.call('f1', 'scenario', { ...one, start: 'One' })
  await w.call('f1', 'scenario', { end: 'One', result: 'FAIL', reason: 'r' })
  await w.end('f1', 'RESULT entry/C1: PASS')
  await w.spawn('Quotes a line.')
  await passOne(w, 'f2')
  await w.end('f2', 'The page showed "RESULT code: FAIL" as the requirement asks. All checked.')
  await w.spawn('Quotes a line of its own.')
  await passOne(w, 'f3')
  await w.end('f3', 'The log held:\nRESULT code: FAIL\nAll checked.')
  expect((await verdicts($)).filter(l => / · /.test(l))).toEqual(['Running 0 · Done 3 (1 PASS, 2 FAIL)', 'FAIL · 1 of 1 scenarios passed', 'PASS · 1 of 1 scenarios passed', 'FAIL · 0 of 1 scenarios passed'])
  // The line gives the verdict bold or in a code fence; a PASS line with a scenario left unfinished is no PASS.
  for (const [i, answer] of ['Report.\n\n**RESULT entry/C2: PASS**', 'Report.\n```\nRESULT entry/C3: FAIL\n```'].entries()) {
    await w.spawn(`Last line ${i}.`)
    await w.call(`f${4 + i}`, 'scenario', { ...two, start: 'One' })
    await w.call(`f${4 + i}`, 'scenario', { end: 'One', result: 'PASS' })
    await w.end(`f${4 + i}`, answer)
  }
  expect((await verdicts($))[0]).toBe('Running 0 · Done 5 (1 PASS, 3 FAIL, 1 STOPPED)')
  // A turn that did not answer gets no PASS from the line.
  await w.spawn('Cut.')
  await turn($, 'f6', 'error', 'RESULT entry/C4: PASS')
  expect((await verdicts($))[0]).toBe('Running 0 · Done 6 (1 PASS, 3 FAIL, 2 STOPPED)')
})

test('a STOPPED verdict keeps its count, and a folded block shows its scenarios that did not finish', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next opens the second screen.', 'Next')
  await w.spawn('Six.')
  const six = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
  await w.call('f2', 'scenario', { ...plan(six.map(s => [s, 'positive'] as [string, 'positive'])), start: 'S1' })
  for (const [i, s] of six.slice(0, 5).entries()) await w.call('f2', 'scenario', { end: s, result: 'PASS', ...(i < 4 && { start: six[i + 1] }) })
  await w.end('f2', 'Could not test S6.')
  const f = await frameAt($, 60)
  expect(f.slice(f.findIndex(l => /^─/.test(l)))).toEqual([
    '────────────────────────────────────────',
    `STOPPED · 5 of 6 scenarios passed         ${AT} · 0s · Clear`,
    'Six.',
    '',
    '▸ 5 passed scenarios',
    '  + S6                                          not finished',
  ])
  // A turn that did not answer, with steps and no scenario, keeps its step count.
  await w.spawn('Cut.')
  await w.call('f3', 'click', { name: 'Go' })
  await turn($, 'f3', 'error')
  expect((await verdicts($))[1]).toBe('STOPPED · error · 1 step')
  await w.release()
})

test('a finished tester stored with NONE or with no result, as an older pane left it, draws as STOPPED', async ($, on) => {
  const old = (agentId: string, result?: 'NONE') => ({ agentId, label: agentId, feature: `Stored ${agentId}.`, isDone: true, steps: [], ...(result && { result }) })
  // What the code before this pass wrote stays through a reload: only the testers are seeded.
  ;(on as any)('state.get', (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => (e.key === 'testers' ? { value: { value: [old('o1', 'NONE'), old('o2')], version: 1 } } : next(e)))
  expect(await verdicts($)).toEqual(['Running 0 · Done 2 (0 PASS, 0 FAIL, 2 STOPPED)', 'STOPPED · 0 steps ~ Clear', 'STOPPED · 0 steps ~ Clear'])
})

test('a running tester with no digit takes one as soon as one is free, and no tester ever changes its digit', async ($, on) => {
  const w = world($, on)
  for (let i = 1; i <= 10; i += 1) { await w.spawn(`Feature ${i}.`); await w.hold(`f${i}`, 'click', { role: 'button', name: `B${i}` }) }
  const keys = async () => {
    const ui = await $.ui.mount(PANE)
    const got: string[] = []
    for (let i = 1; i <= 11; i += 1) got.push(((await ui.find({ key: `pick:f${i}` })) as { props?: { hotkey?: string } } | undefined)?.props?.hotkey ?? '-')
    await ui.unmount()
    return got.join('')
  }
  expect(await keys()).toBe('123456789--')
  // The first ends: the tenth takes its digit at once, and the nine others keep theirs.
  await w.end('f1', 'RESULT x: PASS')
  expect(await keys()).toBe('-234567891-')
  // An eleventh finds no digit free, and takes the next one that is.
  await w.spawn('Feature 11.')
  await w.hold('f11', 'click', { role: 'button', name: 'B11' })
  expect(await keys()).toBe('-234567891-')
  await w.end('f5', 'RESULT x: PASS')
  expect(await keys()).toBe('-234-678915')
  await w.release()
})

test('running testers an older pane stored with no digit get one when the session starts', async ($, on) => {
  const old = (agentId: string) => ({ agentId, label: agentId, feature: `Stored ${agentId}.`, isDone: false, steps: [] })
  let stored: unknown[] = [old('o1'), old('o2'), { ...old('o3'), isDone: true }]
  ;(on as any)('state.get', (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => (e.key === 'testers' ? { value: { value: stored, version: 1 } } : next(e)))
  ;(on as any)('state.set', (_: unknown, e: { key: string; value: unknown[] }, next: (e: unknown) => unknown) => { if (e.key !== 'testers') return next(e); stored = e.value; return { value: { version: 2 } } })
  ;(on as any)('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  ;(on as any)('command.register', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  expect((stored as Tester[]).map(t => t.digit)).toEqual([1, 2, undefined])
})

// A finished tester with one failed scenario of four steps and one passed one, under a named requirement.
const failing = async (w: World, id: string, feature: string, passes = 1) => {
  await w.spawn(feature)
  const rest = Array.from({ length: passes }, (_, i) => [`Count ${i} saves`, 'positive'] as [string, 'positive'])
  await w.call(id, 'scenario', { ...plan([['Count -1 is blocked', 'negative'], ...rest], 'Count'), start: 'Count -1 is blocked' })
  for (const n of ['A', 'B', 'C']) await w.call(id, 'click', { role: 'button', name: n })
  await w.call(id, 'wait', { text: 'Enter a Reason', fail: 'no text "Enter a Reason" in 10000 ms' })
  await w.call(id, 'scenario', { end: 'Count -1 is blocked', result: 'FAIL', reason: 'saved with Count -1' })
  for (const [s] of rest) { await w.call(id, 'scenario', { start: s }); await w.call(id, 'save'); await w.call(id, 'scenario', { end: s, result: 'PASS' }) }
  await w.end(id, 'One scenario failed.')
}
const asking = async (w: World, id: string) => { await w.spawn('Waiting.'); await w.end(id, 'No app named.\n\nBLOCKED: which app should I test in, Sales or Service?') }
// A running tester with one scenario, thirty steps done and one held.
const thirty = async (w: World, id: string) => {
  await w.spawn('Busy.')
  await w.call(id, 'scenario', { ...one, start: 'One' })
  for (let i = 0; i < 30; i += 1) await w.call(id, 'click', { role: 'button', name: `Step ${i}` })
  await w.hold(id, 'click', { role: 'button', name: 'Held' })
}
const WAITS: Record<string, (w: World) => Promise<void>> = {
  'older than a busy tester': async w => { await asking(w, 'f1'); await thirty(w, 'f2') },
  'newer than a busy tester': async w => { await thirty(w, 'f1'); await asking(w, 'f2') },
  'older than three failed runs': async w => { await asking(w, 'f1'); for (const id of ['f2', 'f3', 'f4']) await failing(w, id, `Feature ${id}.`) },
}
for (const [name, build] of Object.entries(WAITS)) {
  test(`a waiting tester's question is drawn first and stays in the pane's rows: ${name}`, async ($, on) => {
    const w = world($, on)
    await build(w)
    for (const cols of [60, 40]) {
      const f = await frameAt($, cols)
      const at = (re: RegExp) => f.findIndex(l => re.test(l))
      // The block follows the header: a blank row, the rule, the verdict, the feature, the question.
      expect([at(/^BLOCKED ·/) - at(/^─/), at(/^Waiting\.$/) - at(/^─/), at(/^Question: /) - at(/^─/)]).toEqual([1, 2, 3])
      expect(at(/^─/)).toBeLessThanOrEqual(6)
      expect(f.slice(at(/^Question: /)).findIndex(l => /RUNNING|^(FAIL|PASS) ·/.test(l))).toBeGreaterThan(name.includes('failed') ? 0 : 1)
      // The running tester's steps give up the rows: the frame is the pane's 30 rows or fewer.
      if (!name.includes('failed')) expect(f.length).toBeLessThanOrEqual(30)
    }
    await w.release()
  })
}

const keys = (d: Drawn, into: string[] = []): string[] => {
  if (d.type === 'Button') into.push(String((d.props as any)?.key ?? (d as any).key ?? '?'))
  for (const k of d.children ?? []) if (k && typeof k === 'object') keys(k as Drawn, into)
  return into
}
test('a folded block pressed open draws one requirement list, the scenarios that did not pass first, and no key twice', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next opens the second screen.', 'Next')
  await failing(w, 'f2', 'Count never goes below zero.', 3)
  const block = (f: string[]) => f.slice(f.findIndex(l => /^─/.test(l)) + 3).map(l => l.trim().replace(/^│ | │$/g, '').replace(/ {2,}/g, ' ~ ').replace(/ [▸▾]( ~|$)/, '$1')).filter(l => /^(Requirement|[▸▾]|[+−] )/.test(l))
  expect(block(await frameAt($, 60))).toEqual(['▸ 3 passed scenarios', 'Requirement: Count', '− Count -1 is blocked ~ FAIL'])
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'open:f2/all' })
  const drawn = keys((await ui.drawn()) as Drawn)
  expect(drawn.filter((k, i) => drawn.indexOf(k) !== i)).toEqual([])
  // The requirement's own press still works: it opens the steps of its scenarios.
  await ui.press({ key: 'open:f2|Count' })
  await ui.unmount()
  const open = block(await frameAt($, 60))
  expect(open).toEqual(['▾ 3 passed scenarios', 'Requirement: Count', '− Count -1 is blocked ~ FAIL', '+ Count 0 saves ~ PASS', '+ Count 1 saves ~ PASS', '+ Count 2 saves ~ PASS'])
  await w.release()
})

test('the keys row comes after the Scenarios line, so a change of focus moves no status row', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next opens the second screen.', 'Next')
  await busy(w, 'f2', 'Back keeps what was typed.', 'Back')
  await busy(w, 'f3', 'Finish saves the record.', 'Finish')
  const head = async (isFocused: boolean) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused } } as never)
    const f = frame((await ui.drawn()) as Drawn, 60)
    await ui.unmount()
    return f.slice(0, 3)
  }
  expect(await head(false)).toEqual(['Running 3 · Done 0 (0 PASS, 0 FAIL)', 'Scenarios 0 PASS · 0 FAIL · 3 RUNNING · 3 to run', 'ctrl+x tab to use keys'])
  expect((await head(true)).slice(0, 2)).toEqual(['Running 3 · Done 0 (0 PASS, 0 FAIL)', 'Scenarios 0 PASS · 0 FAIL · 3 RUNNING · 3 to run'])
  // The older row follows the keys row.
  for (const id of ['f4', 'f5', 'f6', 'f7']) { await w.spawn(`Done ${id}.`); await w.end(id, 'RESULT a: PASS') }
  expect((await frameAt($, 60)).slice(1, 4)).toEqual(['Scenarios 0 PASS · 0 FAIL · 3 RUNNING · 3 to run', 'c: Clear · ctrl+x tab to use keys', 'm: ▸ 1 older finished'])
  await w.release()
})

test('a one-row tester names its feature before its step and never loses its fail count, and the rows sit between two blank rows, above the block in full', async ($, on) => {
  const w = world($, on)
  await thirty(w, 'f1')
  await w.spawn('Back keeps what was typed.')
  await w.call('f2', 'scenario', { ...plan(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(t => [t, 'positive'] as [string, 'positive'])), start: 'A' })
  await w.call('f2', 'scenario', { end: 'A', result: 'FAIL', reason: 'r', start: 'B' })
  await w.clock.advance(65_000)
  await w.hold('f2', 'click', { role: 'button', name: 'Back' })
  await busy(w, 'f3', 'Finish saves the record.', 'Finish')
  const rows = async (cols: number) => { const f = await frameAt($, cols); return f.filter(l => /^\d: ▸/.test(l)) }
  // N of M shows while the feature keeps 20 columns beside it, the step while it keeps 8 beside those 20, and the
  // feature takes the rest. The fail count and the time stay.
  expect(await rows(100)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · 0 of 10 passed · Back keeps what was typed. · > Click the "Back" …', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the record. · > Click the "Finish" button'])
  expect(await rows(84)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · 0 of 10 passed · Back keeps what was… · > Click t…', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the record. · > Click the "Finis…'])
  expect(await rows(83)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · 0 of 10 passed · Back keeps what was typed.', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the record. · > Click the "Fini…'])
  expect(await rows(76)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · 0 of 10 passed · Back keeps what was type…', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the record. · > Click th…'])
  expect(await rows(71)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · 0 of 10 passed · Back keeps what was…', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the re… · > Click t…'])
  expect(await rows(70)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · Back keeps what was ty… · > Click t…', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the record.'])
  expect(await rows(60)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · Back keeps what was typed.', '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish saves the reco…'])
  expect(await rows(40)).toEqual(['2: ▸ ● RUNNING · 1 FAIL  1m 17s · Back …', '3: ▸ ● RUNNING  12s · Finish saves the …'])
  for (const cols of [36, 30, 24]) expect((await rows(cols))[0]!.startsWith('2: ▸ ● RUNNING · 1 FAIL')).toBe(true)
  // One blank row under the header, the rows with none between them, one blank row, then the block in full. The
  // block's steps give up the rows: the frame is the pane's 30.
  const f = await frameAt($, 60)
  expect([f[3], f[4]?.slice(0, 5), f[5]?.slice(0, 5), f[6], f[7]?.slice(0, 5), f.length]).toEqual(['', '2: ▸ ', '3: ▸ ', '', '1: ▾ ', 30])
  // Picked, the middle tester is the one in full: the two others are the rows above it.
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'pick:f2' })
  await ui.unmount()
  const g = await frameAt($, 60)
  expect([g[3], g[4]?.slice(0, 5), g[5]?.slice(0, 5), g[6], g[7]?.slice(0, 5)]).toEqual(['', '1: ▸ ', '3: ▸ ', '', '2: ▾ '])
  await w.release()
})

test('the blank row above the one-row testers is counted: a finished block under them is whole only once it fits', async ($, on) => {
  const w = world($, on)
  await busy(w, 'f1', 'Next opens the second screen.', 'Next')
  await busy(w, 'f2', 'Back keeps what was typed.', 'Back')
  await busy(w, 'f3', 'Finish saves the record.', 'Finish')
  await failing(w, 'f4', 'Count never goes below zero.', 3)
  const at = async (rows: number) => { const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } } as never); const l = frame((await ui.drawn()) as Drawn, 60); await ui.unmount(); return l }
  // The first pane height at which the finished block is drawn whole holds the whole frame.
  let rows = 30
  while (rows < 80 && (await at(rows)).some(l => l.includes('passed scenarios'))) rows += 1
  expect([rows > 30, rows < 80, (await at(rows)).length]).toEqual([true, true, rows])
  await w.release()
})

test('a long persona never takes the title\'s room: 16 columns at most, dropped under 8, and whole under the title of a row pressed open', async ($, on) => {
  const w = world($, on)
  const persona = 'qa.sales.rep@acme-corp.example.com'
  await w.spawn('Closing a case needs a Reason.')
  await w.call('f1', 'scenario', { plan: [{ title: 'A case with a Reason closes', kind: 'positive', persona }, { title: 'Blank', kind: 'negative', persona }], start: 'A case with a Reason closes' })
  await w.call('f1', 'click', { role: 'button', name: 'Save' })
  const rows = async (cols: number) => (await frameAt($, cols)).filter(l => /^  [+−] /.test(l))
  // At 60 the title is whole and the persona has its cap of 16; a short title leaves it no more than that.
  expect(await rows(60)).toEqual(['  + A case with a Reason closes    qa.sales.rep@ac…  RUNNING', '  − Blank                           qa.sales.rep@ac…  to run'])
  // The persona is cut before the title loses a column, down to 8 columns; with less room it is dropped.
  expect((await rows(51))[0]).toBe('  + A case with a Reason closes   qa.sale…  RUNNING')
  expect((await rows(50))[0]).toBe('  + A case with a Reason closes            RUNNING')
  expect(await rows(40)).toEqual(['  + A case with a Reason closes  RUNNING', '  − Blank       qa.sales.rep@ac…  to run'])
  // Pressed open at 40 the persona is whole on a row of its own, and the title keeps the row.
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 } } as never)
  await ui.press({ key: 'open:f1||A case with a Reason closes' })
  await ui.unmount()
  const open = await frameAt($, 40)
  const at = open.indexOf('  + A case with a Reason closes  RUNNING')
  expect([at > 0, open[at + 1]]).toEqual([true, `    ${persona}`])
  // The row budget measures the persona as drawn: with more steps than rows, the frame is the pane's 30 rows.
  for (let i = 0; i < 30; i += 1) await w.call('f1', 'click', { role: 'button', name: `S${i}` })
  await w.hold('f1', 'save')
  expect((await frameAt($, 40)).length).toBe(30)
  // The persona's own row is counted: no height from 26 to 34 rows draws past the pane.
  const over: number[] = []
  for (let rows = 26; rows <= 34; rows += 1) if ((await frameRC($, 40, rows)).length > rows) over.push(rows)
  expect(over).toEqual([])
  await w.release()
})

test('an arrow tells the truth: none when a press opens no steps, open when the steps under it already show', async ($, on) => {
  const w = world($, on)
  const req = async () => (await frameAt($, 60)).filter(l => /^Requirement|^  [+−] /.test(l)).map(l => l.trim().replace(/ {2,}/g, ' ~ '))
  await w.spawn('Closing a case needs a Reason.')
  await w.call('f1', 'scenario', { ...plan([['One', 'positive'], ['Two', 'positive']], 'Close'), start: 'One' })
  // Two scenarios with no step that folds: a press on the requirement opens nothing, so it has no arrow.
  expect(await req()).toEqual(['Requirement: Close', '+ One ~ RUNNING', '+ Two ~ to run'])
  await w.call('f1', 'save')
  await w.call('f1', 'scenario', { end: 'One', result: 'PASS', start: 'Two' })
  // One has a step to open now: closed arrows on it and on its requirement.
  expect(await req()).toEqual(['Requirement: Close ▸', '+ One ▸ ~ PASS', '+ Two ~ RUNNING'])
  const press = async (key: string) => { const ui = await $.ui.mount(PANE); await ui.press({ key }); await ui.unmount() }
  // Opened by its own press, the scenario is the only one that folds, so the requirement reads open too.
  await press('open:f1|Close|One')
  expect(await req()).toEqual(['Requirement: Close ▾', '+ One ▾ ~ PASS', '+ Two ~ RUNNING'])
  await press('open:f1|Close|One')
  // Opened by the requirement's press, the scenario's own arrow follows.
  await press('open:f1|Close')
  expect(await req()).toEqual(['Requirement: Close ▾', '+ One ▾ ~ PASS', '+ Two ~ RUNNING'])
  await w.release()
})

test('a press on a requirement always shows: it opens every scenario, and on an open arrow it closes them, each one opened by itself too', async ($, on) => {
  const w = world($, on)
  const req = async () => (await frameAt($, 60)).filter(l => /^Requirement|^  [+−] |✓ Save/.test(l)).map(l => l.trim().replace(/ {2,}/g, ' ~ '))
  const press = async (key: string) => { const ui = await $.ui.mount(PANE); await ui.press({ key }); await ui.unmount() }
  await w.spawn('Closing a case needs a Reason.')
  await w.call('f1', 'scenario', { ...plan([['One', 'positive'], ['Two', 'positive'], ['Three', 'positive']], 'Close'), start: 'One' })
  await w.call('f1', 'save')
  await w.call('f1', 'scenario', { end: 'One', result: 'PASS', start: 'Two' })
  await w.call('f1', 'save')
  await w.call('f1', 'scenario', { end: 'Two', result: 'PASS', start: 'Three' })
  const SHUT = ['Requirement: Close ▸', '+ One ▸ ~ PASS', '+ Two ▸ ~ PASS', '+ Three ~ RUNNING']
  const OPEN = ['Requirement: Close ▾', '+ One ▾ ~ PASS', '✓ Save ~ explore 0.0s', '+ Two ▾ ~ PASS', '✓ Save ~ explore 0.0s', '+ Three ~ RUNNING']
  // One of two scenarios opened by itself: the requirement still reads closed, and its press opens the other.
  await press('open:f1|Close|One')
  expect(await req()).toEqual(['Requirement: Close ▸', '+ One ▾ ~ PASS', '✓ Save ~ explore 0.0s', '+ Two ▸ ~ PASS', '+ Three ~ RUNNING'])
  await press('open:f1|Close')
  expect(await req()).toEqual(OPEN)
  // The open arrow closes all, the scenario's own press with it.
  await press('open:f1|Close')
  expect(await req()).toEqual(SHUT)
  // Each scenario opened by itself: the requirement reads open, and its press closes both.
  await press('open:f1|Close|One')
  await press('open:f1|Close|Two')
  expect(await req()).toEqual(OPEN)
  await press('open:f1|Close')
  expect(await req()).toEqual(SHUT)
  await w.release()
})

test('a failed scenario keeps its failed step and the error in view in a pane short of rows', async ($, on) => {
  const w = world($, on)
  await STATES['a run in progress with one failed scenario']!(w)
  const f = await frameAt($, 40)
  const box = f.slice(f.findIndex(l => l.startsWith('  ╭')), f.findIndex(l => l.startsWith('  ╰')) + 1)
  expect(box).toEqual([
    '  ╭────────────────────────────────────╮',
    '  │ − A blank Reason is refused … FAIL │',
    '  │   ✓ Save              explore 0.0s │',
    '  │   ✗ Wait for "Enter … explore 0.0s │',
    '  │     TIMEOUT: no text "Enter a      │',
    '  │     Reason" in 10000 ms            │',
    '  │   the case saved with no Reason    │',
    '  ╰────────────────────────────────────╯',
  ])
  await w.release()
})

test('a scenario still running does not hold its failed step in view: the steps after it keep to the pane\'s rows', async ($, on) => {
  const w = world($, on)
  await w.spawn('Busy.')
  await w.call('f1', 'scenario', { ...one, start: 'One' })
  await w.call('f1', 'wait', { text: 'Saved', fail: 'no text "Saved" in 10000 ms' })
  for (let i = 0; i < 30; i += 1) await w.call('f1', 'click', { role: 'button', name: `Step ${i}` })
  await w.hold('f1', 'click', { role: 'button', name: 'Held' })
  const f = await frameAt($, 60)
  expect([f.length <= 30, f.some(l => l.includes('✗ Wait for')), f.some(l => l.includes('earlier steps'))]).toEqual([true, false, true])
  await w.release()
})

// The frame at a width and a height, and the pane heights in a range where the frame is taller than the pane
// though no finished block is folded.
const frameRC = async ($: any, bodyColumns: number, bodyRows: number) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } } } as never)
  const lines = frame((await ui.drawn()) as Drawn, bodyColumns)
  await ui.unmount()
  return lines
}
const tooTall = async ($: any, cols: number, from: number, to: number) => {
  const out: number[] = []
  for (let r = from; r <= to; r += 1) { const f = await frameRC($, cols, r); if (f.length > r && !f.some(l => l.includes('passed scenarios'))) out.push(r) }
  return out
}

// A failed scenario with `before` steps ahead of its failed step, then a running scenario with 30 steps and a held one.
const failedThenBusy = async (w: World, id: string, before: number) => {
  await w.spawn('Count never goes below zero.')
  await w.call(id, 'scenario', { ...plan([['Count -1 is blocked', 'negative'], ['Count 0 saves', 'positive']], 'Count'), start: 'Count -1 is blocked' })
  for (let i = 0; i < before; i += 1) await w.call(id, 'click', { role: 'button', name: `Early ${i}` })
  await w.call(id, 'wait', { text: 'Enter a Reason', fail: 'no text "Enter a Reason" in 10000 ms' })
  await w.call(id, 'scenario', { end: 'Count -1 is blocked', result: 'FAIL', reason: 'saved with Count -1', start: 'Count 0 saves' })
  for (let i = 0; i < 30; i += 1) await w.call(id, 'click', { role: 'button', name: `Step ${i}` })
  await w.hold(id, 'click', { role: 'button', name: 'Held' })
}
// The bar and the counts row of a running block, and the lines that hold a text.
const barAndCounts = (f: string[]) => [f.some(l => /^[▰✗▷▱]+$/.test(l)), f.some(l => / positive · \d+ negative$/.test(l))]
const has = (f: string[], text: string) => f.some(l => l.includes(text))

test('a lone tester short of rows for its failed step and Current Action drops its bar and counts, and both stay whole', async ($, on) => {
  const w = world($, on)
  await STATES['a run in progress with one failed scenario']!(w)
  const wide = await frameRC($, 60, 30)
  const narrow = await frameRC($, 40, 30)
  await w.release()
  // At 60 columns the block fits with its bar; at 40 the Current Action box wraps to two more rows and the bar goes.
  expect([...barAndCounts(wide), wide.length]).toEqual([true, true, 29])
  expect(barAndCounts(narrow)).toEqual([false, false])
  // With the Scenarios line on one row the frame is the pane's 30 rows.
  expect(narrow.length).toBe(30)
  expect([has(narrow, '✗ Wait for "Enter'), has(narrow, 'Reason" in 10000 ms'), has(narrow, '│ notified"'), narrow.at(-1)]).toEqual([true, true, true, `╰${'─'.repeat(38)}╯`])
})

test('a failed scenario with steps before its failed step keeps to the rows: its earlier-steps line is counted, and the bar goes before the failed step', async ($, on) => {
  const w = world($, on)
  await failedThenBusy(w, 'f1', 7)
  const sizes = [[60, 30], [60, 40], [40, 30], [40, 40], [30, 30], [40, 25], [40, 24], [40, 23]] as const
  const frames: string[][] = []
  for (const [cols, rows] of sizes) frames.push(await frameRC($, cols, rows))
  await w.release()
  expect(frames.map(f => f.length)).toEqual(sizes.map(([, rows]) => rows))
  // 25 rows hold the bar; 24 and 23 do not, and at 23 the box holds its line, the failed step and no step before it.
  expect(frames.slice(5).map(f => barAndCounts(f)[0])).toEqual([true, false, false])
  expect(frames.map(f => [has(f, '▸ 7 earlier steps'), has(f, '✗ Wait f'), has(f, '> Click the "Held" button')].every(Boolean))).toEqual(sizes.map(() => true))
})

test('two testers stay in full only while each share holds a failed step and its lines: no height draws past the pane', async ($, on) => {
  const w = world($, on)
  await failedThenBusy(w, 'f1', 2)
  await busy(w, 'f2', 'Back keeps what was typed.', 'Back')
  const over: number[] = []
  const folds: number[] = []
  for (let rows = 30; rows <= 50; rows += 1) {
    const f = await frameRC($, 60, rows)
    if (f.length > rows) over.push(rows)
    if (f.some(l => /^\d: ▸/.test(l))) folds.push(rows)
  }
  await w.release()
  expect([over, folds.at(-1)]).toEqual([[], 42])
})

test('the row budget counts an unended scenario as it is drawn, with not finished', async ($, on) => {
  const w = world($, on)
  await failing(w, 'f1', 'Older.', 2)
  await w.spawn('Newer.')
  const long = 'The owner gets the email after the case close'
  await w.call('f2', 'scenario', { ...plan([[long, 'positive'], ['Two', 'positive']]), start: long })
  await w.call('f2', 'save')
  await w.end('f2', 'Out of turns.')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: `open:f2||${long}` })
  await ui.unmount()
  expect(await tooTall($, 60, 12, 50)).toEqual([])
  await w.release()
})

test('the errors row is one row in a narrow pane, as the budget counts it', async ($, on) => {
  const w = world($, on)
  await w.spawn('Busy.')
  for (let i = 0; i < 30; i += 1) await w.call('f1', 'click', { role: 'button', name: `S${i}` })
  await w.call('f1', 'page_errors', { reply: '{"errors":[{"m":1},{"m":2},{"m":3}]}' })
  await w.hold('f1', 'click', { role: 'button', name: 'H' })
  const f = await frameRC($, 20, 30)
  expect([f.length <= 30, f.filter(l => /errors/.test(l))]).toEqual([true, ['  errors 3 on the p…']])
  await w.release()
})

test('a verdict that wraps is counted by its rows, and finished rows drop the same parts of the time at one width', async ($, on) => {
  const w = world($, on)
  await failing(w, 'f1', 'Older.', 2)
  await failing(w, 'f2', 'Newer.', 1)
  expect(await tooTall($, 30, 12, 60)).toEqual([])
  // A short verdict beside a long one: neither keeps a part of the time the other had to drop.
  await w.spawn('Read only.')
  await w.call('f3', 'click', { name: 'Go' })
  await w.end('f3', 'Checked.')
  const rows = async (cols: number) => (await frameRC($, cols, 80)).filter(l => /^(FAIL|DONE) ·/.test(l)).map(l => l.replace(/ {2,}/g, ' ~ '))
  expect(await rows(60)).toEqual([`DONE · 1 step ~ ${AT} · 0s · Clear`, `FAIL · 1 of 2 scenarios passed ~ ${AT} · 0s · Clear`, `FAIL · 2 of 3 scenarios passed ~ ${AT} · 0s · Clear`])
  expect(await rows(40)).toEqual(['DONE · 1 step ~ Clear', 'FAIL · 1 of 2 scenarios passed ~ Clear', 'FAIL · 2 of 3 scenarios passed ~ Clear'])
  await w.release()
})

test('the scenario bar scales to the width when scenarios outnumber its cells, and a failed one is always drawn', async ($, on) => {
  const w = world($, on)
  await w.spawn('Many.')
  const titles = Array.from({ length: 45 }, (_, i) => [`S${i}`, 'positive'] as [string, 'positive'])
  await w.call('f1', 'scenario', { ...plan(titles), start: 'S44' })
  await w.call('f1', 'scenario', { end: 'S44', result: 'FAIL', reason: 'r', start: 'S0' })
  await w.call('f1', 'scenario', { end: 'S0', result: 'PASS', start: 'S1' })
  const bar = async (cols: number) => (await frameRC($, cols, 200)).find(l => /^[▱▷▰✗…]+$/.test(l))
  // 45 scenarios in the bar's 40 cells: no cell is cut off, and the failed last one shows.
  expect(await bar(40)).toBe(`▰▷${'▱'.repeat(37)}✗`)
  expect(await bar(60)).toBe(`▰▷${'▱'.repeat(37)}✗`)
  // In 20 cells the first holds a passed and a running one and shows the running one.
  expect(await bar(20)).toBe(`▷${'▱'.repeat(18)}✗`)
  await w.release()
})

test('a status line too wide for its row puts its counts on a row of their own, with no bracket to wrap', async ($, on) => {
  const w = world($, on)
  await STATES['a finished tester with no result line']!(w)
  expect((await frameAt($, 60))[0]).toBe('Running 0 · Done 1 (0 PASS, 0 FAIL, 1 STOPPED)')
  expect((await frameAt($, 40)).slice(0, 3)).toEqual(['Running 0 · Done 1', '0 PASS · 0 FAIL · 1 STOPPED', 'c: Clear · ctrl+x tab to use keys'])
  await w.spawn('Waiting.')
  await w.end('f2', 'BLOCKED: which app?')
  expect((await frameAt($, 40)).slice(0, 2)).toEqual(['Running 0 · Done 1 · 1 waiting', '0 PASS · 0 FAIL · 1 STOPPED'])
  // The two rows are counted: a 30-row pane still holds the frame.
  expect((await frameAt($, 40)).length).toBeLessThanOrEqual(30)
  await w.release()
})

test('a pane whose only control is a Dismiss tells a keyboard user how to reach it, until the pane has the keyboard', async ($, on) => {
  const w = world($, on)
  await asking(w, 'f1')
  const head = async (props: object) => { const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, ...props } } as never); const f = frame((await ui.drawn()) as Drawn, 60); await ui.unmount(); return f.slice(0, 2) }
  expect(await head({})).toEqual(['Running 0 · Done 0 (0 PASS, 0 FAIL) · 1 waiting', 'ctrl+x tab, then tab to Dismiss'])
  expect(await head({ isFocused: true })).toEqual(['Running 0 · Done 0 (0 PASS, 0 FAIL) · 1 waiting', ''])
  // With a key of its own in the pane, the hint is the one for keys.
  await w.spawn('Done.')
  await w.end('f2', 'RESULT a: PASS')
  expect((await head({}))[1]).toBe('c: Clear · ctrl+x tab to use keys')
  // A lone running tester has no control at all, and no hint.
  const ui = await $.ui.mount(PANE)
  for (const key of ['hide:f1', 'hide:f2']) await ui.press({ key })
  await ui.unmount()
  await w.spawn('Only running.')
  expect(await frameAt($, 60)).toEqual(['Running 1 · Done 0 (0 PASS, 0 FAIL)', '', '● RUNNING  0s', 'Only running.'])
  await w.release()
})

test('the RUNNING row of a block keeps its time and its fail count: a narrow row drops the word passed, then the count', async ($, on) => {
  const w = world($, on)
  await STATES['a run in progress with one failed scenario']!(w)
  const head = async (cols: number) => (await frameRC($, cols, 30)).find(l => l.includes('● RUNN'))
  const lone: (string | undefined)[] = []
  for (const cols of [40, 37, 36, 30, 29, 21]) lone.push(await head(cols))
  expect(lone).toEqual([
    '● RUNNING  41s    1 of 3 passed · 1 FAIL',
    '● RUNNING  41s 1 of 3 passed · 1 FAIL',
    '● RUNNING  41s       1 of 3 · 1 FAIL',
    '● RUNNING  41s 1 of 3 · 1 FAIL',
    '● RUNNING  41s         1 FAIL',
    '● RUNNING  41s 1 FAIL',
  ])
  // With a digit and the mark of the block in full before it, the same steps come five columns sooner.
  await busy(w, 'f2', 'Back.', 'Back')
  await busy(w, 'f3', 'Finish.', 'Finish')
  const full = async (cols: number) => (await frameRC($, cols, 30)).find(l => l.includes('▾ ● RUNN'))
  expect([await full(44), await full(43), await full(37), await full(36)]).toEqual([
    '1: ▾ ● RUNNING  1m 5s 1 of 3 passed · 1 FAIL',
    '1: ▾ ● RUNNING  1m 5s       1 of 3 · 1 FAIL',
    '1: ▾ ● RUNNING  1m 5s 1 of 3 · 1 FAIL',
    '1: ▾ ● RUNNING  1m 5s         1 FAIL',
  ])
  await w.release()
})

test('the counts beside RUNNING and on the Scenarios line use the block\'s words: passed, and a running scenario is not to run', async ($, on) => {
  const w = world($, on)
  await STATES['a run in progress with one failed scenario']!(w)
  const f = await frameAt($, 60)
  // One passed, one failed, one under way: the block says RUNNING for it, so the header does too.
  expect([f[1], f[3]]).toEqual(['Scenarios 1 PASS · 1 FAIL · 1 RUNNING', '● RUNNING  41s                        1 of 3 passed · 1 FAIL'])
  await w.release()
  // None is left to run: the line says so by leaving the count out, as it does for RUNNING.
  await w.call('f1', 'scenario', { end: 'The owner gets the email', result: 'PASS' })
  expect((await frameAt($, 60))[1]).toBe('Scenarios 2 PASS · 1 FAIL')
})

test('a requirement named as one of the pane\'s own toggles shares no key with it', async ($, on) => {
  const w = world($, on)
  await w.spawn('A long feature header that is cut at sixty columns because it runs on and on.')
  await w.call('f1', 'scenario', { ...plan([['One', 'positive']], 'title'), start: 'One' })
  await w.call('f1', 'save', { toast: 'Saved' })
  await w.call('f1', 'scenario', { end: 'One', result: 'PASS' })
  for (const name of ['seen', 'all', 'steps']) {
    await w.call('f1', 'scenario', { ...plan([[`In ${name}`, 'positive']], name), start: `In ${name}` })
    await w.call('f1', 'scenario', { end: `In ${name}`, result: 'PASS' })
  }
  const ui = await $.ui.mount(PANE)
  const drawn = keys((await ui.drawn()) as Drawn)
  expect(drawn.filter((k, i) => drawn.indexOf(k) !== i)).toEqual([])
  // The requirement's key opens the requirement, and the header's own key the header.
  await ui.press({ key: 'open:f1|title' })
  await ui.unmount()
  const f = await frameAt($, 60)
  expect([f.some(l => l.startsWith('Requirement: title ▾')), f.some(l => l.includes('✓ Save')), f.some(l => l.startsWith('A long feature') && l.endsWith('…'))]).toEqual([true, true, true])
  const again = await $.ui.mount(PANE)
  await again.press({ key: 'open:f1/title' })
  await again.unmount()
  expect((await frameAt($, 60)).some(l => l === 'A long feature header that is cut at sixty columns because')).toBe(true)
  await w.release()
})

// 300 spawns on a mocked clock take about 2 s, and more on a busy machine: the default 5 s is too short.
test('a tester that leaves at the cap takes its open toggles with it, the pane\'s own too', { timeoutMs: 30_000 }, async ($, on) => {
  let stored: unknown
  ;(on as any)('state.set', (_: unknown, e: { key: string; value: unknown }, next: (e: unknown) => unknown) => { if (e.key === 'open') stored = e.value; return next(e) })
  const w = world($, on)
  await failing(w, 'f1', 'Leaves first.', 1)
  const ui = await $.ui.mount(PANE)
  for (const key of ['open:f1/title', 'open:f1|Count']) await ui.press({ key })
  await ui.unmount()
  expect(stored).toEqual(['f1/title', 'f1|Count'])
  // 300 more testers: the oldest finished one leaves, and no key of it stays.
  for (let i = 0; i < 300; i += 1) await w.spawn(`Run ${i}.`)
  expect(stored).toEqual([])
})

test('the rows of a kept failed step come out of the running scenario\'s steps, so the frame keeps to the pane', async ($, on) => {
  const w = world($, on)
  await w.spawn('Busy.')
  await w.call('f1', 'scenario', { ...plan([['One', 'positive'], ['Two', 'positive']]), start: 'One' })
  await w.call('f1', 'save')
  await w.call('f1', 'wait', { text: 'Saved', fail: 'no text "Saved" in 10000 ms' })
  await w.call('f1', 'scenario', { end: 'One', result: 'FAIL', reason: 'not saved', start: 'Two' })
  for (let i = 0; i < 30; i += 1) await w.call('f1', 'click', { role: 'button', name: `Step ${i}` })
  await w.hold('f1', 'click', { role: 'button', name: 'Held' })
  const f = await frameAt($, 60)
  expect([f.length, f.some(l => l.includes('✗ Wait for "Saved"')), f.some(l => l.includes('TIMEOUT: no text "Saved"'))]).toEqual([30, true, true])
  await w.release()
})

test('a failed scenario that is the first list served keeps its failed step in a pane too short for it', async ($, on) => {
  const w = world($, on)
  await w.spawn('Between scenarios.')
  await w.call('f1', 'scenario', { ...plan([['One', 'positive'], ['Two', 'positive']]), start: 'One' })
  for (const n of ['A', 'B', 'C']) await w.call('f1', 'click', { role: 'button', name: n })
  await w.call('f1', 'wait', { text: 'Saved', fail: 'no text "Saved" in 10000 ms' })
  // One has failed and Two has not started: no scenario runs, so the failed one is the first list served.
  await w.call('f1', 'scenario', { end: 'One', result: 'FAIL', reason: 'not saved' })
  const f = await frameRC($, 60, 14)
  expect([f.some(l => l.includes('✗ Wait for "Saved"')), f.some(l => l.includes('TIMEOUT: no text "Saved"')), f.some(l => l.includes('earlier steps'))]).toEqual([true, true, true])
  await w.release()
})

// ---- The table of endings: state in, verdict out. Each word is a result; ? marks a question kept with it. ----
const SC: Record<string, string[]> = {
  'none called': [],
  'all PASS': ['PASS'],
  'one FAIL, all ended': ['FAIL', 'PASS'],
  'one FAIL, one planned': ['FAIL', 'pending'],
  'one running': ['running'],
  'one PASS, one planned': ['PASS', 'pending'],
  'planned only': ['pending', 'pending'],
}
// The answer columns, in the order of each row's words.
const SAYS = [
  'Report: checked.',
  'Report.\nRESULT entry/C1: PASS',
  'Report.\nRESULT entry/C1: FAIL',
  'The page showed "RESULT code: FAIL" as the requirement asks. All checked.',
  'The log held:\nRESULT code: FAIL\nAll checked.',
  'One failed.\nBLOCKED: which user?',
  'RESULT u: FAIL\nBLOCKED: one persona',
  'RESULT entry/C1: PASS\nBLOCKED: which user next?',
]
// Per scenario state: the turn answered, then the turn was cut (aborted, error, refusal and an odd pair read the same).
const ENDS: Record<string, [string, string]> = {
  'none called': ['DONE PASS FAIL DONE FAIL BLOCKED? FAIL? BLOCKED?', 'STOPPED STOPPED FAIL STOPPED FAIL STOPPED FAIL STOPPED'],
  'all PASS': ['PASS PASS FAIL PASS FAIL BLOCKED? FAIL? BLOCKED?', 'STOPPED STOPPED FAIL STOPPED FAIL STOPPED FAIL STOPPED'],
  'one FAIL, all ended': ['FAIL FAIL FAIL FAIL FAIL FAIL? FAIL? FAIL?', 'FAIL FAIL FAIL FAIL FAIL FAIL FAIL FAIL'],
  'one FAIL, one planned': ['FAIL FAIL FAIL FAIL FAIL FAIL? FAIL? FAIL?', 'FAIL FAIL FAIL FAIL FAIL FAIL FAIL FAIL'],
  'one running': ['STOPPED STOPPED FAIL STOPPED FAIL BLOCKED? FAIL? BLOCKED?', 'STOPPED STOPPED FAIL STOPPED FAIL STOPPED FAIL STOPPED'],
  'one PASS, one planned': ['STOPPED STOPPED FAIL STOPPED FAIL BLOCKED? FAIL? BLOCKED?', 'STOPPED STOPPED FAIL STOPPED FAIL STOPPED FAIL STOPPED'],
  'planned only': ['STOPPED STOPPED FAIL STOPPED FAIL BLOCKED? FAIL? BLOCKED?', 'STOPPED STOPPED FAIL STOPPED FAIL STOPPED FAIL STOPPED'],
}
const HOW: [string, { reason?: string; isAborted?: boolean }][] = [
  ['answer', { reason: 'answer', isAborted: false }], ['aborted', { reason: 'aborted', isAborted: true }], ['error', { reason: 'error' }], ['refusal', { reason: 'refusal' }],
  ['answer, but aborted', { reason: 'answer', isAborted: true }], ['no reason', {}],
]
const NOW: End = { isDone: true, hidden: false, startedAt: 5, endedAt: 9 }
const word = (e: End) => `${e.result}${e.asked ? '?' : ''}`
const row = (how: { reason?: string; isAborted?: boolean }, sc: string[], kept?: End) => SAYS.map(a => word(verdict(cutBy(how), sc, said(a), NOW, kept))).join(' ')
// The header's own count of a list of endings, as the pane draws it.
const header = async ($: any, on: any, list: End[]) => {
  on('state.get', (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => (e.key === 'testers' ? { value: { value: list.map((x, i): Tester => ({ agentId: `c${i}`, label: 'c', steps: [], ...x })), version: 1 } } : next(e)))
  return (await frameAt($, 100))[0]
}
const tally = (words: string[]) => {
  const n = (w: string) => words.filter(x => x.replace('?', '') === w).length
  // A word with a question waits; a FAIL that waits is in Done and in FAIL too.
  const asks = words.filter(x => x.endsWith('?')).length
  return `Running 0 · Done ${words.length - n('BLOCKED')} (${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('STOPPED')} STOPPED, ${n('DONE')} DONE)${asks ? ` · ${asks} waiting` : ''}`
}

test('the table of endings, one turn: every reason by scenario state by answer gives its one result, and the header counts each', async ($, on) => {
  const got: Record<string, string> = {}
  const want: Record<string, string> = {}
  const cells: End[] = []
  for (const [how, e] of HOW) for (const [state, sc] of Object.entries(SC)) {
    got[`${how} | ${state}`] = row(e, sc)
    want[`${how} | ${state}`] = ENDS[state]![how === 'answer' ? 0 : 1]
    cells.push(...SAYS.map(a => verdict(cutBy(e), sc, said(a), NOW)))
  }
  expect(got).toEqual(want)
  expect(cells.length).toBe(336)
  // The parts of the header add up to Done: every finished cell is in one of them.
  expect(want && Object.values(want).flatMap(r => r.split(' ')).filter(x => !/^(PASS|FAIL|STOPPED|DONE|BLOCKED)\??$/.test(x))).toEqual([])
  // Every cell of a cut turn names its cause where the host gave one; an answer names none.
  expect(HOW.map(([, e]) => verdict(cutBy(e), [], said(''), NOW).cause)).toEqual([undefined, 'aborted', 'error', 'refused', 'aborted', undefined])
  // A question never stays with a cut turn, and every cell keeps this turn's times.
  expect(cells.every(c => c.isDone && c.startedAt === 5 && c.endedAt === 9)).toBe(true)
  expect(await header($, on, cells)).toBe(tally(Object.values(want).flatMap(r => r.split(' '))))
})

// Answers the RESULT rule must read as the benchmark does (bench/bench.js, test/bench.test.js): [scenarios, answer, result].
const LINES: [string, string, string][] = [
  ['all PASS', 'Report.\nRESULT entry/C1: FAIL\nSession ended with sf_end.', 'FAIL'],
  ['all PASS', 'Report.\nRESULT entry/C1: FAIL (the toast never showed)', 'FAIL'],
  ['all PASS', 'Report.\n- RESULT entry/C1: FAIL', 'FAIL'],
  ['all PASS', 'Report.\nRESULT entry/C1: FAIL \u2014 the toast never showed', 'FAIL'],
  ['all PASS', 'RESULT entry/C1: FAIL\n\nWhat I saw: the toast never showed.', 'FAIL'],
  ['none called', 'Report.\nRESULT entry/C1: FAIL\nSession ended.', 'FAIL'],
  ['none called', 'Report.\nRESULT entry/C1: PASS\nSession ended.', 'PASS'],
  ['one running', 'Report.\nRESULT entry/C1: PASS\nSession ended.', 'STOPPED'],
  ['all PASS', 'Report.\n## RESULT entry/C1: PASS', 'PASS'],
  ['all PASS', 'All checked. The banner on the page reads:\n> RESULT code: FAIL', 'FAIL'],
  ['one running', 'BLOCKED: which user?\nRESULT entry/C1: PASS', 'STOPPED'],
  ['all PASS', 'Report.\nRESULT entry/C1: Fail', 'PASS'],
  ['none called', 'Report.\nRESULT close case: FAIL', 'DONE'],
  ['all PASS', '', 'PASS'],
  ['none called', '', 'STOPPED'],
  ['none called', ' \n\t\n', 'STOPPED'],
  ['none called', '**', 'DONE'],
  ['none called', 'RESULT x/A1: FAIL, UNSUPPORTED_LANGUAGE', 'FAIL'],
  ['all PASS', 'RESULT x/A1: FAIL, the button is missing', 'FAIL'],
  ['all PASS', 'RESULT x/A1: FAIL / see the table above', 'FAIL'],
  ['none called', 'RESULT x/A1: PASS\n(the brief said RESULT x/A1: PASS or RESULT x/A1: FAIL)', 'PASS'],
  ['one PASS, one planned', 'RESULT x/A1: PASS\n(the brief said RESULT x/A1: PASS or RESULT x/A1: FAIL)', 'STOPPED'],
  ['all PASS', 'RESULT x/A1: PASS or RESULT x/A1: FAIL', 'PASS'],
  ['none called', 'RESULT x/A1: PASS or RESULT x/A1: FAIL', 'DONE'],
  ['none called', 'RESULT x/A1: PASS / RESULT x/A1: FAIL', 'DONE'],
  ['none called', 'I will end with RESULT x/A1: PASS or RESULT x/A1: FAIL.\nRESULT x/A1: FAIL', 'FAIL'],
  ['none called', 'Done.\n**RESULT x/A1: FAIL**', 'FAIL'],
  ['none called', 'RESULT x/A1: PASS\nOn the second run:\nRESULT x/A1: FAIL', 'FAIL'],
  ['none called', 'Report.\n```\nRESULT entry/C3: FAIL\n```', 'FAIL'],
  ['none called', 'Stopped.\n`BLOCKED` which users?', 'BLOCKED?'],
  ['none called', '| State | BLOCKED |\n- BLOCKED earlier, then went on', 'DONE'],
]
test('the table of endings, the RESULT line: read as the benchmark reads it, words, markup or lines after it allowed', () => {
  const answered = { reason: 'answer' }
  expect(LINES.map(([state, answer]) => word(verdict(cutBy(answered), SC[state]!, said(answer), NOW)))).toEqual(LINES.map(l => l[2]))
  // No text and no step is STOPPED, not a plain report; after a step it is DONE, and with every scenario passed PASS.
  expect([0, 1].map(ran => word(verdict(cutBy(answered), [], said(''), NOW, undefined, ran)))).toEqual(['STOPPED', 'DONE'])
  // A cut turn keeps a RESULT FAIL line and gets no PASS from a RESULT PASS line.
  expect(['error', 'refusal', 'aborted'].map(reason => [word(verdict(cutBy({ reason }), SC['all PASS']!, said('Report.\nRESULT x/A1: FAIL'), NOW)), word(verdict(cutBy({ reason }), [], said('RESULT x/A1: PASS'), NOW))].join(' '))).toEqual(['FAIL STOPPED', 'FAIL STOPPED', 'FAIL STOPPED'])
})

const BEFORE: Record<string, End> = {
  PASS: { isDone: true, result: 'PASS', hidden: true, startedAt: 1, endedAt: 2 },
  FAIL: { isDone: true, result: 'FAIL', startedAt: 1, endedAt: 2 },
  DONE: { isDone: true, result: 'DONE', startedAt: 1, endedAt: 2 },
  BLOCKED: { isDone: true, result: 'BLOCKED', asked: 'which app?', startedAt: 1, endedAt: 2 },
  STOPPED: { isDone: true, result: 'STOPPED', cause: 'refused', startedAt: 1, endedAt: 2 },
  'stored by an older pane': { isDone: true, startedAt: 1, endedAt: 2 },
}
test('the table of endings, a resumed tester: a cut turn gives back the kept ending whole, an answer or a step ends the run anew', () => {
  const cut = HOW.filter(([how]) => how !== 'answer')
  // Kept: the result, the question, the times and the hidden mark, whatever the cut turn's scenarios and answer say.
  for (const kept of Object.values(BEFORE)) for (const [, e] of cut) for (const sc of Object.values(SC)) for (const a of SAYS) expect(verdict(cutBy(e), sc, said(a), NOW, kept)).toEqual(kept)
  // A turn that answers reads the same with or without a kept ending, but for a kept FAIL: it stays FAIL until a
  // RESULT line says otherwise (the answers 1, 4 and 6 have none), with the question of this turn if it asks.
  const stays = (r: string) => r.split(' ').map((x, i) => (![0, 3, 5].includes(i) || x.startsWith('FAIL') ? x : `FAIL${x.endsWith('?') ? '?' : ''}`)).join(' ')
  for (const [was, kept] of Object.entries(BEFORE)) for (const [state, sc] of Object.entries(SC)) expect(`${was} | ${state} | ${row({ reason: 'answer' }, sc, kept)}`).toBe(`${was} | ${state} | ${was === 'FAIL' ? stays(ENDS[state]![0]) : ENDS[state]![0]}`)
  expect(row({ reason: 'answer' }, SC['all PASS']!, BEFORE.FAIL)).toBe('FAIL PASS FAIL FAIL FAIL FAIL? FAIL? BLOCKED?')
  expect(Object.keys(BEFORE).length * cut.length * Object.keys(SC).length * SAYS.length + Object.keys(BEFORE).length * Object.keys(SC).length * SAYS.length).toBe(2016)
})

// The same table through the pane's own events: one world, a tester per row, every block read from one frame.
const lab = ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  let k = 0
  let coming: { id: string; late?: () => Promise<unknown> } = { id: '' }
  on('agent.spawn', async () => { const { id, late } = coming; await late?.(); return { model: 'sonnet', agentId: id } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_: unknown, e: { fail?: string; reply?: string }) => (e.fail ? { isError: true, result: {}, text: JSON.stringify({ code: 'TIMEOUT', message: e.fail }) } : { result: {}, text: e.reply ?? '{"ok":true}' }))
  on('turn.complete', () => ({ text: '' }))
  // late: what happens before the spawn resolves, as when a continued turn ends first.
  const spawn = (id: string, late?: () => Promise<unknown>) => { coming = { id, late }; return $.agent.spawn({ prompt: `Requirement: ${id}`, description: id, subagentType: 'sf-tester', provider: { plugin: 'engine', tier: 'core' } } as never) }
  const call = (id: string, tool: string, args: object = {}) => $.tool.call({ tool: `mcp__sf-tester__sf_${tool}`, tool_use_id: `k${++k}`, agentId: id, ...args } as never)
  const end = (id: string, answer: string, reason = 'answer') => $.turn.complete({ agentId: id, answer, durationMs: 1, isAborted: reason === 'aborted', turnId: `t${++k}`, reason } as never)
  // Every block's verdict by its feature, and the header, with the older finished blocks opened.
  const read = async () => {
    const ui = await $.ui.mount(PANE)
    if ((await ui.find({ type: 'Text', text: /▸ \d+ older finished/ }))) await ui.press({ key: 'more' })
    await ui.unmount()
    const f = await frameAt($, 100)
    const by: Record<string, string> = {}
    f.forEach((l, i) => { if (/^(STOPPED|PASS|FAIL|DONE|BLOCKED|RUNNING|undefined) ·/.test(l)) by[f[i + 1]!] = l.replace(/ {2,}.*$/, '') })
    return { head: f[0]!, by, running: f.filter(l => /RUNNING/.test(l)).length }
  }
  return { clock, spawn, call, end, read }
}
type Lab = ReturnType<typeof lab>
const fails = { end: 'One', result: 'FAIL', reason: 'r' }
const RUNS: Record<string, [(w: Lab, id: string) => Promise<unknown>, string]> = {
  'V01 plain report, every scenario ended PASS': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'All checked.') }, 'PASS · 1 of 1 scenarios passed'],
  'V02 plain report, one planned scenario never started': [async (w, id) => { await w.call(id, 'scenario', { ...two, start: 'One' }); await w.call(id, 'scenario', { end: 'One', result: 'PASS' }); await w.end(id, 'Could not test Two: no permission.') }, 'STOPPED · 1 of 2 scenarios passed'],
  'V03 plain report, no sf_scenario call': [async (w, id) => { await w.call(id, 'click', { name: 'Go' }); await w.end(id, 'Checked, all good.') }, 'DONE · 1 step'],
  'V04 aborted turn, every scenario PASS': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'partial', 'aborted') }, 'STOPPED · aborted · 1 of 1 scenarios passed'],
  'V05 PASS run, then a turn with no sf call is aborted': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'All checked.'); await w.end(id, '', 'aborted') }, 'PASS · 1 of 1 scenarios passed'],
  'V06 PASS run, then a turn answers plain': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'All checked.'); await w.end(id, 'The toast said Saved.') }, 'PASS · 1 of 1 scenarios passed'],
  'V07 RESULT PASS line with a FAIL scenario': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.call(id, 'scenario', fails); await w.end(id, 'RESULT entry/C1: PASS') }, 'FAIL · 0 of 1 scenarios passed'],
  'V08 server overrules PASS to FAIL, plain report': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.call(id, 'scenario', { end: 'One', result: 'PASS', reply: '{"ok":true,"verdict":"FAIL","overruled":true,"checks":[{"tool":"sf_wait","expected":"Saved","pass":false}]}' }); await w.end(id, 'All checked.') }, 'FAIL · 0 of 1 scenarios passed'],
  'V09 turn ended by an API error, every scenario PASS': [async (w, id) => { await passOne(w as never, id); await w.end(id, '', 'error') }, 'STOPPED · error · 1 of 1 scenarios passed'],
  'V10 BLOCKED, resumed by an sf call, ends plain': [async (w, id) => { await w.end(id, 'BLOCKED: which app?'); await passOne(w as never, id); await w.end(id, 'All checked.') }, 'PASS · 1 of 1 scenarios passed'],
  'V11 plain report quoting a RESULT line in a sentence': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'The page showed "RESULT code: FAIL" as the requirement asks. All checked.') }, 'PASS · 1 of 1 scenarios passed'],
  'V12 every scenario ended, one FAIL, plain report': [async (w, id) => { await w.call(id, 'scenario', { ...two, start: 'One' }); await w.call(id, 'scenario', { ...fails, start: 'Two' }); await w.call(id, 'scenario', { end: 'Two', result: 'PASS' }); await w.end(id, 'One failed.') }, 'FAIL · 1 of 2 scenarios passed'],
  'V13 PASS run, then a turn ends on an API error': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'All checked.'); await w.end(id, '', 'error') }, 'PASS · 1 of 1 scenarios passed'],
  'V14 API error, one scenario still running': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.end(id, '', 'error') }, 'STOPPED · error · 0 of 1 scenarios passed'],
  'V15 FAIL scenario, then BLOCKED on the last line': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.call(id, 'scenario', fails); await w.end(id, 'One failed.\nBLOCKED: which user?') }, 'FAIL · 0 of 1 scenarios passed'],
  'V16 unplanned end only (no plan, no start), PASS': [async (w, id) => { await w.call(id, 'scenario', { end: 'One', result: 'PASS' }); await w.end(id, 'All checked.') }, 'PASS · 1 of 1 scenarios passed'],
  'V17 FAIL run, then a turn with no sf call is aborted': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.call(id, 'scenario', fails); await w.end(id, 'One failed.'); await w.end(id, '', 'aborted') }, 'FAIL · 0 of 1 scenarios passed'],
  'V18 refusal ends the turn, every scenario PASS': [async (w, id) => { await passOne(w as never, id); await w.end(id, '', 'refusal') }, 'STOPPED · refused · 1 of 1 scenarios passed'],
  'V19 one call starts and ends a scenario FAIL': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One', ...fails }); await w.end(id, 'One failed: no such tab.') }, 'FAIL · 0 of 1 scenarios passed'],
  'V20 one call starts and ends a scenario PASS': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One', end: 'One', result: 'PASS' }); await w.end(id, 'All checked.') }, 'PASS · 1 of 1 scenarios passed'],
  'V21 a same-call FAIL beside a scenario that passed': [async (w, id) => { await w.call(id, 'scenario', { ...two, start: 'One', ...fails }); await w.call(id, 'scenario', { start: 'Two' }); await w.call(id, 'scenario', { end: 'Two', result: 'PASS' }); await w.end(id, 'One failed.') }, 'FAIL · 1 of 2 scenarios passed'],
  'E01 RESULT FAIL then BLOCKED: the FAIL is counted': [(w, id) => w.end(id, 'RESULT u: FAIL\nBLOCKED: one persona'), 'FAIL · 0 steps'],
  'E05 RESULT PASS then the brief quoted': [async (w, id) => { await w.call(id, 'click', { name: 'Go' }); await w.end(id, 'RESULT x/A1: PASS\n(the brief said RESULT x/A1: PASS or RESULT x/A1: FAIL)') }, 'PASS · 1 step'],
  'E08 API error after a RESULT FAIL line, all PASS': [async (w, id) => { await passOne(w as never, id); await w.end(id, 'Report.\nRESULT x/A1: FAIL', 'error') }, 'FAIL · error · 1 of 1 scenarios passed'],
  'Q6 aborted with a failed scenario': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One', ...fails }); await w.end(id, '', 'aborted') }, 'FAIL · aborted · 0 of 1 scenarios passed'],
  'L5 RESULT PASS line, one scenario running': [async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One' }); await w.end(id, 'RESULT x: PASS') }, 'STOPPED · 0 of 1 scenarios passed'],
  'L10 no text and no step': [(w, id) => w.end(id, ''), 'STOPPED · 0 steps'],
  'L10 no text after a step': [async (w, id) => { await w.call(id, 'click', { name: 'Go' }); await w.end(id, ' ') }, 'DONE · 1 step'],
  'L2 plain answer, two failed steps': [async (w, id) => { await w.call(id, 'click', { name: 'Go', fail: 'no button' }); await w.call(id, 'wait', { text: 'Saved', fail: 'no text' }); await w.end(id, 'The button is missing, so the requirement is not met.') }, 'DONE · 2 steps, 2 failed'],
}
test('the table of endings through the pane: the first gate\'s V01 to V21 and the endings read wrong before, each block and the header', { timeoutMs: 30_000 }, async ($, on) => {
  const w = lab($, on)
  for (const [id, [run]] of Object.entries(RUNS)) { await w.spawn(id); await run(w, id) }
  const { head, by, running } = await w.read()
  expect(by).toEqual(Object.fromEntries(Object.entries(RUNS).map(([id, [, want]]) => [id, want])))
  expect(running).toBe(0)
  // V15 and E01 are FAIL with a question: each is in Done, in FAIL and in waiting, and the parts of Done add up.
  expect(head).toBe('Running 0 · Done 29 (9 PASS, 10 FAIL, 7 STOPPED, 3 DONE) · 2 waiting')
  // Each question still shows under its FAIL, the newest first, above every other block.
  expect((await frameAt($, 100)).filter(l => /^Question: /.test(l))).toEqual(['Question: one persona', 'Question: which user?'])
  // A plain answer is DONE in the subtle colour; with failed steps it says so in words and is drawn as a warning.
  const ui = await $.ui.mount(PANE)
  const color = async (text: RegExp) => ((await ui.find({ type: 'Text', text })) as { props?: { color?: string } } | undefined)?.props?.color
  expect([await color(/^DONE · 1 step$/), await color(/^DONE · 2 steps, 2 failed$/)]).toEqual(['subtle', 'warning'])
  await ui.unmount()
})

test('an ending that holds a question waits whatever its result: a FAIL that asks is counted, drawn first with Dismiss, and stays through Clear and the cap', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world($, on)
  await w.spawn('Fails by its line, asks.')
  await w.end('f1', 'RESULT u: FAIL\nBLOCKED: which persona should I use?')
  await w.spawn('Fails a scenario, asks.')
  await w.call('f2', 'scenario', { ...one, start: 'One', ...fails })
  await w.end('f2', 'One failed.\nBLOCKED: which user?')
  for (const id of ['f3', 'f4', 'f5', 'f6']) { await w.spawn(`Newer ${id}.`); await passOne(w, id); await w.end(id, 'All checked.') }
  const brief = async () => (await frameAt($, 60)).filter(l => /older finished|^Question|^(FAIL|BLOCKED|PASS|DONE) ·|^Running/.test(l)).map(l => l.replace(/ {2,}.*· /, ' ~ '))
  expect(await brief()).toEqual([
    'Running 0 · Done 6 (4 PASS, 2 FAIL) · 2 waiting',
    'm: ▸ 1 older finished',
    'FAIL · 0 of 1 scenarios passed ~ Dismiss', 'Question: which user?',
    'FAIL · 0 steps ~ Dismiss', 'Question: which persona should I use?',
    'PASS · 1 of 1 scenarios passed ~ Clear', 'PASS · 1 of 1 scenarios passed ~ Clear', 'PASS · 1 of 1 scenarios passed ~ Clear',
  ])
  // Clear hides the four that passed and leaves the two questions.
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'clear' })
  await ui.unmount()
  expect(await brief()).toEqual(['Running 0 · Done 2 (0 PASS, 2 FAIL) · 2 waiting', 'FAIL · 0 of 1 scenarios passed ~ Dismiss', 'Question: which user?', 'FAIL · 0 steps ~ Dismiss', 'Question: which persona should I use?'])
  // At the cap the hidden ones leave, and no FAIL that waits does.
  for (let i = 0; i < 300; i += 1) await w.spawn(`Run ${i}.`)
  expect((await brief()).filter(l => !/^Running/.test(l))).toEqual(['FAIL · 0 of 1 scenarios passed ~ Dismiss', 'Question: which user?', 'FAIL · 0 steps ~ Dismiss', 'Question: which persona should I use?'])
})

test('the ending kept at a resume is the whole ending, its cause too', async ($, on) => {
  let last: Tester[] = []
  ;(on as any)('state.set', (_: unknown, e: { key: string; value: any }, next: (e: unknown) => unknown) => { if (e.key === 'testers') last = e.value?.value ?? e.value; return next(e) })
  const w = lab($, on)
  await w.spawn('f1')
  await passOne(w as never, 'f1')
  await w.end('f1', '', 'aborted')
  await w.clock.advance(60_000)
  await w.spawn('f1')
  expect(last[0]!.kept).toEqual({ isDone: true, result: 'STOPPED', asked: undefined, cause: 'aborted', hidden: undefined, startedAt: T0, endedAt: T0 })
})

test('the turn that ends a resume drops the kept ending, cut or answered', async ($, on) => {
  let last: Tester[] = []
  ;(on as any)('state.set', (_: unknown, e: { key: string; value: any }, next: (e: unknown) => unknown) => { if (e.key === 'testers') last = e.value?.value ?? e.value; return next(e) })
  const w = lab($, on)
  await w.spawn('f1')
  await passOne(w as never, 'f1')
  await w.end('f1', 'All checked.')
  const after: unknown[] = []
  for (const [answer, reason] of [['', 'error'], ['Noted.', 'answer']]) {
    await w.clock.advance(60_000)
    await w.spawn('f1')
    after.push(last[0]!.kept?.result)
    await w.end('f1', answer!, reason)
    after.push(last[0]!.result, last[0]!.kept)
  }
  expect(after).toEqual(['PASS', 'PASS', undefined, 'PASS', 'PASS', undefined])
})

test('a repeat spawn that lands after its turn ended starts no blink timer: no tester runs, so nothing is written', async ($, on) => {
  let blinks = 0
  ;(on as any)('state.set', (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => { if (e.key === 'blink') blinks += 1; return next(e) })
  const w = lab($, on)
  await w.spawn('f1')
  await passOne(w as never, 'f1')
  await w.end('f1', 'All checked.')
  for (const reason of ['aborted', 'answer']) await w.spawn('f1', async () => { await w.clock.advance(2_000); await w.end('f1', reason === 'answer' ? 'Note.' : '', reason) })
  const before = blinks
  await w.clock.advance(10_000)
  expect([(await w.read()).head, blinks - before]).toEqual(['Running 0 · Done 1 (1 PASS, 0 FAIL)', 0])
  // A spawn that does set it running blinks again.
  await w.clock.advance(60_000)
  await w.spawn('f1')
  await w.clock.advance(10_000)
  expect(blinks - before).toBe(20)
})

test('a turn that ends with no answer field still ends the tester: it reads as an answer with no text', async ($, on) => {
  const w = lab($, on)
  await w.spawn('f1')
  await passOne(w as never, 'f1')
  await $.turn.complete({ agentId: 'f1', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(await w.read()).toEqual({ head: 'Running 0 · Done 1 (1 PASS, 0 FAIL)', by: { f1: 'PASS · 1 of 1 scenarios passed' }, running: 0 })
})

test('a scenario ended with no result still draws: the pane shows its row with no status, and the run is STOPPED', async ($, on) => {
  const w = lab($, on)
  await w.spawn('f1')
  await w.call('f1', 'scenario', { ...one, start: 'One' })
  await w.call('f1', 'scenario', { end: 'One' })
  await w.end('f1', 'All checked.')
  expect(await w.read()).toEqual({ head: 'Running 0 · Done 1 (0 PASS, 0 FAIL, 1 STOPPED)', by: { f1: 'STOPPED · 0 of 1 scenarios passed' }, running: 0 })
  expect((await frameAt($, 60)).filter(l => /One/.test(l))).toEqual(['  + One'])
})

// A resumed tester. Rows: how the first run ended. Columns: how it went on, each then cut with no answer.
const FIRST: Record<string, (w: Lab, id: string) => Promise<unknown>> = {
  PASS: async (w, id) => { await passOne(w as never, id); await w.end(id, 'All checked.') },
  FAIL: async (w, id) => { await w.call(id, 'scenario', { ...one, start: 'One', ...fails }); await w.end(id, 'One failed.') },
  DONE: async (w, id) => { await w.call(id, 'click', { name: 'Go' }); await w.end(id, 'Read it.') },
  BLOCKED: (w, id) => w.end(id, 'BLOCKED: which app?'),
  'STOPPED, one planned': async (w, id) => { await w.call(id, 'scenario', { ...two, start: 'One' }); await w.call(id, 'scenario', { end: 'One', result: 'PASS' }); await w.end(id, 'Could not test Two.') },
  'STOPPED, aborted': async (w, id) => { await passOne(w as never, id); await w.end(id, '', 'aborted') },
}
const LATER: Record<string, (w: Lab, id: string, reason: string) => Promise<unknown>> = {
  'no spawn, no call': (w, id, reason) => w.end(id, '', reason),
  'spawn first, no call': async (w, id, reason) => { await w.spawn(id); await w.end(id, '', reason) },
  'spawn resolves late': (w, id, reason) => w.spawn(id, async () => { await w.clock.advance(2_000); await w.end(id, '', reason) }),
  'no spawn, a step': async (w, id, reason) => { await w.call(id, 'click', { name: 'Again' }); await w.end(id, '', reason) },
  'spawn first, a step': async (w, id, reason) => { await w.spawn(id); await w.call(id, 'click', { name: 'Again' }); await w.end(id, '', reason) },
}
// The same rows continued with no sf-tester call, the later turn answered: plain, nothing, a RESULT PASS line, and
// plain again after a step.
const ANSWERS: Record<string, (w: Lab, id: string) => Promise<unknown>> = {
  'no spawn, plain': (w, id) => w.end(id, 'The toast said Saved.'),
  'spawn first, plain': async (w, id) => { await w.spawn(id); await w.end(id, 'The toast said Saved.') },
  'spawn resolves late, plain': (w, id) => w.spawn(id, async () => { await w.clock.advance(2_000); await w.end(id, 'The toast said Saved.') }),
  'no spawn, no text': (w, id) => w.end(id, ''),
  'no spawn, RESULT PASS': (w, id) => w.end(id, 'RESULT x: PASS'),
  'a step, plain': async (w, id) => { await w.call(id, 'click', { name: 'Again' }); await w.end(id, 'The toast said Saved.') },
}
const ANSWERED: Record<string, string> = {
  PASS: 'PASS PASS PASS PASS PASS PASS',
  'FAIL by its RESULT line': 'FAIL FAIL FAIL FAIL PASS PASS',
  FAIL: 'FAIL FAIL FAIL FAIL FAIL FAIL',
  DONE: 'DONE DONE DONE DONE PASS DONE',
  BLOCKED: 'DONE DONE DONE STOPPED PASS DONE',
  'STOPPED, one planned': 'STOPPED STOPPED STOPPED STOPPED STOPPED STOPPED',
  'STOPPED, aborted': 'PASS PASS PASS PASS PASS PASS',
}
test('the table of endings through the pane, a resumed tester that answers: a FAIL stays FAIL until a RESULT line or a step, in each order of the repeat spawn', { timeoutMs: 30_000 }, async ($, on) => {
  const w = lab($, on)
  const first: typeof FIRST = { ...FIRST, 'FAIL by its RESULT line': async (w, id) => { await passOne(w as never, id); await w.end(id, 'Report.\nRESULT x: FAIL') } }
  for (const [name, run] of Object.entries(first)) for (const [later, go] of Object.entries(ANSWERS)) {
    const id = `${name} | ${later}`
    await w.spawn(id)
    await run(w, id)
    await w.clock.advance(60_000)
    await go(w, id)
  }
  const { head, by, running } = await w.read()
  expect(Object.fromEntries(Object.keys(ANSWERED).map(name => [name, Object.keys(ANSWERS).map(later => by[`${name} | ${later}`]?.split(' ')[0]).join(' ')]))).toEqual(ANSWERED)
  expect(running).toBe(0)
  const all = Object.values(ANSWERED).flatMap(r => r.split(' '))
  expect(head).toBe(tally(all).replace(', 0 STOPPED', ''))
})

const AFTER: Record<string, string> = {
  PASS: 'PASS PASS PASS STOPPED STOPPED',
  FAIL: 'FAIL FAIL FAIL FAIL FAIL',
  DONE: 'DONE DONE DONE STOPPED STOPPED',
  BLOCKED: 'BLOCKED BLOCKED BLOCKED STOPPED STOPPED',
  'STOPPED, one planned': 'STOPPED STOPPED STOPPED STOPPED STOPPED',
  'STOPPED, aborted': 'STOPPED STOPPED STOPPED STOPPED STOPPED',
}
test('the table of endings through the pane, a resumed tester: a cut turn keeps the result in both orders of the repeat spawn, and nothing reads RUNNING', { timeoutMs: 30_000 }, async ($, on) => {
  const w = lab($, on)
  let n = 0
  for (const [first, run] of Object.entries(FIRST)) for (const [later, go] of Object.entries(LATER)) {
    const id = `${first} | ${later}`
    await w.spawn(id)
    await run(w, id)
    await w.clock.advance(60_000)
    await go(w, id, ['aborted', 'error', 'refusal'][n++ % 3]!)
  }
  // A run Clear hid stays hidden through a cut turn after its repeat spawn.
  await w.spawn('hidden'); await FIRST.PASS!(w, 'hidden')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'hide:hidden' })
  await ui.unmount()
  await LATER['spawn first, no call']!(w, 'hidden', 'error')
  // An hour on, a late spawn has set no tester running again.
  await w.clock.advance(3_600_000)
  const { head, by, running } = await w.read()
  expect(Object.fromEntries(Object.keys(FIRST).map(first => [first, Object.keys(LATER).map(later => by[`${first} | ${later}`]?.split(' ')[0]).join(' ')]))).toEqual(AFTER)
  expect(running).toBe(0)
  // The whole verdict of the aborted run: kept with its own cause through a turn cut another way, and after a
  // step the new cut names its own.
  expect(Object.keys(LATER).map(later => by[`STOPPED, aborted | ${later}`]!.split(' · ')[1])).toEqual(['aborted', 'aborted', 'aborted', 'error', 'refused'])
  expect(head).toBe('Running 0 · Done 27 (3 PASS, 5 FAIL, 16 STOPPED, 3 DONE) · 3 waiting')
  // The kept runs keep their question and their own run time: the cut turn a minute later adds nothing.
  const f = await frameAt($, 100)
  expect(f.filter(l => l === 'Question: which app?').length).toBe(3)
  expect(f.filter(l => /^PASS · 1 of 1 scenarios passed .* · 0s · Clear$/.test(l)).length).toBe(3)
})

test('a STOPPED block says why its turn ended, and folded it keeps its first unfinished scenario and counts the others', async ($, on) => {
  const w = world($, on)
  await asking(w, 'f1')
  await busy(w, 'f2', 'Next opens the second screen.', 'Next')
  await w.spawn('Twelve planned.')
  const titles = Array.from({ length: 12 }, (_, i) => `Scenario ${i + 1} of the plan`)
  await w.call('f3', 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  await w.call('f3', 'scenario', { end: titles[0], result: 'PASS', start: titles[1] })
  await turn($, 'f3', 'aborted')
  const f = await frameRC($, 60, 30)
  // The whole frame keeps to the pane's 30 rows, the question in view.
  expect(f.length).toBe(30)
  expect(f.some(l => /^Question: /.test(l))).toBe(true)
  expect(f.slice(f.findIndex(l => /^STOPPED ·/.test(l)))).toEqual([
    'STOPPED · aborted · 1 of 12 scenarios passed      0s · Clear',
    'Twelve planned.',
    '',
    '▸ 1 passed · 10 more not finished',
    '  + Scenario 2 of the plan                      not finished',
  ])
  // A wrapped verdict takes its rows from the budget: at 40 columns the block is one row taller, no more.
  const n = await frameRC($, 40, 30)
  expect(n.slice(n.findIndex(l => /^STOPPED ·/.test(l)), n.findIndex(l => /^STOPPED ·/.test(l)) + 2)).toEqual(['STOPPED · aborted · 1 of 12        Clear', 'scenarios passed'])
  // A failed scenario stays above the fold row's count too, with the first unfinished one.
  await w.spawn('One failed.')
  await w.call('f4', 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  await w.call('f4', 'scenario', { end: titles[0], result: 'PASS', start: titles[1] })
  await w.call('f4', 'scenario', { end: titles[1], result: 'FAIL', reason: 'no toast', start: titles[2] })
  await turn($, 'f4', 'error')
  const h = await frameRC($, 60, 30)
  expect(h.some(l => l === '▸ 1 passed · 9 more not finished')).toBe(true)
  const mine = h.slice(h.findIndex(l => /^FAIL ·/.test(l)), h.findIndex(l => /^STOPPED ·/.test(l)))
  expect(mine.filter(l => /Scenario \d+ of the plan/.test(l)).map(l => l.replace(/^[ │╭╰]+|[ │]+$/g, '').replace(/ {2,}/g, ' ~ '))).toEqual(['+ Scenario 2 of the plan ~ FAIL', '+ Scenario 3 of the plan ~ not finished'])
  // With no failed scenario the verdict is STOPPED with the cause, and only unfinished ones are counted.
  await w.spawn('Eleven left.')
  await w.call('f5', 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  await turn($, 'f5', 'refusal')
  const g = await frameRC($, 60, 30)
  expect(g.some(l => l.startsWith('STOPPED · refused · 0 of 12 scenarios passed'))).toBe(true)
  expect(g.some(l => l === '▸ 11 more not finished')).toBe(true)
  await w.release()
})

test('a folded block is charged the rows it draws: the older block under it is whole as soon as the frame fits', async ($, on) => {
  const w = world($, on)
  await w.spawn('Older.')
  await w.call('f1', 'scenario', { ...plan([['Fails', 'positive'], ['Saves', 'positive'], ['Opens', 'positive']]), start: 'Fails' })
  await w.call('f1', 'scenario', { end: 'Fails', result: 'FAIL', reason: 'no toast', start: 'Saves' })
  await w.call('f1', 'scenario', { end: 'Saves', result: 'PASS', start: 'Opens' })
  await w.call('f1', 'scenario', { end: 'Opens', result: 'PASS' })
  await w.end('f1', 'One failed.')
  await w.spawn('Newer.')
  const titles = Array.from({ length: 12 }, (_, i) => `Check ${i + 1}`)
  await w.call('f2', 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  for (const [i, t] of titles.entries()) await w.call('f2', 'scenario', { end: t, result: i === 6 ? 'FAIL' : 'PASS', ...(i === 6 && { reason: 'the seventh broke' }), ...(i < 11 && { start: titles[i + 1] }) })
  await w.end('f2', 'RESULT a: FAIL')
  // The fewest rows at which only the newer block is folded: the frame then fills the pane to its last row.
  const folds = (f: string[]) => f.filter(l => /^[▸▾] \d+ passed scenarios$/.test(l)).length
  const n = await smallest(async rows => folds(await frameRC($, 60, rows)) === 1, 12, 32)
  expect([folds(await frameRC($, 60, n - 1)), (await frameRC($, 60, n)).length]).toEqual([2, n])
})

test('a folded block that keeps no scenario is charged its blank row too, and one that folding makes one row shorter stays whole', async ($, on) => {
  const w = world($, on)
  await w.spawn('Older.')
  await w.call('f1', 'scenario', { ...plan([['Fails', 'positive'], ['Saves', 'positive'], ['Opens', 'positive']]), start: 'Fails' })
  await w.call('f1', 'scenario', { end: 'Fails', result: 'FAIL', reason: 'no toast', start: 'Saves' })
  await w.call('f1', 'scenario', { end: 'Saves', result: 'PASS', start: 'Opens' })
  await w.call('f1', 'scenario', { end: 'Opens', result: 'PASS' })
  await w.end('f1', 'One failed.')
  await w.spawn('Newer.')
  const titles = Array.from({ length: 12 }, (_, i) => `Check ${i + 1}`)
  await w.call('f2', 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  for (const [i, t] of titles.entries()) await w.call('f2', 'scenario', { end: t, result: 'PASS', ...(i < 11 && { start: titles[i + 1] }) })
  await w.end('f2', 'All checked.')
  // Every scenario of the newer block passed, so folded it is its fold row alone under a blank row.
  const folds = (f: string[]) => f.filter(l => /^[▸▾] \d+ passed scenarios$/.test(l)).length
  const n = await smallest(async rows => folds(await frameRC($, 60, rows)) === 1, 12, 40)
  expect([folds(await frameRC($, 60, n - 1)), (await frameRC($, 60, n)).length]).toEqual([2, n])
  // One passed scenario under a named requirement: the fold would save one row, so the block stays whole.
  await w.spawn('One passed.')
  await w.call('f3', 'scenario', { ...plan([['Saves', 'positive']], 'The record saves'), start: 'Saves' })
  await w.call('f3', 'scenario', { end: 'Saves', result: 'PASS' })
  await w.end('f3', 'All checked.')
  const f = await frameRC($, 60, 6)
  expect(f.slice(f.findIndex(l => l === 'One passed.'), f.findIndex(l => l === 'One passed.') + 4)).toEqual(['One passed.', '', 'Requirement: The record saves', '  + Saves                                               PASS'])
})

test('one is singular on the fold rows: 1 passed scenario and 1 earlier step', async ($, on) => {
  const w = world($, on)
  // A finished block that folds one passed scenario away under its failed one.
  await w.spawn('One of each.')
  await w.call('f1', 'scenario', { ...plan([['Fails', 'positive']], 'The toast shows'), start: 'Fails' })
  await w.call('f1', 'scenario', { end: 'Fails', result: 'FAIL', reason: 'no toast' })
  await w.call('f1', 'scenario', { ...plan([['Saves', 'positive']], 'The record saves'), start: 'Saves' })
  await w.call('f1', 'scenario', { end: 'Saves', result: 'PASS' })
  await w.end('f1', 'One failed.')
  expect((await frameRC($, 60, 8)).filter(l => /^[▸▾] /.test(l))).toEqual(['▸ 1 passed scenario'])
  // A running tester short of rows for the one step before its failed step.
  await w.spawn('Running.')
  await w.call('f2', 'scenario', { ...one, start: 'One' })
  await w.call('f2', 'click', { name: 'Go' })
  await w.call('f2', 'wait', { text: 'Saved', fail: 'no text' })
  await w.call('f2', 'scenario', { end: 'One', result: 'FAIL', reason: 'no toast' })
  expect((await frameRC($, 60, 8)).map(l => l.replace(/^[ │]+|[ │]+$/g, '')).filter(l => /earlier step/.test(l))).toEqual(['▸ 1 earlier step'])
})

// ---- The row budget: who takes the pane's rows, in the order of the claims in register.tsx. ----
// A tester that planned n scenarios, started the first and then asked a question.
const waitingOn = async (w: World, id: string, n: number) => {
  await w.spawn('Waiting mid-run.')
  const titles = Array.from({ length: n }, (_, i) => `Scenario ${i + 1} of the plan`)
  await w.call(id, 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  await w.end(id, 'BLOCKED: the tab is named Cases here, which label does the source set?')
}
test('a waiting block is its question, its first unfinished scenario and a row that counts the others, so every running tester stays in the pane', async ($, on) => {
  const w = world($, on)
  await waitingOn(w, 'f1', 10)
  await busy(w, 'f2', 'Next opens the second screen.', 'Next')
  await busy(w, 'f3', 'Back keeps what was typed.', 'Back')
  const f = await frameRC($, 60, 30)
  await w.release()
  expect(f.slice(0, 13)).toEqual([
    'Running 2 · Done 0 (0 PASS, 0 FAIL) · 1 waiting',
    'Scenarios 0 PASS · 0 FAIL · 2 RUNNING · 2 to run',
    'ctrl+x tab to use keys',
    '',
    '────────────────────────────────────────',
    `BLOCKED · waiting for you               ${AT} · 0s · Dismiss`,
    'Waiting mid-run.',
    'Question: the tab is named Cases here, which label does the',
    'source set?',
    '',
    '▸ 9 more not finished',
    '  + Scenario 1 of the plan                      not finished',
    '',
  ])
  expect(f.length).toBeLessThanOrEqual(30)
  expect(f.filter(l => /● RUNNING/.test(l)).length).toBe(2)
})

test('two waiting testers: the newest question is drawn first', async ($, on) => {
  const w = world($, on)
  await w.spawn('Asked first.')
  await w.end('f1', 'BLOCKED: which app, Sales or Service?')
  await w.spawn('Asked second.')
  await w.end('f2', 'BLOCKED: which user, the rep or the manager?')
  const f = await frameRC($, 60, 30)
  expect(f.filter(l => /^(Asked|Question)/.test(l))).toEqual(['Asked second.', 'Question: which user, the rep or the manager?', 'Asked first.', 'Question: which app, Sales or Service?'])
})

test('a folded block pressed open is charged the rows it draws: the running tester under it gives up its steps', async ($, on) => {
  const w = world($, on)
  await waitingOn(w, 'f1', 10)
  await thirty(w, 'f2')
  const steps = (f: string[]) => f.filter(l => /✓ Click the "Step/.test(l)).length
  const folded = steps(await frameRC($, 60, 40))
  const opened = steps(await pressed($, 'open:f1/all', 40))
  await w.release()
  expect([folded > 10, opened]).toEqual([true, 0])
})

test('the one-row testers are drawn above the block in full, so a block taller than the pane leaves every tester named in view', async ($, on) => {
  const w = world($, on)
  await w.spawn('Twelve planned.')
  const titles = Array.from({ length: 12 }, (_, i) => `Scenario ${i + 1} of the plan`)
  await w.call('f1', 'scenario', { ...plan(titles.map(t => [t, 'positive'] as [string, 'positive'])), start: titles[0] })
  await w.hold('f1', 'click', { role: 'button', name: 'Go' })
  await busy(w, 'f2', 'Back does its job.', 'Back')
  await busy(w, 'f3', 'Finish does its job.', 'Finish')
  const wide = await frameRC($, 60, 30)
  const narrow = await frameRC($, 40, 30)
  await w.release()
  expect(wide.slice(0, 9)).toEqual([
    'Running 3 · Done 0 (0 PASS, 0 FAIL)',
    'Scenarios 0 PASS · 0 FAIL · 3 RUNNING · 13 to run',
    'ctrl+x tab to use keys',
    '',
    '2: ▸ ● RUNNING  24s · 0 of 2 passed · Back does its job.',
    '3: ▸ ● RUNNING  12s · 0 of 2 passed · Finish does its job.',
    '',
    '1: ▾ ● RUNNING  24s                           0 of 12 passed',
    'Twelve planned.',
  ])
  // The block in full is taller than the pane at both widths; the two rows are on rows 5 and 6 or 6 and 7.
  expect([wide.length > 30, narrow.length > 30, narrow.findIndex(l => /^2: ▸/.test(l)) < 7, narrow.findIndex(l => /^3: ▸/.test(l)) < 8]).toEqual([true, true, true, true])
})
