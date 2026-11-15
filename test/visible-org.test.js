'use strict';

// The visibility evaluator scored against what the browser renders, for persona x record state x target on the gate page.
// It logs in as the platform user and assigns the gate and probe sets, so run it alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { session, api } = require('..');
const verify = require('../src/verify');
const { auth, env, skip, record } = require('./helpers');

const FIXTURE = path.join(__dirname, 'fixture');
const NOTE = 'Note';
// How many cells the evaluator may hand off: the fixture gives it every input.
const EXPECTED_UNKNOWN = 0;
// Level x Note: High, Low and unset levels, with the Note set, set to another value and unset.
const STATES = [['High', null], ['High', 'x'], ['High', 'y'], ['Low', null], ['Low', 'y'], [null, 'y'], [null, null]];
// text: the words a richText component shows, so it is told apart on the page. The gateCmp components have a rule of their own on
// Level__c, NE zzz (true for null) and EQUAL High (false for null); the gateTabBody ones have none and sit in a tab with that rule.
const TARGETS = [{ action: 'Edit' }, { action: 'Delete' }, { action: 'Clone' }, { field: 'Note__c' }, { component: 'c:sfUiMore' },
  { component: 'gateCmpNe', text: 'GATE-CMP-NE' }, { component: 'gateCmpEq', text: 'GATE-CMP-EQ' },
  { component: 'gateTabBodyNe', text: 'GATE-TAB-NE' }, { component: 'gateTabBodyEq', text: 'GATE-TAB-EQ' }];

// What the page shows: the highlights panel's action buttons, the Note label, the gated card. A page the persona cannot open shows nothing.
async function rendered(s, blank) {
  if (blank) {
    await s.page.getByRole('main').waitFor();
    await s.page.waitForTimeout(5_000);
  } else {
    await s.page.locator('records-highlights2 button[name="Edit"]').first().waitFor({ state: 'visible', timeout: 30_000 });
    await s.page.waitForTimeout(2_500);
  }
  const actions = await s.page.locator('records-highlights2 button[name]').evaluateAll((bs) => bs.map((b) => b.getAttribute('name')));
  const texts = {};
  for (const t of TARGETS.filter((x) => x.text)) texts[t.text] = await s.page.getByText(t.text, { exact: true }).first().isVisible().catch(() => false);
  return { actions, texts, field: await s.page.getByText(NOTE, { exact: true }).first().isVisible().catch(() => false), component: await s.page.locator('c-sf-ui-more').first().isVisible().catch(() => false) };
}

const SETS = ['SfUi_Gate_Access', 'SfUi_Gate_Full', 'SfUi_Gate_NoteOnly', 'SfUi_Probe'];
const ADMIN = 'System Administrator';
const USER = 'Standard Platform User';
// as: whose session renders it. The admin without the gate set has no FLS on the gate fields.
const PERSONAS = [
  { who: 'admin', as: 'admin', persona: { profile: ADMIN, permissionSets: ['SfUi_Gate_Access', 'SfUi_Gate_Full', 'SfUi_Probe'] } },
  { who: 'admin without FLS', as: 'admin', persona: { profile: ADMIN, permissionSets: ['SfUi_Probe'] } },
  { who: 'user', as: 'user', persona: { profile: USER, permissionSets: ['SfUi_Gate_Access', 'SfUi_Probe'] } },
  { who: 'user with FLS on Note only', as: 'user', persona: { profile: USER, permissionSets: ['SfUi_Gate_NoteOnly', 'SfUi_Probe'] } },
  { who: 'user without object access', as: 'user', persona: { profile: USER, permissionSets: ['SfUi_Probe_Read'] }, blank: true, states: 2 },
];

