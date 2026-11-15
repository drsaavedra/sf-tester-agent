'use strict';

// The known-route benchmark harness: briefs per arm and transcript metrics, without an org or a Claude session.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const bench = require('../bench/bench');

// The tests that read this checkout skip, with the reason, while a corpus defect is applied or the checkout cannot be read;
// a fixture edit that is no defect must still turn them red.
const realDirty = (() => {
  try {
    const on = bench.appliedIds();
    return on.length ? `a corpus defect is applied: ${on.join(', ')}` : false;
  } catch (e) {
    return `cannot read the checkout: ${e.message.split('\n')[0]}`;
  }
})();
const { combinations } = require('..');

const entry = combinations.list({ component: 'record-picker', container: 'sidebar' })[0];
const values = { dynId: 'a01X', accountName: 'Acme' };

test('the A brief gives the task only; B lists the route; C gives it as sf_run_route steps', () => {
  const [a, b, c] = ['A', 'B', 'C'].map((arm) => bench.brief({ cell: `x-${arm}-1`, entry, arm, values, org: 'fx' }));
  for (const [arm, text] of [['A', a], ['B', b], ['C', c]]) {
    assert.match(text, /Company chosen|company/i, arm);
    assert.match(text, new RegExp(`RESULT x-${arm}-1: PASS or RESULT x-${arm}-1: FAIL$`), arm);
    assert.doesNotMatch(text, /\{\{/, `${arm} has no unfilled placeholder`);
    assert.match(text, /^Do not save a route with sf_save_route\.$/m, `${arm} leaves the catalogue alone`);
    assert.match(text, /^App: none to pick/m, `${arm} names the app, so the cell is not BLOCKED`);
  }
  assert.doesNotMatch(a, /sf_click|sfUiInputs/, 'A names no tool and no API name');
  assert.match(a, /do not call sf_combinations/);
  assert.match(bench.brief({ cell: 'x', entry: { ...entry, app: 'SF UI App' }, arm: 'C', values, org: 'fx' }), /^App: SF UI App$/m, 'an entry\'s own app is named');
  assert.match(b, /^2\. sf_fill /m);
  assert.match(b, /one call at a time, not with sf_run_route/, 'B stays one call per step: the agent doc otherwise folds a listed route into sf_run_route');
  assert.match(c, /sf_run_route/);
  assert.deepEqual(JSON.parse(c.match(/^\[.*\]$/m)[0]).map((s) => s.tool), entry.route.map((s) => s.tool));
});

test('a target\'s persona: every arm starts as the alias owner and becomes that user by Login As', () => {
  const p = { ...entry, persona: { name: 'Val Viewer', username: 'val@x.test' } };
  const [a, c, d] = ['A', 'C', 'D'].map((arm) => bench.brief({ cell: `x-${arm}-1`, entry: p, arm, values, org: 'fx', instanceUrl: 'https://fx.test' }));
  for (const t of [a, c]) {
    assert.match(t, /^Org: fx \(a scratch org\)\. Persona: Val Viewer \(val@x\.test\): start your own session with session "new" as the alias owner, then become that user with sf_login_as\.$/m);
    assert.doesNotMatch(t, /no sf_login_as/);
  }
  assert.match(d, /The browser is already signed in as the alias owner\. Test as Val Viewer \(val@x\.test\): become that user with Login As, from the user's detail page in Setup\./);
  assert.match(bench.brief({ cell: 'x', entry, arm: 'A', values, org: 'fx' }), /Persona: the alias owner \(no sf_login_as\)/, 'no persona: the owner, as before');
});

test('metrics counts turns, sf calls and cache reads per run, and finds the verdict in the hand-back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const line = (o) => JSON.stringify(o);
  const turn = (id, t, content, usage) => line({ type: 'assistant', timestamp: t, message: { id, content, usage } });
  fs.writeFileSync(path.join(dir, 'agent-abc.jsonl'), [
    line({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'brief' } }),
    turn('m1', '2026-01-01T00:00:01.000Z', [{ type: 'tool_use', id: 't1', name: 'mcp__sf-tester__sf_start', input: {} }], { cache_read_input_tokens: 100, input_tokens: 5 }),
    line({ type: 'user', timestamp: '2026-01-01T00:00:03.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }),
    turn('m2', '2026-01-01T00:00:04.000Z', [{ type: 'tool_use', id: 't2', name: 'SubagentHandback', input: { message: 'RESULT x-C-1: PASS' } }], { cache_read_input_tokens: 200, cache_creation_input_tokens: 7, output_tokens: 40 }),
  ].join('\n'));
  // Cost needs the three token prices apart: output, and cache writes inside fresh.
  const priced = bench.run({ cell: 'x-C-1', file: path.join(dir, 'agent-abc.jsonl') });
  assert.deepEqual([priced.output, priced.cacheWrite], [40, 7]);
  assert.deepEqual(bench.spawned(dir), [], 'a transcript whose brief names no run is not matched');
  fs.writeFileSync(path.join(dir, 'agent-def.jsonl'), line({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'Timed benchmark run combobox@sidebar/C1 of the sf-tester.' } }));
  assert.deepEqual(bench.spawned(dir), ['combobox@sidebar/C1 def'], 'a run maps to its cell by the brief\'s first line');
  fs.writeFileSync(path.join(dir, 'agent-ghi.jsonl'), [line({ type: 'user', message: { content: '[Workflow harness — user request] go' } }), line({ type: 'user', message: { content: '[Workflow harness — computed task]\n  Timed benchmark run combobox@sidebar/A1 of the sf-tester.' } })].join('\n'));
  assert.deepEqual(bench.spawned(dir), ['combobox@sidebar/C1 def', 'combobox@sidebar/A1 ghi'], 'a workflow run, whose brief follows a harness message, maps too');
  const r = bench.run({ cell: 'x-C-1', file: path.join(dir, 'agent-abc.jsonl') });
  assert.deepEqual([r.result, r.turns, r.sfCalls, r.cacheRead, r.fresh, r.wallS], ['PASS', 2, 1, 300, 12, 4]);
  assert.equal(bench.run({ cell: 'x-C-1', file: path.join(dir, 'missing.jsonl') }), null);
});

test('D and E give the record URL and a signed-in browser, never sf-ui; E adds the checked route as a guide', () => {
  const [d, e] = ['D', 'E'].map((arm) => bench.brief({ cell: `x-${arm}-1`, entry, arm, values, org: 'fx', instanceUrl: 'https://fx.my.salesforce.com' }));
  for (const [arm, text] of [['D', d], ['E', e]]) {
    assert.match(text, /^Timed benchmark run x-.-1 of the sf-tester\./, arm);
    assert.match(text, /https:\/\/fx\.my\.salesforce\.com\/lightning\/r\/<record id>\/view/, arm);
    assert.match(text, /browser_close/, arm);
    assert.doesNotMatch(text, /sf_start|sf_end|session "new"|sf_combinations/, `${arm} offers no sf-ui tool`);
    assert.match(text, new RegExp(`RESULT x-${arm}-1: PASS or RESULT x-${arm}-1: FAIL$`), arm);
    assert.doesNotMatch(text, /\{\{/, arm);
  }
  assert.doesNotMatch(d, /sf_click|sfUiInputs/, 'D names no route');
  assert.match(e, /different tool set/);
  assert.deepEqual(JSON.parse(e.match(/^\[.*\]$/m)[0]).map((s) => s.tool), entry.route.map((s) => s.tool));
});

test('G is D with read-only sf CLI reads on the brief\'s org: the same signed-in browser, no route, no sf-tester tool', () => {
  const g = bench.brief({ cell: 'x-G-1', entry, arm: 'G', values, org: 'fx', instanceUrl: 'https://fx.test' });
  assert.match(g, /^Timed benchmark run x-G-1 of the sf-tester\./);
  assert.match(g, /The browser is already signed in as the alias owner\./);
  assert.match(g, /^You also have the sf CLI for read-only reads of this org: sf data query, sf sobject describe or list, and sf api request rest \(GET\), each with -o fx\.$/m);
  assert.doesNotMatch(g, /sf_start|sf_end|sf_click|sfUiInputs|different tool set/, 'no sf-tester tool and no route');
  assert.match(g, /RESULT x-G-1: PASS or RESULT x-G-1: FAIL$/);
  assert.equal(bench.ARMS.includes('G'), true);
});

// A ToolSearch call only loads a schema, so it stays out of calls and tools.
test('metrics also counts every tool call but ToolSearch, screenshots and the starting context, for any tool set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const line = (o) => JSON.stringify(o);
  fs.writeFileSync(path.join(dir, 'agent-pw.jsonl'), [
    line({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'brief' } }),
    line({ type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'm1', content: [{ type: 'tool_use', name: 'ToolSearch', input: {} }, { type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: {} }], usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 } } }),
    line({ type: 'assistant', timestamp: '2026-01-01T00:00:02.000Z', message: { id: 'm2', content: [{ type: 'tool_use', name: 'mcp__playwright__browser_take_screenshot', input: {} }, { type: 'text', text: 'RESULT x-D-1: FAIL' }], usage: { cache_read_input_tokens: 50 } } }),
  ].join('\n'));
  const r = bench.run({ cell: 'x-D-1', file: path.join(dir, 'agent-pw.jsonl') });
  assert.deepEqual([r.result, r.turns, r.calls, r.sfCalls, r.screenshots, r.startCtx], ['FAIL', 2, 2, 0, 1, 33]);
  assert.equal(r.tools, 'browser_navigate browser_take_screenshot');
});

