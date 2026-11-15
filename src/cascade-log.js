'use strict';

const { unxml, esc } = require('./xml');

// The cascade: what ran in a test, read from its debug log. Event names are from real logs saved off a scratch org
// (test/cascade-samples), not from the docs. A log is one pipe-separated line per event: time (nanos)|EVENT|...
const EVENT = /^\d[\d:.]* \(\d+\)\|([A-Z_]+)\|?(.*)$/;
// The platform's own marks that it dropped detail; "*** Skipped 5997715 bytes of detailed log" was measured 2026-11-11.
const CUT = /MAXIMUM DEBUG LOG SIZE REACHED|\*\*\* Skipped \d+ bytes of detail/;

// A list entry once: a flow or trigger that fires on two DMLs is one automation, not two.
const once = (list, x) => { if (!list.some((y) => JSON.stringify(y) === JSON.stringify(x))) list.push(x); };

// The size the check-only validate returns at most: past it the text just stops (measured 2026-11-11, 1,048,576 bytes).
const LIMIT = 1048576;

// Each test (a 01p code unit of self) with the triggers, flows, rules and classes that ran in it, self left out.
// A test is partial without its own EXECUTION_FINISHED or with a cut mark inside it, never for a cut elsewhere.
function parseLog(text, self) {
  const tests = {};
  let cur = null;
  let depth = 0;
  let rule = null;
  let sawCut = false;
  for (const line of text.split(/\r?\n/)) {
    // After a cut nothing is the open test's for sure: the skipped bytes may hold its end and the next test's start.
    if (CUT.test(line)) { cur = null; sawCut = true; continue; }
    const m = EVENT.exec(line);
    if (!m) continue;
    const [, ev, rest] = m;
    const f = rest.split('|');
    if (ev === 'EXECUTION_STARTED') depth++;
    else if (ev === 'EXECUTION_FINISHED') { if (--depth <= 0) { if (cur) cur.partial = false; cur = null; depth = 0; } }
    else if (ev === 'CODE_UNIT_STARTED') {
      // Only self's own methods start a test, keyed without a namespace; a queueable run at stopTest stays inside it.
      // A test starts one level in, whatever a cut before it left open.
      const m = f[1]?.startsWith('01p') && /^(?:\w+\.)?(\w+\.\w+)\(\)$/.exec(f[2] ?? '');
      if (m && m[1].startsWith(`${self}.`)) { cur = tests[m[1]] ??= { triggers: [], flows: [], rules: [], classes: [], partial: true }; depth = 1; continue; }
      const t = f[1]?.startsWith('01q') && /^(\S+) on (\S+) trigger event (\w+)/.exec(f[2]);
      if (t && cur) once(cur.triggers, { name: t[1], object: t[2], event: t[3] });
    } else if (!cur) continue;
    else if (ev === 'FLOW_START_INTERVIEW_BEGIN') once(cur.flows, f[1]);
    else if (ev === 'VALIDATION_RULE') { rule = { name: f[1] }; }
    else if ((ev === 'VALIDATION_PASS' || ev === 'VALIDATION_FAIL') && rule) { once(cur.rules, { name: rule.name, result: ev.slice(11) }); rule = null; }
    else if (ev === 'METHOD_ENTRY' && f[1]?.startsWith('01p')) {
      const klass = f[2].replace(/\.[^.(]+\(.*$/, '');
      if (klass.split('.').pop() !== self) once(cur.classes, klass);
    }
  }
  return { tests, truncated: Object.values(tests).some((t) => t.partial) || sawCut || Buffer.byteLength(text) >= LIMIT };
}

// The zip the Metadata API takes, { 'package.xml': Buffer, ... }, written by the yazl that playwright-core already ships.
function zip(files) {
  const { yazl } = require('playwright-core/lib/zipBundle');
  const z = new yazl.ZipFile();
  // yazl raises its own errors on the ZipFile, not on its stream: both are heard before end(), which can emit at once.
  const done = new Promise((resolve, reject) => {
    const parts = [];
    z.on('error', reject);
    z.outputStream.on('data', (b) => parts.push(b)).on('end', () => resolve(Buffer.concat(parts))).on('error', reject);
  });
  for (const [name, data] of Object.entries(files)) z.addBuffer(data, name);
  z.end();
  return done;
}

// SOAP XML as plain objects: a repeated element is an array, a leaf its decoded text; namespaces and attributes are dropped.
// A self-closed element (xsi:nil) is null, so a ?? fallback written for sf's JSON still falls through.
function xmlObj(xml) {
  const stack = [{ kids: {}, text: '' }];
  for (const [, close, name, self, text] of xml.matchAll(/<(\/?)(?:[\w-]+:)?([\w-]+)[^>]*?(\/?)>|([^<]+)/g)) {
    if (text != null) { stack.at(-1).text += text; continue; }
    if (!close) stack.push({ kids: {}, text: '' });
    if (!close && !self) continue;
    const { kids, text: t } = stack.pop();
    const v = Object.keys(kids).length ? kids : close ? unxml(t) : null;
    const up = stack.at(-1).kids;
    up[name] = Object.hasOwn(up, name) ? [].concat(up[name], [v]) : v;
  }
  return stack[0].kids;
}

// The categories the cascade reads: METHOD_ENTRY needs Apex FINE, a flow interview Workflow FINER; the rest stay off to save the 1 MiB.
const DEBUG = [['Apex_code', 'FINE'], ['Workflow', 'FINER'], ['Validation', 'INFO']].map(([c, l]) => `<met:categories><met:category>${c}</met:category><met:level>${l}</met:level></met:categories>`).join('');
async function soapPost(s, body, { debug = false, signal } = {}) {
  const { fetchCoded } = require('./errors');
  // The session id and the test names come from outside this file, so they are escaped.
  const head = `<met:SessionHeader><met:sessionId>${esc(s.accessToken)}</met:sessionId></met:SessionHeader>${debug ? `<met:DebuggingHeader>${DEBUG}<met:debugLevel>Detail</met:debugLevel></met:DebuggingHeader>` : ''}`;
  const r = await fetchCoded(`${s.instanceUrl}/services/Soap/m/${s.orgApiVersion || s.apiVersion}`, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
    body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata"><soapenv:Header>${head}</soapenv:Header><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`, signal });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`SOAP ${r.status}: ${unxml(/<faultstring>([^<]*)/.exec(text)?.[1] ?? text.slice(0, 300)).split(s.accessToken).join('<token>')}`), { status: r.status });
  return text;
}

// The validate both routes send, verify's sf route and the SOAP one here, so the two cannot drift. sf's
// `project deploy validate` sends checkOnly, rollbackOnError and singlePackage true, as the SOAP options below do.
// testLevel can only be RunSpecifiedTests: both routes always send a test list.
const VALIDATE = { testLevel: 'RunSpecifiedTests', minutes: 30 };
// The wait between status polls; the poll count and the time limit are both built on it.
const POLL_MS = 2000;
const DETAILS_MS = 30_000;
const ATTEMPT_MS = 290_000;
const RETRY_MIN_MS = 5_000;

// A check-only deploy of files that runs tests, with the DebuggingHeader on the deploy call only (measured: the polls need
// none, and a header on a poll alone returns no log). Returns the DeployResult in sf's report shape, plus its debugLog.
async function validate({ s, files, tests, signal, post = soapPost, sleep = (ms) => require('node:timers/promises').setTimeout(ms, undefined, { signal }), polls = (VALIDATE.minutes * 60_000) / POLL_MS }) {
  const opts = `<met:checkOnly>true</met:checkOnly><met:rollbackOnError>true</met:rollbackOnError><met:singlePackage>true</met:singlePackage>${tests.map((t) => `<met:runTests>${esc(t)}</met:runTests>`).join('')}<met:testLevel>${VALIDATE.testLevel}</met:testLevel>`;
  const end = Date.now() + polls * POLL_MS;
  // Each call ends at the time limit too, so a call that hangs cannot wait out undici's 300 s per try.
  const within = () => AbortSignal.any([AbortSignal.timeout(Math.max(1, end - Date.now())), ...(signal ? [signal] : [])]);
  const late = () => new Error(`${id} did not finish in ${(polls * POLL_MS) / 1000} s`);
  const body = `<met:deploy><met:ZipFile>${(await zip(files)).toString('base64')}</met:ZipFile><met:DeployOptions>${opts}</met:DeployOptions></met:deploy>`;
  signal?.throwIfAborted();
  // Ctrl-C during the deploy call gives it 15 s more to answer, so a validate the org took has an id to cancel.
  const grace = new AbortController();
  const onStop = () => setTimeout(() => grace.abort(signal.reason), 15000).unref();
  signal?.addEventListener('abort', onStop, { once: true });
  let reply;
  try {
    reply = await post(s, body, { debug: true, signal: AbortSignal.any([grace.signal, AbortSignal.timeout(Math.max(1, end - Date.now()))]) });
  } catch (e) {
    if (signal?.aborted) throw new Error(`${e.message}; the deploy call gave no id, so a validate the org took is not cancelled`);
    throw e.name === 'TimeoutError' ? new Error(`the deploy call did not answer in ${(polls * POLL_MS) / 1000} s; a validate the org took may still run there`) : e;
  } finally { signal?.removeEventListener('abort', onStop); }
  const id = xmlObj(reply).Envelope?.Body?.deployResponse?.result?.id;
  if (!id) throw new Error('deploy answered with no id');
  // The polls skip the details; once done, one call fetches them (measured: the log comes back on every call after done).
  // A network fault (API_ERROR) or a 502, 503 or 504 on a status call is tried again, three attempts in all; a SOAP fault is final.
  // No retry starts past the time limit: a 504 comes slowly, so three of them could run minutes over it.
  // The details read after done has one deadline for its tries, the time left and at least 30 s; each try stops at 290 s,
  // under Node's 300 s fetch limit, and a retry needs 5 s left, else the fault that ended the last try is thrown.
  let due;
  const own = () => AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(ATTEMPT_MS, due - Date.now()))), ...(signal ? [signal] : [])]);
  const status = async (details) => {
    if (details) due = Date.now() + Math.max(DETAILS_MS, end - Date.now());
    for (let miss = 1; ; miss++) {
      try { return xmlObj(await post(s, `<met:checkDeployStatus><met:asyncProcessId>${id}</met:asyncProcessId><met:includeDetails>${details}</met:includeDetails></met:checkDeployStatus>`, { signal: details ? own() : within() })).Envelope; } catch (e) {
        if ((e.code !== 'API_ERROR' && ![502, 503, 504].includes(e.status)) || miss === 3 || (!details && Date.now() >= end)) throw e;
        await sleep(2000);
        if (details && due - Date.now() < RETRY_MIN_MS) throw e;
      }
    }
  };
  const result = async () => {
    const env = await status(true);
    return { ...env?.Body?.checkDeployStatusResponse?.result, debugLog: env?.Header?.DebuggingInfo?.debugLog };
  };
  // Once the org has given an id, any failure before done (Ctrl-C, a fault, the time limit) cancels its validate.
  // The cancel has its own 15 s limit, since the run's signal may be the one that fired; a failed cancel is named.
  // A validate that finished before a poll saw it makes the org refuse its cancel (measured 2026-11-12): unless the run
  // was stopped, its result is read then, since the time limit is ours, not the org's.
  const stop = async (e) => {
    let how = 'cancelled';
    try { await post(s, `<met:cancelDeploy><met:String>${id}</met:String></met:cancelDeploy>`, { signal: AbortSignal.timeout(15000) }); } catch (c) {
      if (!/Deployment already completed/.test(c.message)) how = `not cancelled: ${c.message}`;
      else if (signal?.aborted) how = 'had already finished';
      else return result().catch((r) => { throw new Error(`${e.message}; validate ${id} had already finished, and its result did not read: ${r.message}`, { cause: e }); });
    }
    throw new Error(`${e.message}; validate ${id} ${how}`, { cause: e });
  };
  let done = false;
  try {
    signal?.throwIfAborted();
    for (let i = 0; i < polls && Date.now() < end; i++) {
      if (i) await sleep(POLL_MS);
      if ((await status(false))?.Body?.checkDeployStatusResponse?.result?.done !== 'true') continue;
      done = true;
      return await result();
    }
  } catch (e) {
    if (done) throw e;
    return stop(e.name === 'TimeoutError' ? late() : e);
  }
  return stop(late());
}