test('visibility evaluator against the rendered gate page', { skip, timeout: 1_800_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const rest = async (soql) => (await api.call(s, `/query?q=${encodeURIComponent(soql)}`, { as: 'admin' })).records;
  const users = { admin: (await rest(`SELECT Id FROM User WHERE Username = '${(await session.aliasUsername(env.org)).replace(/'/g, '')}'`))[0].Id, user: (await rest(`SELECT Id FROM User WHERE Username = '${env.user}'`))[0].Id };
  const sets = Object.fromEntries((await rest(`SELECT Id, Name FROM PermissionSet WHERE Name IN (${SETS.map((x) => `'${x}'`).join(',')})`)).map((r) => [r.Name, r.Id]));
  // Exactly the persona's gate sets, so the page is rendered for the persona the evaluator was given.
  const assign = async (who, wanted) => {
    const have = await rest(`SELECT Id, PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId = '${users[who]}' AND PermissionSet.Name IN (${SETS.map((x) => `'${x}'`).join(',')})`);
    for (const h of have) if (!wanted.includes(h.PermissionSet.Name)) await api.call(s, `/sobjects/PermissionSetAssignment/${h.Id}`, { method: 'DELETE', as: 'admin' });
    for (const name of wanted) if (!have.some((h) => h.PermissionSet.Name === name)) await api.call(s, '/sobjects/PermissionSetAssignment', { method: 'POST', as: 'admin', body: { AssigneeId: users[who], PermissionSetId: sets[name] } });
  };
  // The admin writes the records, so it holds the gate sets while it does, and again when the test ends.
  const full = PERSONAS[0].persona.permissionSets;
  await assign('admin', full);
  t.after(() => assign('admin', full));
  const ids = [];
  for (const [level, note] of STATES) ids.push(await record(s, t, 'SfUiGate__c', { Name: `calibrate ${level}/${note}`, ...(level && { Level__c: level }), ...(note && { Note__c: note }) }));
  const proj = { root: FIXTURE, dirs: ['force-app'], namespace: null };
  const cases = STATES.map(([level, note], i) => ({ name: String(i), record: { Level__c: level, Note__c: note }, expect: { visible: true } }));
  const cells = [];
  let loggedIn = false;
  for (const { who, as, persona, blank, states = STATES.length } of PERSONAS) {
    await assign(as, persona.permissionSets.filter((x) => SETS.includes(x)));
    if (as === 'user' && !loggedIn) { await session.loginAs(s, users.user); loggedIn = true; }
    const verdicts = {};
    for (const target of TARGETS) {
      const { text, ...named } = target;
      const check = { id: 'x', kind: 'componentVisible', persona, object: 'SfUiGate__c', app: 'SfUi_App', flexiPage: 'SfUi_Gate_Record_Page', component: 'force:highlightsPanel', ...named, cases };
      verdicts[JSON.stringify(target)] = (await verify.visibleVerdicts(check, { s, api, proj })).rows.map((r) => r.got);
    }
    for (let i = 0; i < states; i++) {
      await s.page.goto(`${s.origin}/lightning/r/SfUiGate__c/${ids[i]}/view`);
      const seen = await rendered(s, blank);
      for (const target of TARGETS) {
        const shown = target.text ? seen.texts[target.text] : target.action ? seen.actions.includes(target.action) : target.field ? seen.field : seen.component;
        cells.push({ who, state: STATES[i], target, evaluated: verdicts[JSON.stringify(target)][i], shown });
      }
    }
  }
  const unknown = cells.filter((c) => c.evaluated === 'UNKNOWN');
  const matched = cells.filter((c) => c.evaluated === c.shown);
  console.log(`checked ${cells.length}, matched ${matched.length}, unknown ${unknown.length}`);
  for (const target of TARGETS) { const mine = cells.filter((c) => c.target === target); console.log(`${JSON.stringify(target)}: checked ${mine.length}, matched ${mine.filter((c) => c.evaluated === c.shown).length}, shown ${mine.filter((c) => c.shown).length}`); }
  for (const { who } of PERSONAS) { const mine = cells.filter((c) => c.who === who); console.log(`${who}: checked ${mine.length}, matched ${mine.filter((c) => c.evaluated === c.shown).length}, unknown ${mine.filter((c) => c.evaluated === 'UNKNOWN').length}, shown ${mine.filter((c) => c.shown).length}`); }
  // An UNKNOWN is a hand-off, never a mismatch; a definite answer must agree with the page.
  assert.deepEqual(cells.filter((c) => c.evaluated !== 'UNKNOWN' && c.evaluated !== c.shown).map((c) => [c.who, c.state, c.target, c.evaluated, c.shown]), []);
  // But UNKNOWN is bounded: an evaluator that gives up on every cell would match the page vacuously. None of these cells is undecidable.
  assert.equal(unknown.length, EXPECTED_UNKNOWN, `${unknown.length} of ${cells.length} cells are UNKNOWN`);
  // The cases must disagree with each other, or a constant answer would match everything.
  assert.ok(cells.some((c) => c.shown) && cells.some((c) => !c.shown));
});