// A transcript of calls [{ name, result, error, str, raw }] then a closing report. A result is the JSON the tool returned, as text blocks, or as a plain string with str (what real sf-tester errors are); raw is a string used as is.
function transcript(dir, file, calls, report) {
  const line = (o) => JSON.stringify(o);
  const t = (n) => `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
  const out = [line({ type: 'user', timestamp: t(0), message: { content: 'brief' } })];
  calls.forEach((c, i) => {
    out.push(line({ type: 'assistant', timestamp: t(1 + i * 2), message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input || {} }], usage: {} } }));
    out.push(line({ type: 'user', timestamp: t(2 + i * 2), message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: !!c.error, content: c.raw !== undefined ? c.raw : c.str ? JSON.stringify(c.result) : [{ type: 'text', text: JSON.stringify(c.result) }] }] } }));
  });
  out.push(line({ type: 'assistant', timestamp: t(60), message: { id: 'end', content: [{ type: 'text', text: report }], usage: {} } }));
  fs.writeFileSync(path.join(dir, file), out.join('\n'));
  return path.join(dir, file);
}
const sf = (n) => `mcp__sf-tester__${n}`;
const chk = (oracle, pass) => ({ tool: 'sf_wait', oracle, expected: 'x', actual: null, pass });
// The alias owner's username, without the sf CLI: CI runners have none.
const username = async (org) => org;

test('run scores a defect cell: caught, missed, pass, refused, false-fail, unfinished, and no score without a defect', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const f = (name, report) => transcript(dir, name, [{ name: sf('sf_start'), result: { ok: true } }], report);
  const outcome = (expected, report) => bench.run({ cell: 'x/A1', file: f('o.jsonl', report), defect: 'd', expected }).outcome;
  assert.equal(outcome('FAIL', 'RESULT x/A1: FAIL'), 'caught');
  assert.equal(outcome('FAIL', 'RESULT x/A1: PASS'), 'missed');
  assert.equal(outcome('PASS', 'RESULT x/A1: PASS'), 'pass');
  assert.equal(outcome('PASS', 'RESULT x/A1: FAIL, UNSUPPORTED_LANGUAGE'), 'false-fail', 'the agent writing the code is not a refusal: only a tool error is');
  assert.equal(outcome('PASS', 'RESULT x/A1: FAIL, the button is missing'), 'false-fail');
  assert.equal(outcome('FAIL', 'I will end with RESULT x/A1: PASS or RESULT x/A1: FAIL.\nRESULT x/A1: FAIL'), 'caught', 'the last verdict counts, not a quoted one');
  assert.equal(outcome('PASS', 'RESULT x/A1: PASS\n(the brief said RESULT x/A1: PASS or RESULT x/A1: FAIL)'), 'pass', 'a quote after the verdict is not one');
  assert.equal(outcome('FAIL', 'RESULT x/A1: PASS or RESULT x/A1: FAIL'), 'unfinished', 'the brief line alone is no verdict');
  assert.equal(outcome('FAIL', 'Done.\n**RESULT x/A1: FAIL**'), 'caught', 'markup in front of the verdict is allowed');
  assert.equal(outcome('FAIL', 'RESULT x/A1: PASS / RESULT x/A1: FAIL'), 'unfinished', 'a quote with a slash is no verdict either');
  assert.equal(outcome('FAIL', 'RESULT x/A1: FAIL / see the table above'), 'caught', 'a verdict followed by a slash and prose is still one');
  const back = transcript(dir, 'back.jsonl', [{ name: sf('sf_start'), result: { ok: true } }], 'handing back');
  fs.appendFileSync(back, `\n${JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:01:01.000Z', message: { id: 'z', content: [{ type: 'tool_use', id: 'tz', name: 'SubagentHandback', input: { message: 'Summary.\nRESULT x/A1: FAIL' } }], usage: {} } })}`);
  assert.equal(bench.run({ cell: 'x/A1', file: back, defect: 'd', expected: 'FAIL' }).outcome, 'caught', 'a verdict on a later line of the hand-back message counts');
  assert.equal(outcome('PASS', 'no verdict'), 'unfinished');
  assert.equal(outcome('FAIL', 'no verdict, UNSUPPORTED_LANGUAGE'), 'unfinished');
  assert.equal(outcome(undefined, 'RESULT x/A1: FAIL'), '', 'a cell with no defect is not scored');
  // The refusal is a tool error carrying the code; the agent's report need not repeat it.
  const viaTool = (expected, report, call = { name: sf('sf_open_record'), error: true, str: true, result: { code: 'UNSUPPORTED_LANGUAGE' } }) => bench.run({ cell: 'x/A1', file: transcript(dir, 't.jsonl', [call], report), defect: 'd', expected }).outcome;
  assert.equal(viaTool('PASS', 'RESULT x/A1: FAIL, the page would not open'), 'refused', 'the code in a tool error counts');
  assert.equal(viaTool('PASS', 'no verdict'), 'refused');
  assert.equal(viaTool('FAIL', 'RESULT x/A1: FAIL'), 'caught', 'a tool error naming it does not change an expected FAIL');
  assert.equal(viaTool('PASS', 'RESULT x/A1: PASS'), 'pass', 'a run that still passed was not refused');
  assert.equal(viaTool('PASS', 'RESULT x/A1: FAIL', { name: sf('sf_open_record'), error: true, result: { code: 'ROUTE_STEP_FAILED', evidence: { code: 'UNSUPPORTED_LANGUAGE' } } }), 'refused', 'a route step\'s own code counts');
  assert.equal(viaTool('PASS', 'RESULT x/A1: FAIL', { name: sf('sf_api'), result: { note: 'UNSUPPORTED_LANGUAGE', code: 'UNSUPPORTED_LANGUAGE' } }), 'false-fail', 'a result that is not an error is not a refusal');
  const other = transcript(dir, 'o.jsonl', [{ name: sf('sf_start'), result: { ok: true } }, { name: 'ToolSearch', error: true, str: true, result: { code: 'UNSUPPORTED_LANGUAGE' } }], 'RESULT x/A1: FAIL');
  assert.equal(bench.run({ cell: 'x/A1', file: other, defect: 'd', expected: 'PASS' }).outcome, 'false-fail', 'only an sf tool error is a refusal, as only one is a catch');
  assert.equal(viaTool('PASS', 'RESULT x/A1: FAIL', { name: sf('sf_api'), error: true, result: { code: 'NOT_FOUND', message: 'see UNSUPPORTED_LANGUAGE docs' } }), 'false-fail', 'the text of another error is not its code');
  assert.equal(viaTool('PASS', 'RESULT x/A1: FAIL', { name: 'mcp__playwright__browser_click', error: true, result: { code: 'UNSUPPORTED_LANGUAGE' } }), 'false-fail', 'D and E results are not read');
});