// One result's line: flows, triggers, rules, then classes, each in the order its log lists them.
function line(t) {
  const parts = [...t.flows.map((f) => `flow ${f}`), ...t.triggers.map((x) => `trigger ${x.name} (${x.object} ${x.event})`), ...t.rules.map((x) => `rule ${x.name} ${x.result}`), ...t.classes.map((c) => `class ${c}`)];
  return `${parts.join('; ') || 'no trigger, flow, rule or class ran'}${t.partial ? ' (PARTIAL: the log was cut, more may have run)' : ''}`;
}

// The static map against what ran. mapped: the item keys the map named (flows/X, triggers/X, objects/O/validationRules/R);
// tests: the parsed cases; labels: flows/X to the label the log names it by. Names compare without case, spaces or underscores.
const flat = (n) => n.replace(/[\s_]/g, '').toLowerCase();
function diff(mapped, tests, labels = new Map()) {
  const ran = new Map();
  for (const t of tests) {
    for (const f of t.flows) ran.set(`flow:${flat(f)}`, `flow ${f}`);
    for (const x of t.triggers) ran.set(`triggers/${x.name}`, `trigger ${x.name}`);
    for (const x of t.rules) ran.set(`rule:${x.name}`, `rule ${x.name}`);
  }
  const id = (k) => (k.startsWith('flows/') ? `flow:${flat(labels.get(k) ?? k.slice(6))}` : k.startsWith('triggers/') ? k : /\/validationRules\/(.+)$/.test(k) ? `rule:${k.match(/\/validationRules\/(.+)$/)[1]}` : k);
  // Per mapped key, not per id: two flows can share a label.
  const want = new Set(mapped.map(id));
  return { didNot: mapped.filter((k) => !ran.has(id(k))), unmapped: [...ran].filter(([i]) => !want.has(i)).map(([, l]) => l) };
}

module.exports = { parseLog, zip, xmlObj, soapPost, VALIDATE, validate, line, diff };