test('run names what caught the defect: the first failed check\'s oracle, else the first sf tool error, else none, blank without sf tools', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const by = (calls, report = 'RESULT x/A1: FAIL') => bench.run({ cell: 'x/A1', file: transcript(dir, 'c.jsonl', calls, report), defect: 'd', expected: 'FAIL' }).caughtBy;
  const start = { name: sf('sf_start'), result: { ok: true } };
  const end = (checks) => ({ name: sf('sf_scenario'), result: { ok: true, checks } });
  assert.equal(by([start, end([chk('rendered', true), chk('api', false), chk('rendered', false)])]), 'api', 'the first pass:false check, not the first check');
  assert.equal(by([start, { name: sf('sf_end'), result: { checks: [chk('rendered', false)] } }]), 'rendered', 'sf_end returns the checks of a run that marked no scenario');
  assert.equal(by([start, { name: sf('sf_click'), error: true, result: { code: 'NOT_FOUND' } }], 'RESULT x/A1: PASS'), '', 'a PASS run caught nothing, whatever it slipped on');
  assert.equal(by([start, { name: sf('sf_click'), error: true, result: { code: 'NOT_ON_PAGE', evidence: { reason: 'notRendered', likelyCause: 'visibilityRule' } } }, end([])]), 'error:NOT_ON_PAGE');
  assert.equal(by([start, { name: sf('sf_click'), error: true, result: { code: 'NOT_FOUND' } }, { name: sf('sf_wait'), error: true, result: { code: 'NOT_ON_PAGE' } }]), 'error:NOT_FOUND', 'the first error is the catch; later noise does not replace it');
  assert.equal(by([start, { name: sf('sf_run_route'), error: true, result: { code: 'ROUTE_STEP_FAILED', evidence: { code: 'NOT_FOUND' } } }]), 'error:NOT_FOUND', 'a route step\'s own code is named, not the wrapper');
  assert.equal(by([start, end([chk('rendered', false)]), { name: sf('sf_click'), error: true, result: { code: 'NOT_FOUND' } }]), 'rendered', 'a failed check outranks a tool error');
  assert.equal(by([start, end([chk('rendered', true)])]), 'none');
  assert.equal(by([start, { name: sf('sf_click'), result: { code: 'NOT_FOUND' } }]), 'none', 'a code in a result that is not an error is not a catch');
  assert.equal(by([start, { name: sf('sf_click'), error: true, raw: 'Error: not json' }]), 'none', 'an error result that is not JSON has no code to name');
  assert.equal(by([{ name: 'mcp__playwright__browser_click', error: true, result: { code: 'X' } }]), '', 'D has no check records: blank, not none');
  // Only an sf-tester tool can catch a defect: a failed schema load or file read in the same run is not the catch.
  assert.equal(by([start, { name: 'ToolSearch', error: true, str: true, result: { code: 'NOT_FOUND' } }, { name: 'Read', error: true, str: true, result: { code: 'ENOENT' } }]), 'none');
  // Real sf-tester results arrive as a plain string, not a list of text blocks.
  assert.equal(by([start, { name: sf('sf_click'), error: true, str: true, result: { code: 'NOT_ON_PAGE' } }]), 'error:NOT_ON_PAGE');
  assert.equal(by([start, { name: sf('sf_scenario'), str: true, result: { ok: true, checks: [chk('api', false)] } }]), 'api', 'checks in a string result are read');
  // The agent's own slips are not what caught the defect: a bad start, a bad scenario call, a bad argument.
  const bad = (name, code) => ({ name: sf(name), error: true, str: true, result: { code } });
  assert.equal(by([start, bad('sf_click', 'NOT_FOUND'), bad('sf_start', 'TOO_MANY_SESSIONS'), bad('sf_scenario', 'BAD_ARGS'), bad('sf_end', 'NO_SESSION'), bad('sf_wait', 'BAD_ARGS'), bad('sf_wait', 'NO_SESSION')]), 'error:NOT_FOUND');
  assert.equal(by([start, bad('sf_wait', 'NO_SESSION')]), 'none', 'NO_SESSION from any tool catches nothing');
  assert.equal(by([start, bad('sf_start', 'APP_UNAVAILABLE'), bad('sf_click', 'BAD_ARGS')]), 'none');
  // A route step's own slip is a slip too: ROUTE_STEP_FAILED wrapping NO_SESSION or BAD_ARGS is not the catch.
  const step = (code) => ({ name: sf('sf_run_route'), error: true, str: true, result: { code: 'ROUTE_STEP_FAILED', evidence: { code } } });
  assert.equal(by([start, step('NO_SESSION')]), 'none');
  assert.equal(by([start, step('BAD_ARGS')]), 'none');
  assert.equal(by([start, bad('sf_wait', 'BUDGET_SPENT')]), 'none', 'a spent budget is the run stopping, not a defect caught');
  assert.equal(by([start, step('BUDGET_SPENT')]), 'none');
  assert.equal(by([start, step('NO_SESSION'), step('NOT_FOUND')]), 'error:NOT_FOUND');
  // Each result is parsed once, however many readers ask: the refusal scan and the catch both look at it.
  const raw = JSON.stringify({ code: 'NOT_FOUND', message: 'only once' });
  const parse = JSON.parse;
  let seen = 0;
  JSON.parse = (s, ...a) => { if (s === raw) seen += 1; return parse(s, ...a); };
  try {
    assert.equal(by([start, { name: sf('sf_click'), error: true, raw }]), 'error:NOT_FOUND');
  } finally {
    JSON.parse = parse;
  }
  assert.equal(seen, 1, 'one parse for the refusal scan and the catch together');
});

test('seed --defect tags each cell and limits the targets to the defect\'s own; none is the control', () => {
  const defects = [{ id: 'd', target: 't@x', expected: 'FAIL' }];
  assert.deepEqual(bench.scope('d', undefined, defects), { only: ['t@x'], tag: { defect: 'd', expected: 'FAIL' } });
  assert.deepEqual(bench.scope('d', ['y@z'], defects).only, ['y@z'], '--only wins over the target');
  assert.deepEqual(bench.scope('none', ['a@b'], defects), { only: ['a@b'], tag: { defect: 'none', expected: 'PASS' } });
  assert.deepEqual(bench.scope(undefined, ['a@b'], defects), { only: ['a@b'], tag: {} });
  const two = [...defects, { id: 'e', target: 't@x' }, { id: 'f', target: 'u@y' }];
  assert.deepEqual(bench.scope('none', undefined, two).only, ['t@x', 'u@y'], 'the control defaults to the corpus targets, each once');
  assert.throws(() => bench.scope('nope', undefined, defects), /no defect nope/);
  assert.ok(bench.scope('visibility-rule').tag.expected, 'the shipped corpus resolves');
});

test('seed writes the defect and expected verdict into each cell, on the defect\'s own target; none is the control on all targets', async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  let n = 0;
  const call = async () => ({ id: `001${(n += 1)}` });
  const cells = async (defect, applied = defect === 'none' ? [] : [defect]) => { await bench.seed({ org: 'x', run: defect, n: 1, arms: ['A'], defect, call, instanceUrl: 'https://x.test', applied }); return JSON.parse(fs.readFileSync(path.join(bench.runDir(defect), 'cells.json'), 'utf8')).cells; };
  const d = await cells('tab-renamed');
  assert.deepEqual([...new Set(d.map((c) => [c.entry, c.defect, c.expected].join()))], ['combobox@app-page,tab-renamed,FAIL']);
  const u = await cells('non-english-user');
  assert.deepEqual([...new Set(u.map((c) => [c.entry, c.defect, c.expected].join()))], ['checkbox-number@edit-dialog,non-english-user,PASS']);
  const c = await cells('none');
  assert.deepEqual([...new Set(c.map((x) => x.entry))].sort(), ['checkbox-number@edit-dialog', 'combobox@app-page', 'combobox@record-tab']);
  assert.ok(c.every((x) => x.defect === 'none' && x.expected === 'PASS'));
  // A defect that is not applied, or the control with one applied, is a setup error: no cells are made.
  await assert.rejects(cells('tab-renamed', []), /tab-renamed is not applied/);
  await assert.rejects(cells('tab-renamed', ['visibility-rule']), /tab-renamed is not applied/);
  await assert.rejects(cells('tab-renamed', ['tab-renamed', 'visibility-rule']), /tab-renamed is applied with visibility-rule/);
  await assert.rejects(cells('tab-renamed', ['visibility-rule', 'tab-renamed']), /tab-renamed is applied with visibility-rule/, 'the order does not matter');
  await assert.rejects(cells('none', ['tab-renamed']), /--defect none, but tab-renamed is applied/);
});

test('seed keeps the run name out of every record name and brief, so a tester cannot read the defect from it', async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const run = 'leakrun-layout-field-removed';
  const bodies = [];
  const call = async (p, init) => { bodies.push(init.body); return { id: `001${bodies.length}` }; };
  const only = ['record-picker@sidebar', 'row-action@related-list-single', 'card-move@kanban', 'chatter-post@chatter-publisher', 'file-input@non-default-tab']; // every name and path seed makes: account, contact, probe, list probe, dyn, child, upload
  const { dir, key } = await bench.seed({ org: 'x', run, n: 1, arms: ['A', 'B'], only, call, instanceUrl: 'https://x.test' });
  // The key is what ties the records to the run once the names no longer carry it.
  assert.ok(key && bodies.every((x) => { const o = JSON.parse(x); return String(o.Name ?? o.LastName).includes(key); }), 'every record name, a Contact\'s LastName too, carries the key seed returns');
  const briefs = fs.readdirSync(path.join(dir, 'briefs')).map((f) => fs.readFileSync(path.join(dir, 'briefs', f), 'utf8'));
  assert.ok(bodies.length > 3 && briefs.length > 3, `checked ${bodies.length} records and ${briefs.length} briefs`);
  const leaks = [...bodies, ...briefs].filter((s) => /leakrun/i.test(s));
  assert.deepEqual(leaks, []);
  // The upload sits outside the folder that holds the runs, where the OS does not purge it, and cleanup takes it.
  const upload = path.join(`${process.env.SF_TESTER_BENCH}-uploads`, key, 'bench-upload.txt');
  assert.ok(briefs.some((t) => t.includes(upload)) && fs.existsSync(upload), upload);
  await bench.cleanup({ run, call: async () => null });
  assert.equal(fs.existsSync(path.dirname(upload)), false, 'cleanup removes the upload folder');
  // Two seeds on one org still name their records apart, or a list search would match the other run's probe.
  bodies.length = 0;
  await bench.seed({ org: 'x', run: 'other', n: 1, arms: ['A'], only, call, instanceUrl: 'https://x.test' });
  const names = (bs) => bs.map((b) => JSON.parse(b).Name).filter(Boolean);
  const second = names(bodies);
  bodies.length = 0;
  await bench.seed({ org: 'x', run: 'other2', n: 1, arms: ['A'], only, call, instanceUrl: 'https://x.test' });
  assert.deepEqual(names(bodies).filter((x) => second.includes(x)), []);
});

test('seed with no applied list reads the checkout: a defect that is not applied is refused, the control goes through', { skip: realDirty }, async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const call = async () => ({ id: '001X' });
  await assert.rejects(bench.seed({ org: 'x', run: 'dflt', defect: 'tab-renamed', call, instanceUrl: 'https://x.test' }), /tab-renamed is not applied/);
  await bench.seed({ org: 'x', run: 'dflt', n: 1, arms: ['A'], defect: 'none', call, instanceUrl: 'https://x.test' });
  // A user defect counts whatever the org, as in the apply check: it refuses the control on any org, and its own cells
  // only on the org it was applied on.
  fs.mkdirSync(bench.stateDir(), { recursive: true });
  fs.writeFileSync(path.join(bench.stateDir(), 'sandboxA__non-english-user.json'), JSON.stringify({ id: 'non-english-user', org: 'sandboxA' }));
  for (const org of ['x', 'sandboxA']) {
    await assert.rejects(bench.seed({ org, run: 'dflt2', n: 1, arms: ['A'], defect: 'none', call, instanceUrl: 'https://x.test' }), /--defect none, but non-english-user is applied/);
  }
  await assert.rejects(bench.seed({ org: 'x', run: 'dflt3', n: 1, arms: ['A'], defect: 'non-english-user', call, instanceUrl: 'https://x.test' }), /non-english-user was applied on sandboxA, not x/);
  await bench.seed({ org: 'sandboxA', run: 'dflt4', n: 1, arms: ['A'], defect: 'non-english-user', call, instanceUrl: 'https://x.test' });
});

test('appliedIds names the patch defects that reverse cleanly and every defect with a state file', () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const { root, git, patch } = fixtureRepo();
  const f = patch('p.patch', 'two');
  const defects = [{ id: 'p', kind: 'patch', patch: f }, { id: 'u', kind: 'user' }];
  assert.deepEqual(bench.appliedIds(defects, root), []);
  git('apply', f);
  assert.deepEqual(bench.appliedIds(defects, root), ['p']);
  fs.mkdirSync(bench.stateDir(), { recursive: true });
  fs.writeFileSync(path.join(bench.stateDir(), 'o__u.json'), JSON.stringify({ id: 'u', org: 'o' }));
  fs.writeFileSync(path.join(bench.stateDir(), 'notes.txt'), 'not a state');
  fs.mkdirSync(bench.runDir('defects'), { recursive: true });
  fs.writeFileSync(path.join(bench.runDir('defects'), 'cells.json'), JSON.stringify({ cells: [] }));
  assert.deepEqual(bench.appliedIds(defects, root), ['p', 'u'], 'a user defect counts whatever its org');
  // A patch git cannot read is not "not applied": the check says so instead of reporting a clean fixture.
  assert.throws(() => bench.appliedIds([{ id: 'x', kind: 'patch', patch: path.join(root, 'missing.patch') }], root), (e) => e.status > 1);
});

test('metrics flags a cell that reached an org other than its own: sf_start for sf-tester, -o or --target-org for Bash', () => {
  const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  process.env.SF_TESTER_BENCH = bd;
  const tr = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  fs.mkdirSync(path.join(bd, 'r'));
  const cells = ['e/A1', 'e/G1', 'e/A2'].map((cell) => ({ cell, entry: 'e', arm: cell[2] }));
  fs.writeFileSync(path.join(bd, 'r', 'cells.json'), JSON.stringify({ org: 'own', cells }));
  const bash = (command) => ({ name: 'Bash', input: { command }, result: {} });
  transcript(tr, 'agent-a0.jsonl', [{ name: sf('sf_start'), input: { org: 'own' }, result: {} }], 'RESULT e/A1: PASS');
  transcript(tr, 'agent-a1.jsonl', [bash('sf data query -q x -o other'), bash("sf data query -q y --target-org='own'"),
    // Not orgs: another tool's -o, an -o inside a quoted query, and a quoted flag the shell joins, as the guard does.
    bash('grep -o Price snap.yml'), bash("sf data query -q \"SELECT Id FROM X WHERE Name = 'a -o b'\" -o own"), bash('sf data query -q x "-o" own')], 'RESULT e/G1: PASS');
  transcript(tr, 'agent-a2.jsonl', [{ name: sf('sf_start'), input: { org: 'elsewhere' }, result: {} }], 'RESULT e/A2: PASS');
  fs.writeFileSync(path.join(bd, 'r', 'spawn.log'), cells.map((c, i) => `${c.cell} a${i}`).join('\n') + '\n');
  const m = bench.metrics({ run: 'r', transcripts: tr });
  const rows = fs.readFileSync(path.join(bd, 'r', 'metrics.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const col = rows[0].indexOf('otherOrgs');
  assert.deepEqual(rows.slice(1).map((r) => [r[0], r[col]]), [['e/A1', ''], ['e/G1', 'other'], ['e/A2', 'elsewhere']]);
  assert.equal(m.otherOrg, '2 of 3', 'the run summary counts them, reviewed, not dropped');
});

test('metrics reads an org named by its username as the alias it is', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-home-'));
  fs.mkdirSync(path.join(home, '.sfdx'));
  fs.writeFileSync(path.join(home, '.sfdx', 'alias.json'), JSON.stringify({ orgs: { own: 'own@x.test' } }));
  const was = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = was; });
  const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  process.env.SF_TESTER_BENCH = bd;
  const tr = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  fs.mkdirSync(path.join(bd, 'r'));
  fs.writeFileSync(path.join(bd, 'r', 'cells.json'), JSON.stringify({ org: 'own', cells: [{ cell: 'e/A1', entry: 'e', arm: 'A' }] }));
  transcript(tr, 'agent-a0.jsonl', [{ name: sf('sf_start'), input: { org: 'own@x.test' }, result: {} }, { name: 'Bash', input: { command: 'sf data query -q x -o own@x.test' }, result: {} }], 'RESULT e/A1: PASS');
  fs.writeFileSync(path.join(bd, 'r', 'spawn.log'), 'e/A1 a0\n');
  assert.equal(bench.metrics({ run: 'r', transcripts: tr }).otherOrg, '0 of 1');
});

test('metrics writes the defect columns and counts each outcome by defect and arm', () => {
  const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  process.env.SF_TESTER_BENCH = bd;
  const run = path.join(bd, 'r');
  const tr = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  fs.mkdirSync(run);
  const cell = (id, arm, defect, expected) => ({ cell: `e/${arm}${id}`, entry: 'e', arm, defect, expected });
  const cells = [cell(1, 'A', 'd', 'FAIL'), cell(2, 'A', 'd', 'FAIL'), cell(3, 'A', 'd', 'FAIL'), cell(4, 'C', 'u', 'PASS'), cell(5, 'C', 'u', 'PASS'), cell(6, 'A', 'v', 'FAIL')];
  fs.writeFileSync(path.join(run, 'cells.json'), JSON.stringify({ cells }));
  const reports = ['RESULT e/A1: FAIL', 'RESULT e/A2: PASS', 'no verdict', 'blocked, no verdict', 'RESULT e/C5: FAIL', 'no verdict'];
  reports.forEach((r, i) => transcript(tr, `agent-a${i}.jsonl`, [{ name: sf('sf_start'), result: { ok: true } }, ...(i === 3 ? [{ name: sf('sf_open_record'), error: true, str: true, result: { code: 'UNSUPPORTED_LANGUAGE' } }] : [])], r));
  fs.writeFileSync(path.join(run, 'spawn.log'), cells.map((c, i) => `${c.cell} a${i}`).join('\n') + '\n');
  const m = bench.metrics({ run: 'r', transcripts: tr });
  const rows = fs.readFileSync(path.join(run, 'metrics.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  assert.deepEqual(rows[0].slice(0, 5), ['cell', 'defect', 'expected', 'outcome', 'caughtBy']);
  assert.deepEqual(rows.slice(1).map((r) => r[3]), ['caught', 'missed', 'unfinished', 'refused', 'false-fail', 'unfinished']);
  const sum = Object.fromEntries(m.summary.trim().split('\n').slice(1).map((l) => l.split('\t')).map((c) => [`${c[1]}/${c[2]}`, c]));
  assert.equal(m.summary.split('\n')[0].split('\t').slice(8).join(), 'out_caught,out_missed,out_refused,out_false-fail,out_pass,out_unfinished');
  const nPassOut = (c) => [...c.slice(3, 5), ...c.slice(8)];
  assert.deepEqual(nPassOut(sum['d/A']), ['2', '1', '1', '1', '0', '0', '0', '1'], 'the unfinished cell is out of n but in out_unfinished');
  assert.deepEqual(nPassOut(sum['u/C']), ['2', '0', '0', '0', '1', '1', '0', '0'], 'the refused cell has no verdict line yet stays in n');
  // The per-arm ALL rows: no entry key, an empty defect, then the same n and outcome counts over that arm's cells.
  assert.deepEqual(sum['/A'].slice(0, 3), ['ALL', '', 'A']);
  assert.deepEqual(nPassOut(sum['/A']), ['2', '1', '1', '1', '0', '0', '0', '2']);
  assert.deepEqual(nPassOut(sum['/C']), ['2', '0', '0', '0', '1', '1', '0', '0']);
  assert.equal(Object.keys(sum).length, 5, 'three groups and two arms, none for an arm with no cells');
  assert.deepEqual(m.unfinished, ['e/A3', 'e/A6']);
  assert.deepEqual([...sum['v/A'].slice(3, 8), ...sum['v/A'].slice(13)], ['0', '0', '0', '0', '0', '1'], 'a group with no finished cell shows n 0 and zero means, not NaN');
});

// A git repo whose test/fixture/a.txt holds "one", committed: the stand-in for the fixture a patch defect changes.
function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root });
  const file = path.join(root, 'test', 'fixture', 'a.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'one\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  // A one-hunk patch that turns the fixture's "one" into `to`, written under the repo root.
  const patch = (name, to) => { const f = path.join(root, name); fs.writeFileSync(f, `diff --git a/test/fixture/a.txt b/test/fixture/a.txt\n--- a/test/fixture/a.txt\n+++ b/test/fixture/a.txt\n@@ -1 +1 @@\n-one\n+${to}\n`); return f; };
  return { root, git, file, patch };
}

test('defect applies and reverts a patch against the fixture root, and refuses a second while one is applied', async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  const { root, git, file, patch } = fixtureRepo();
  const defects = [{ id: 'p', kind: 'patch', patch: patch('p.patch', 'two') }, { id: 'q', kind: 'patch', patch: patch('q.patch', 'three') }];
  await bench.defect({ id: 'p', op: 'apply', defects, root });
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');
  await assert.rejects(bench.defect({ id: 'q', op: 'apply', defects, root }), /uncommitted changes/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n', 'the refused apply changed nothing');
  await bench.defect({ id: 'p', op: 'revert', defects, root });
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n');
  await bench.defect({ id: 'q', op: 'apply', defects, root });
  assert.equal(fs.readFileSync(file, 'utf8'), 'three\n');
  await assert.rejects(bench.defect({ id: 'nope', op: 'apply', defects, root }), /no defect nope; known: p, q/);
  // Staged is still applied: git add does not make the fixture look clean.
  await bench.defect({ id: 'q', op: 'revert', defects, root });
  await bench.defect({ id: 'p', op: 'apply', defects, root });
  git('add', '.');
  await assert.rejects(bench.defect({ id: 'q', op: 'apply', defects, root }), /uncommitted changes/, 'a staged defect still counts');
  await bench.defect({ id: 'p', op: 'revert', defects, root });
  git('reset', '-q');
  // A new file under the fixture counts: a patch that adds one is applied too.
  fs.writeFileSync(path.join(root, 'test', 'fixture', 'new.txt'), 'x\n');
  await assert.rejects(bench.defect({ id: 'p', op: 'apply', defects, root }), /uncommitted changes/, 'an untracked fixture file counts');
  fs.rmSync(path.join(root, 'test', 'fixture', 'new.txt'));
  // A folder that is not a repo, where git cannot answer (exit 128), says so, not "uncommitted changes".
  // A repo with no commit yet lists the fixture as untracked, so it reads as changed, not as a git error.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  fs.mkdirSync(path.join(fresh, 'test', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(fresh, 'test', 'fixture', 'a.txt'), 'one\n');
  execFileSync('git', ['init', '-q'], { cwd: fresh });
  await assert.rejects(bench.defect({ id: 'p', op: 'apply', defects, root: fresh }), /uncommitted changes/, 'a repo with no HEAD still answers');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  await assert.rejects(bench.defect({ id: 'p', op: 'apply', defects, root: bare }), (e) => e.status > 1 && !/uncommitted/.test(e.message), 'a git failure is not read as a dirty fixture');
});

test('seed takes a patch defect out of the tree before any record, and its state keeps the one-defect checks true until --revert', async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  const { root, git, file, patch } = fixtureRepo();
  const id = 'tab-renamed'; // scope() reads the corpus for the target; the patch itself is the fixture repo's
  const defects = [{ id, kind: 'patch', patch: patch('p.patch', 'two') }, { id: 'q', kind: 'patch', patch: patch('q.patch', 'three') }];
  const status = () => git('status', '--porcelain', '--', 'test/fixture').toString();
  const atCall = [];
  const call = async () => { atCall.push(status()); return { id: '001x' }; };
  const seed = (defect, run, org = 'x') => bench.seed({ org, run, n: 1, arms: ['A'], only: ['inline-edit@list-view'], defect, call, instanceUrl: 'https://x.test', defects, root });
  await assert.rejects(seed('none', 'r0').then(() => seed(id, 'r0b')), /tab-renamed is not applied/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n');
  await bench.defect({ id, op: 'apply', defects, root });
  assert.match(status(), /a\.txt/, 'control: the patched file shows before seed');
  await assert.rejects(seed('none', 'r1'), /--defect none, but tab-renamed is applied/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n', 'a refused seed leaves the patch in place');
  atCall.length = 0;
  const first = await seed(id, 'r2');
  assert.match(first.reverted, /^tab-renamed: reverted/);
  assert.equal(status(), '');
  assert.ok(atCall.length && atCall.every((x) => x === ''), 'the tree was clean before the first record was made');
  // The tree is clean now, and the org still has the defect: the state keeps every check true.
  await assert.rejects(seed('none', 'r3'), /--defect none, but tab-renamed is applied/);
  await assert.rejects(bench.defect({ id: 'q', op: 'apply', defects, root }), /a defect is applied/);
  await assert.rejects(seed(id, 'r4', 'y'), /tab-renamed was applied on x, not y/);
  assert.equal((await seed(id, 'r5')).reverted, undefined, 'a second seed of the same defect needs no second apply');
  await bench.defect({ id, op: 'revert', defects, root });
  assert.deepEqual(bench.appliedIds(defects, root), [], 'the revert clears the record');
  assert.equal(status(), '');
  await seed('none', 'r6');
  // A bad alias leaves the tree and no state, so the right org still seeds.
  await bench.defect({ id, op: 'apply', defects, root });
  await assert.rejects(bench.seed({ org: 'typo', run: 'r7', n: 1, arms: ['A'], defect: id, call: async () => ({}), defects, root }), /typo|NO_SF_CLI/);
  assert.deepEqual(fs.readdirSync(bench.stateDir()).filter((f) => f.includes('typo')), [], 'a seed on a bad alias writes no state');
  // A state that cannot be written leaves the patch in the tree: never a clean tree with no record.
  fs.mkdirSync(bench.stateDir(), { recursive: true });
  fs.chmodSync(bench.stateDir(), 0o555);
  await assert.rejects(seed(id, 'r7b'), /EACCES/);
  fs.chmodSync(bench.stateDir(), 0o755);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n', 'the patch stays until its record is written');
  // A patch left in the index still shows in git status, so seed refuses until the tree is clean, then seeds with no second apply.
  assert.match(status(), /a\.txt/);
  git('add', 'test/fixture');
  await assert.rejects(seed(id, 'r8'), /uncommitted changes/);
  git('reset', '-q');
  // A revert names the org it was seeded on; a wrong one keeps the record of the org that holds the defect.
  await seed(id, 'r9');
  await assert.rejects(bench.defect({ id, op: 'revert', org: 'y', defects, root }), /tab-renamed was applied on x, not y/);
  assert.deepEqual(bench.appliedIds(defects, root), [id]);
  // A patch put back beside its state counts once, seed takes it out again, and --revert leaves both clean.
  execFileSync('git', ['apply', defects[0].patch], { cwd: root });
  assert.deepEqual(bench.appliedIds(defects, root), [id]);
  await seed(id, 'r10');
  assert.equal(status(), '');
  execFileSync('git', ['apply', defects[0].patch], { cwd: root });
  assert.equal((await bench.defect({ id, op: 'revert', defects, root })).org, 'x', 'a revert says which org to deploy');
  assert.equal(status(), '');
  assert.deepEqual(bench.appliedIds(defects, root), []);
  await assert.rejects(bench.defect({ id, op: 'revert', defects, root }), /patch does not apply|Command failed/, 'a patch neither in the tree nor seeded is an error');
  // The control refuses a dirty tree too: the file is staged, so no patch check sees it.
  await bench.defect({ id, op: 'apply', defects, root });
  git('add', 'test/fixture');
  await bench.defect({ id, op: 'revert', defects, root });
  assert.deepEqual(bench.appliedIds(defects, root), []);
  await assert.rejects(seed('none', 'r11'), /uncommitted changes/);
  git('reset', '-q', '--hard');
  // A state file that cannot be read says which one.
  fs.writeFileSync(path.join(bench.stateDir(), 'x__bad.json'), '{');
  await assert.rejects(bench.defect({ id, op: 'apply', defects, root }), /x__bad\.json/);
  fs.rmSync(path.join(bench.stateDir(), 'x__bad.json'));
  await bench.defect({ id: 'q', op: 'apply', defects, root });
  assert.equal(fs.readFileSync(file, 'utf8'), 'three\n');
});

// A held-out corpus: one file under the bench folder names an app's git tree, its defects and the requirements they break.
function corpusFixture() {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  const app = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-app-')));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: app });
  const file = path.join(app, 'force-app', 'a.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'one\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const dir = path.join(process.env.SF_TESTER_BENCH, 'key');
  fs.mkdirSync(path.join(dir, 'patches'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'patches', 'h01.patch'), 'diff --git a/force-app/a.txt b/force-app/a.txt\n--- a/force-app/a.txt\n+++ b/force-app/a.txt\n@@ -1 +1 @@\n-one\n+two\n');
  const corpusFile = path.join(dir, 'corpus.json');
  fs.writeFileSync(corpusFile, JSON.stringify({ root: app, defects: [{ id: 'h01', target: 'h01', expected: 'FAIL', kind: 'patch', patch: 'patches/h01.patch' }],
    targets: [{ id: 'h01', task: 'Val Viewer sees the Price on a property.', app: 'Dreamhouse' }] }));
  return { app, file, corpusFile, dir };
}

test('a corpus file gives the app root, its defects with patch paths beside it and its targets; outside the bench folder it is refused', () => {
  const { app, corpusFile, dir } = corpusFixture();
  const c = bench.loadCorpus(corpusFile);
  assert.equal(c.root, app);
  assert.equal(c.spec, '.', 'the clean check covers the whole app tree');
  assert.equal(fs.realpathSync(c.defects[0].patch), fs.realpathSync(path.join(dir, 'patches', 'h01.patch')), 'a patch path resolves against the corpus file');
  assert.deepEqual(c.targets.map((t) => [t.id, t.status, t.needs.length]), [['h01', 'tested', 0]], 'a target makes no records and counts as tested');
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-out-')), 'corpus.json');
  fs.copyFileSync(corpusFile, outside);
  assert.throws(() => bench.loadCorpus(outside), /outside the bench folder/, 'a tester could read a key there');
  // The guard judges real paths, so a link in the bench folder to a file outside it is outside too.
  fs.symlinkSync(outside, path.join(dir, 'linked.json'));
  assert.throws(() => bench.loadCorpus(path.join(dir, 'linked.json')), /outside the bench folder/, 'a linked file is where it really is');
  // A patch is the key too: one outside the folder, by an absolute or a ../ path, is refused.
  const body = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  for (const p of [path.join(path.dirname(outside), 'h01.patch'), '../../h01.patch']) {
    fs.writeFileSync(path.join(dir, 'moved.json'), JSON.stringify({ ...body, defects: [{ ...body.defects[0], patch: p }] }));
    assert.throws(() => bench.loadCorpus(path.join(dir, 'moved.json')), /h01 patch .* is outside the bench folder/, p);
    // A revert is the way out, so it still loads such a corpus: the patch is read, not handed to a tester.
    assert.equal(bench.loadCorpus(path.join(dir, 'moved.json'), { patches: false }).defects[0].id, 'h01', `${p}, revert`);
  }
});

test('cliOk reads a --corpus it is given: a user defect there needs --org', () => {
  const { corpusFile, dir } = corpusFixture();
  const body = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  const f = path.join(dir, 'user.json');
  fs.writeFileSync(f, JSON.stringify({ ...body, defects: [{ id: 'u1', target: 'h01', expected: 'FAIL', kind: 'user', user: { field: 'LanguageLocaleKey', value: 'de' } }] }));
  const ok = (...a) => bench.cliOk('defect', bench.parseArgs(a));
  assert.equal(ok('--id', 'u1', '--apply', '--corpus', f), false);
  assert.equal(ok('--id', 'u1', '--apply', '--corpus', f, '--org', 'x'), true);
});

test('the command line lets a revert load a corpus whose patch sits outside the bench folder, and refuses an apply', () => {
  const { app, file, corpusFile, dir } = corpusFixture();
  const body = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  const outside = path.resolve(dir, '../../h01.patch'); // beside the bench folder, outside the guard
  fs.copyFileSync(path.join(dir, 'patches', 'h01.patch'), outside);
  fs.writeFileSync(path.join(dir, 'moved.json'), JSON.stringify({ ...body, defects: [{ ...body.defects[0], patch: '../../h01.patch' }] }));
  const cli = (op) => spawnSync('node', [path.join(__dirname, '..', 'bench', 'bench.js'), 'defect', '--id', 'h01', op, '--corpus', path.join(dir, 'moved.json')], { encoding: 'utf8', env: { ...process.env } });
  assert.match(cli('--apply').stderr, /outside the bench folder/);
  // Applied by hand, as before the check existed: the revert is the way out, and it works.
  execFileSync('git', ['apply', outside], { cwd: app });
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n', 'control: the patch is in the tree');
  const revert = cli('--revert');
  assert.equal(revert.status, 0, revert.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n', 'the revert took the patch out');
});

test('on a corpus, defect and seed work on its app root: the whole tree must be clean, and the cells are its targets', async () => {
  const { app, file, corpusFile } = corpusFixture();
  const c = bench.loadCorpus(corpusFile);
  const call = async () => ({ id: '001x' });
  await bench.defect({ id: 'h01', op: 'apply', ...c });
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');
  // B, C and E give a route, and a corpus target has none until a run saves one: refused before the tree is touched.
  await assert.rejects(bench.seed({ org: 'x', run: 'hb', n: 1, arms: ['A', 'C'], defect: 'h01', call, instanceUrl: 'https://x.test', ...c }), /arms C give a route, and h01 has none/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n', 'the refused seed left the patch in place');
  assert.equal(fs.existsSync(bench.runDir('hb')), false, 'and wrote no brief');
  const r = await bench.seed({ org: 'x', run: 'h', n: 1, arms: ['A', 'D'], defect: 'h01', call, instanceUrl: 'https://x.test', ...c });
  assert.match(r.reverted, /^h01: reverted/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n', 'seed took the patch out of the app tree');
  const { cells } = JSON.parse(fs.readFileSync(path.join(bench.runDir('h'), 'cells.json'), 'utf8'));
  assert.deepEqual(cells.map((x) => [x.cell, x.defect, x.expected, x.records.length]), [['h01/A1', 'h01', 'FAIL', 0], ['h01/D1', 'h01', 'FAIL', 0]]);
  assert.match(fs.readFileSync(cells[0].brief, 'utf8'), /^Requirement: Val Viewer sees the Price on a property\.$/m);
  assert.match(fs.readFileSync(cells[0].brief, 'utf8'), /^App: Dreamhouse$/m);
  // Its state blocks every later apply, so a revert without the corpus says what is missing.
  await assert.rejects(bench.defect({ id: 'h01', op: 'revert' }), /no defect h01 in this list, but .*h01\.json names it: revert it with the defects it was applied with \(its --corpus, or none\)/);
  await bench.defect({ id: 'h01', op: 'revert', ...c });
  // A corrupt state file does not hide a mistyped id behind its own parse error.
  fs.writeFileSync(path.join(bench.stateDir(), 'x__other.json'), '{');
  await assert.rejects(bench.defect({ id: 'h1', op: 'apply', ...c }), /no defect h1; known: h01.*; unreadable state: .*x__other\.json/);
  // and it does not hide a readable state that names the id.
  fs.writeFileSync(path.join(bench.stateDir(), 'x__h09.json'), JSON.stringify({ id: 'h09', org: 'x' }));
  await assert.rejects(bench.defect({ id: 'h09', op: 'revert', ...c }), /no defect h09 in this list, but .*x__h09\.json names it/);
  fs.rmSync(path.join(bench.stateDir(), 'x__h09.json'));
  fs.rmSync(path.join(bench.stateDir(), 'x__other.json'));
  // Outside test/fixture counts on an app tree: an untracked file anywhere in it refuses an apply and the control.
  fs.writeFileSync(path.join(app, 'stray.txt'), 'x\n');
  await assert.rejects(bench.defect({ id: 'h01', op: 'apply', ...c }), /uncommitted changes/);
  await assert.rejects(bench.seed({ org: 'x', run: 'h2', n: 1, arms: ['A'], defect: 'none', call, instanceUrl: 'https://x.test', ...c }), /uncommitted changes/);
  fs.rmSync(path.join(app, 'stray.txt'));
  const none = await bench.seed({ org: 'x', run: 'h3', n: 1, arms: ['A'], defect: 'none', call, instanceUrl: 'https://x.test', ...c });
  assert.equal(none.entries, 1, 'the control runs on the corpus targets, not the catalogue');
});

test('one defect at a time across kinds: a user defect blocks a patch apply and a patch blocks a user apply', async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  const { root, file, patch } = fixtureRepo();
  const f = patch('p.patch', 'two');
  const defects = [{ id: 'p', kind: 'patch', patch: f }, { id: 'u', kind: 'user', user: { field: 'F', value: 'x' } }];
  // A run named defects keeps its cells.json in the same folder; it is not a user defect's state.
  fs.mkdirSync(bench.runDir('defects'), { recursive: true });
  fs.writeFileSync(path.join(bench.runDir('defects'), 'cells.json'), '{}');
  const user = { F: 'a' };
  const call = async (p, init = {}) => (p.startsWith('/query') ? { records: [{ Id: '005X', F: user.F }] } : init.method === 'PATCH' ? Object.assign(user, JSON.parse(init.body)) && null : { F: user.F });
  await bench.defect({ id: 'u', op: 'apply', org: 'o', call, username, defects, root });
  await assert.rejects(bench.defect({ id: 'p', op: 'apply', defects, root }), /a defect is applied/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n');
  await bench.defect({ id: 'u', op: 'revert', org: 'o', call, username, defects, root });
  await bench.defect({ id: 'p', op: 'apply', defects, root });
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'o', call, username, defects, root }), /uncommitted changes/);
  assert.equal(user.F, 'a', 'the refused user apply changed nothing');
});

test('defect on a user keeps the old value, restores it on revert and refuses a second apply', async () => {
  process.env.SF_TESTER_BENCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-defect-'));
  const { root } = fixtureRepo();
  const defects = [{ id: 'u', kind: 'user', user: { field: 'LanguageLocaleKey', value: 'de' } }];
  const calls = [];
  // A fake User: a PATCH sets the field unless `stuck`, a GET of the record reads it, and `gone` makes the record a 404.
  const user = { LanguageLocaleKey: 'en_US', stuck: false, gone: false };
  const call = async (p, init = {}) => {
    calls.push([init.method || 'GET', p, init.body]);
    if (p.startsWith('/query')) return { records: [{ Id: '005X', LanguageLocaleKey: user.LanguageLocaleKey }] };
    if (init.method === 'PATCH') { if (!user.stuck) Object.assign(user, JSON.parse(init.body)); return null; }
    return user.gone ? null : { LanguageLocaleKey: user.LanguageLocaleKey };
  };
  const a = await bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call, username, defects, root });
  assert.deepEqual([a.old, a.value], ['en_US', 'de']);
  assert.deepEqual(calls.at(-1), ['PATCH', '/sobjects/User/005X', '{"LanguageLocaleKey":"de"}']);
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call, username, defects, root }), /already applied/);
  const r = await bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root });
  assert.equal(r.restored, 'en_US');
  assert.equal(user.LanguageLocaleKey, 'en_US');
  await assert.rejects(bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root }), /is not applied/);
  // The state is keyed by org: a revert on another org finds nothing and writes nothing.
  await bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call, username, defects, root });
  const before = calls.length;
  await assert.rejects(bench.defect({ id: 'u', op: 'revert', org: 'other', call, username, defects, root }), /is not applied on other/);
  assert.equal(calls.length, before);
  // The state goes only when the field reads back as the old value: a stuck PATCH and a 404 both keep it.
  user.stuck = true;
  await assert.rejects(bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root }), /reads de after the restore, expected en_US/);
  user.stuck = false; user.gone = true;
  await assert.rejects(bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root }), /reads undefined after the restore/);
  user.gone = false;
  assert.equal((await bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root })).restored, 'en_US', 'the revert on the org that applied it restores');
  const failing = async (p, init) => { if (init) throw new Error('PATCH 400'); return call(p, init); };
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call: failing, username, defects, root }), /PATCH 400/);
  // The PATCH that failed changed nothing: no state is left, so the next apply goes through.
  await bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call, username, defects, root });
  await bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root });
  // A PATCH that lands and then reports an error, or whose field cannot be read, keeps the old value on disk.
  const landed = async (p, init) => { if (init?.method === 'PATCH') { await call(p, init); throw new Error('timeout'); } return call(p, init); };
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call: landed, username, defects, root }), /timeout/);
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call, username, defects, root }), /already applied/, 'the state of a landed PATCH is kept');
  await bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root });
  const blind = async (p, init) => { if (init) throw new Error('PATCH 500'); if (p.includes('fields=')) throw new Error('GET 500'); return call(p, init); };
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call: blind, username, defects, root }), /PATCH 500/);
  await assert.rejects(bench.defect({ id: 'u', op: 'apply', org: 'owner@x.test', call, username, defects, root }), /already applied/, 'an unreadable field keeps the state');
  // The state file is named for the org, injectively: fx-1 and fx_1 never share one.
  await bench.defect({ id: 'u', op: 'revert', org: 'owner@x.test', call, username, defects, root });
  await bench.defect({ id: 'u', op: 'apply', org: 'fx-1', call, username, defects, root });
  const m = calls.length;
  await assert.rejects(bench.defect({ id: 'u', op: 'revert', org: 'fx_1', call, username, defects, root }), /is not applied on fx_1/);
  assert.equal(calls.length, m, 'the other alias made no call');
  // A state file under the wrong org's name still cannot send a restore there: the saved org is compared first.
  const dir = bench.stateDir();
  fs.copyFileSync(path.join(dir, 'fx-1__u.json'), path.join(dir, 'fx_1__u.json'));
  await assert.rejects(bench.defect({ id: 'u', op: 'revert', org: 'fx_1', call, username, defects, root }), /applied on fx-1, not fx_1/);
  assert.equal(calls.length, m, 'a mismatched file made no call');
  fs.rmSync(path.join(dir, 'fx_1__u.json'));
  await bench.defect({ id: 'u', op: 'revert', org: 'fx-1', call, username, defects, root });
  assert.ok(fs.existsSync(dir) && !fs.readdirSync(dir).length, 'the state is kept beside the bench dir and is empty again after the revert');
  assert.ok(!dir.startsWith(bench.runDir('defects')), 'the state folder is not a run folder');
  // A user defect cannot find its user without the org, on apply or on revert; the API is not touched.
  const n = calls.length;
  for (const op of ['apply', 'revert']) await assert.rejects(bench.defect({ id: 'u', op, call, username, defects, root }), /--org is required/);
  assert.equal(calls.length, n);
});

test('every shipped patch defect still applies to the fixture', { skip: realDirty }, () => {
  const root = path.join(__dirname, '..');
  const patches = bench.corpus().filter((d) => d.kind === 'patch');
  assert.ok(patches.length, 'the corpus has patch defects to check');
  assert.deepEqual(bench.corpus().map((d) => d.id), ['visibility-rule', 'layout-field-removed', 'overlay-over-status', 'tab-renamed', 'non-english-user'], 'the corpus is the spec\'s five');
  for (const d of patches) {
    assert.doesNotThrow(() => execFileSync('git', ['apply', '--check', path.join(root, 'bench', d.patch)], { cwd: root, stdio: 'pipe' }), `${d.id} no longer applies to test/fixture`);
  }
});

test('the command line needs exactly one of --apply and --revert for a defect, and --org for a user defect', () => {
  const ok = (cmd, ...a) => bench.cliOk(cmd, bench.parseArgs(a));
  assert.equal(ok('defect', '--id', 'visibility-rule', '--apply'), true);
  assert.equal(ok('defect', '--id', 'visibility-rule', '--revert'), true);
  assert.equal(ok('defect', '--id', 'visibility-rule'), false);
  assert.equal(ok('defect', '--id', 'visibility-rule', '--apply', '--revert'), false);
  assert.equal(ok('defect', '--id', 'visibility-rule', '--run', 'r'), false, 'a stray --run is not a way past the check');
  assert.equal(ok('defect', '--apply'), false);
  assert.equal(ok('defect', '--id', 'non-english-user', '--apply'), false, 'a user defect needs --org');
  assert.equal(ok('defect', '--id', 'non-english-user', '--revert'), false);
  assert.equal(ok('defect', '--id', 'non-english-user', '--apply', '--org', 'fx'), true);
  assert.equal(ok('seed', '--run', 'r', '--org', 'fx'), true);
  assert.equal(ok('seed', '--run', 'r'), false, 'seed needs --org');
  assert.equal(ok('metrics', '--run', 'r', '--transcripts', 'd'), true);
  assert.equal(ok('metrics', '--run', 'r'), false, 'metrics needs --transcripts');
  assert.equal(ok('cleanup', '--run', 'r'), true);
  assert.deepEqual(bench.parseArgs(['--id', 'x', '--apply', '--org', 'y']), { id: 'x', apply: true, org: 'y' }, 'a flag takes no value, so the option after it is read');
  assert.equal(ok('seed'), false);
  assert.equal(ok('auth', '--org', 'fx', '--out', 'f'), true);
  assert.equal(ok('auth', '--run', 'r'), false);
  assert.equal(ok('nope', '--run', 'r'), false);
  assert.deepEqual(bench.parseArgs(['--n', '3', '--run', 'r']), { n: '3', run: 'r' });
});

test('the command line rejects an unknown option, a missing or empty value, and a bad --n, with a message and exit 2', () => {
  const bad = (args, re) => assert.throws(() => bench.parseArgs(args), re, args.join(' '));
  bad(['--aply'], /Unknown option/);
  bad(['--id', 'x', '--aply', '--org', 'y'], /Unknown option/);
  bad(['--defect'], /argument missing/);
  bad(['--defect', '--org', 'fx'], /--defect/);
  bad(['--defect', ''], /--defect needs a value/);
  bad(['--only', ''], /--only needs a value/);
  bad(['--arms', ''], /--arms needs a value/);
  for (const n of ['abc', '0', '-1', '2.5', '']) bad(['--n', n], /--n/);
  bad(['stray'], /Unexpected argument/);
  // The command itself: exit 2 and the reason, before any org is touched.
  const cli = (...a) => spawnSync('node', [path.join(__dirname, '..', 'bench', 'bench.js'), ...a], { encoding: 'utf8' });
  for (const [args, re] of [[['seed', '--org', 'fx', '--run', 'r', '--n', 'abc'], /--n must be a positive integer/], [['seed', '--org', 'fx', '--run', 'r', '--defect'], /argument missing/], [['defect', '--id', 'x', '--aply'], /Unknown option/]]) {
    const r = cli(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, re);
    assert.match(r.stderr, /usage: bench\.js/);
  }
  assert.equal(cli('seed', '--run', 'r').status, 2, 'a missing --org is a usage error');
  // A corpus that cannot be loaded is a one-line message and exit 1, as every other error, never a stack trace.
  for (const args of [['defect', '--id', 'h01', '--apply', '--corpus', path.join(os.tmpdir(), 'nope', 'corpus.json')], ['seed', '--org', 'x', '--run', 'r', '--arms', 'A', '--corpus', path.join(os.tmpdir(), 'corpus.json')]]) {
    const r = cli(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /outside the bench folder/, args[0]);
    assert.doesNotMatch(r.stderr, /^\s+at /m, `${args[0]}: no stack trace`);
  }
  // Only seed and defect read a corpus: another command ignores the flag, and an unknown command is still a usage error.
  const stray = path.join(os.tmpdir(), 'corpus.json');
  assert.doesNotMatch(cli('metrics', '--run', 'nope', '--transcripts', os.tmpdir(), '--corpus', stray).stderr, /outside the bench folder/);
  assert.equal(cli('bogus', '--corpus', stray).status, 2);
});

// The testers a seed's arms start, as installed: each must run agents/guard.js, or its testers can read the answer key.
test('unguarded names each installed tester agent of the arms that runs no guard', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(__dirname, '..');
  assert.deepEqual(bench.unguarded(['A', 'D'], dir), ['sf-tester', 'pw-tester'], 'neither installed');
  fs.symlinkSync(path.join(repo, 'agents', 'sf-tester.md'), path.join(dir, 'sf-tester.md'));
  fs.symlinkSync(path.join(repo, 'bench', 'pw-tester.md'), path.join(dir, 'pw-tester.md'));
  assert.deepEqual(bench.unguarded(['A', 'B', 'C', 'D', 'E'], dir), [], 'both linked from a checkout with the guard');
  assert.deepEqual(bench.unguarded(['A'], path.join(dir, 'none')), ['sf-tester'], 'only the agents the arms use');
  assert.deepEqual(bench.unguarded(['A', 'F'], dir), ['arm F (no such arm)'], 'an arm with no tester agent');
  // A copy finds no guard beside it, and an agent file from before the guard wires none.
  fs.rmSync(path.join(dir, 'sf-tester.md'));
  fs.copyFileSync(path.join(repo, 'agents', 'sf-tester.md'), path.join(dir, 'sf-tester.md'));
  assert.deepEqual(bench.unguarded(['A'], dir), ['sf-tester'], 'a copy');
  fs.rmSync(path.join(dir, 'pw-tester.md'));
  fs.mkdirSync(path.join(dir, 'old', 'bench'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'old', 'agents'));
  fs.writeFileSync(path.join(dir, 'old', 'agents', 'guard.js'), '');
  fs.writeFileSync(path.join(dir, 'old', 'bench', 'pw-tester.md'), '---\nname: pw-tester\ntools: Read\n---\n');
  fs.symlinkSync(path.join(dir, 'old', 'bench', 'pw-tester.md'), path.join(dir, 'pw-tester.md'));
  assert.deepEqual(bench.unguarded(['D'], dir), ['pw-tester'], 'a file that wires no hook');
  // G's Bash reaches any file, so its agent must also run the sf read guard before every Bash call.
  fs.symlinkSync(path.join(repo, 'bench', 'pw-tester-cli.md'), path.join(dir, 'pw-tester-cli.md'));
  assert.deepEqual(bench.unguarded(['G'], dir), [], 'linked from a checkout with both guards');
  fs.rmSync(path.join(dir, 'pw-tester-cli.md'));
  const text = fs.readFileSync(path.join(repo, 'bench', 'pw-tester-cli.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'old', 'bench', 'pw-tester-cli.md'), text.replace(/\n {4}- matcher: "Bash"[\s\S]*?\|\| exit 2'/, ''));
  fs.symlinkSync(path.join(dir, 'old', 'bench', 'pw-tester-cli.md'), path.join(dir, 'pw-tester-cli.md'));
  assert.deepEqual(bench.unguarded(['G'], dir), ['pw-tester-cli'], 'Bash with no sf read guard');
});

// A tester's guard protects ~/.sf-tester/bench, so a seed or a defect apply under a moved folder is refused before any org is touched.
test('seed and defect --apply refuse a bench folder the tester guard does not cover', (t) => {
  const env = { ...process.env };
  delete env.SF_TESTER_BENCH;
  const cli = (args, e) => spawnSync('node', [path.join(__dirname, '..', 'bench', 'bench.js'), ...args], { encoding: 'utf8', env: e });
  const moved = { ...env, SF_TESTER_BENCH: os.tmpdir() };
  for (const args of [['seed', '--org', 'x', '--run', 'r'], ['defect', '--id', 'non-english-user', '--apply', '--org', 'x']]) {
    const r = cli(args, moved);
    assert.equal(r.status, 1, args[0]);
    assert.match(r.stderr, /SF_TESTER_BENCH/);
  }
  // A revert is the way out, so it is never refused: it fails only on the missing state file.
  assert.doesNotMatch(cli(['defect', '--id', 'non-english-user', '--revert', '--org', 'x'], moved).stderr, /SF_TESTER_BENCH/);
  assert.match(cli(['seed', '--org', 'x', '--run', 'r', '--arms', 'A,F'], env).stderr, /no such arm F: the arms are A, B, C, D, E/);
  // A seed whose testers, as installed, run no guard is refused before any org is touched.
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-cfg-'));
  t.after(() => fs.rmSync(cfg, { recursive: true, force: true }));
  const bare = cli(['seed', '--org', 'x', '--run', 'r', '--arms', 'A'], { ...env, CLAUDE_CONFIG_DIR: cfg });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /testers can read the answer key: sf-tester/);
  // The default folder spelled out is not a move: a defect apply goes on to its own check (an unknown id), not this one.
  assert.doesNotMatch(cli(['defect', '--id', 'nope', '--apply', '--org', 'x'], { ...env, SF_TESTER_BENCH: path.join(os.homedir(), '.sf-tester', 'bench') }).stderr, /SF_TESTER_BENCH/);
});

// No org: a preload stands in for the org, so its Organization row decides; a start that is reached says so.
test('the bench stops on a production org before any write or login', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-bench-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (row, ...args) => {
    const preload = path.join(dir, 'org.js');
    fs.writeFileSync(preload, `const { session } = require(${JSON.stringify(path.join(__dirname, '..'))});
session.fromAlias = async () => ({ instanceUrl: 'http://x', accessToken: 't' });
session.start = async () => { throw new Error('REACHED start'); };
globalThis.fetch = async (url, init = {}) => { if (init.method) console.error('REACHED write'); return new Response(JSON.stringify({ records: [${JSON.stringify(row)}] })); };`);
    return spawnSync(process.execPath, ['-r', preload, path.join(__dirname, '..', 'bench', 'bench.js'), ...args], { encoding: 'utf8' }).stderr;
  };
  const production = { IsSandbox: false, TrialExpirationDate: null, OrganizationType: 'Enterprise Edition' };
  const auth = ['auth', '--org', 'prod', '--out', path.join(dir, 'state.json')];
  const stopped = run(production, ...auth);
  assert.match(stopped, /prod is a production org/);
  assert.doesNotMatch(stopped, /REACHED/);
  assert.match(run({ IsSandbox: true }, ...auth), /REACHED start/, 'control: a sandbox goes on');
});
