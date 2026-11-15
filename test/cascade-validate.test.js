'use strict';

// The SOAP validate's timing and cancel paths, apart from cascade-log.test.js, which also drives verify.
const test = require('node:test');
const assert = require('node:assert/strict');
const ranlog = require('../src/cascade-log');

const envelope = (body) => `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/04/metadata"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
const DEPLOYED = envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>');
const NOT_DONE = envelope('<checkDeployStatusResponse><result><done>false</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
const CANCELLED = envelope('<cancelDeployResponse><result><done>false</done><id>0AfCASCADE</id></result></cancelDeployResponse>');
const op = (body) => /<met:(\w+)>/.exec(body)[1];
const run = (post, extra = {}) => ranlog.validate({ s: {}, files: { 'package.xml': Buffer.from('<Package/>') }, tests: ['T'], post, sleep: async () => {}, ...extra });
// A call that answers only when its signal fires, as fetch does. Its timer holds the event loop open as a socket
// would (Node 22 exits on an unref'd one), is cleared on the abort, and fails a missing limit instead of hanging.
const hang = (signal, ms = 6000) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const never = setTimeout(() => reject(new Error('the call was never stopped')), ms);
  signal?.addEventListener('abort', () => { clearTimeout(never); reject(signal.reason); }, { once: true });
});

// polls 1 is a 2 s limit: a status call that never answers is stopped there, not at undici's 300 s, and cancelled.
test('a status call that never answers is stopped at the time limit and the validate is cancelled', async () => {
  const ops = [];
  const post = async (s, body, o = {}) => {
    ops.push(op(body));
    if (op(body) === 'deploy') return DEPLOYED;
    if (op(body) === 'cancelDeploy') return CANCELLED;
    return hang(o.signal);
  };
  await assert.rejects(run(post, { polls: 1 }), { message: '0AfCASCADE did not finish in 2 s; validate 0AfCASCADE cancelled' });
  assert.deepEqual(ops, ['deploy', 'checkDeployStatus', 'cancelDeploy']);
});

test('a deploy call that never answers is stopped at the time limit, and says a validate may still run', async () => {
  const post = async (s, body, o = {}) => hang(o.signal);
  await assert.rejects(run(post, { polls: 1 }), { message: 'the deploy call did not answer in 2 s; a validate the org took may still run there' });
});

const DONE = envelope('<checkDeployStatusResponse><result><done>true</done><id>0AfCASCADE</id><success>true</success></result></checkDeployStatusResponse>');
// polls 1 is a 2 s limit: the poll sees done at 1.9 s, and the details read takes 0.5 s, past the limit.
test('the details read after done has its own allowance past the time limit', async () => {
  const post = async (s, body, o = {}) => {
    if (op(body) === 'deploy') return DEPLOYED;
    if (/<met:includeDetails>false/.test(body)) { await new Promise((ok) => { setTimeout(ok, 1900); }); return DONE; }
    await new Promise((ok, no) => { setTimeout(ok, 500); o.signal?.addEventListener('abort', () => no(o.signal.reason), { once: true }); });
    return DONE;
  };
  const r = await run(post, { polls: 1 });
  assert.deepEqual([r.done, r.success], ['true', 'true']);
});

test('a cancel the org refuses as already completed reads the result, unless the run was stopped', async () => {
  const ops = [];
  const post = async (s, body) => {
    ops.push(op(body));
    if (op(body) === 'deploy') return DEPLOYED;
    if (op(body) === 'cancelDeploy') throw Object.assign(new Error('SOAP 500: INVALID_ID_FIELD: Deployment already completed'), { status: 500 });
    if (/<met:includeDetails>false/.test(body)) throw new Error('SOAP 500: UNKNOWN_EXCEPTION');
    return DONE;
  };
  assert.equal((await run(post)).success, 'true');
  assert.deepEqual(ops, ['deploy', 'checkDeployStatus', 'cancelDeploy', 'checkDeployStatus']);
  const ac = new AbortController();
  const stopping = async (s, body) => { if (op(body) === 'checkDeployStatus') ac.abort(new Error('stopped')); return post(s, body); };
  await assert.rejects(run(stopping, { signal: ac.signal }), /validate 0AfCASCADE had already finished$/);
});

// The deploy call answers as fetch does: it rejects when its signal fires, else gives the id a moment later.
const deployAfterStop = (ac, ops, { answers = true } = {}) => async (s, body, o = {}) => {
  ops.push(op(body));
  if (op(body) === 'cancelDeploy') return CANCELLED;
  if (op(body) !== 'deploy') return NOT_DONE;
  ac.abort();
  if (!answers) return hang(o.signal, 20_000);
  if (o.signal?.aborted) throw o.signal.reason;
  return new Promise((resolve, reject) => {
    o.signal?.addEventListener('abort', () => reject(o.signal.reason), { once: true });
    setTimeout(() => resolve(DEPLOYED), 10);
  });
};

test('Ctrl-C during the deploy call still gets the id, and the validate the org took is cancelled', async () => {
  const ac = new AbortController();
  const ops = [];
  await assert.rejects(run(deployAfterStop(ac, ops), { signal: ac.signal }), { message: 'This operation was aborted; validate 0AfCASCADE cancelled' });
  assert.deepEqual(ops, ['deploy', 'cancelDeploy']);
});

test('a deploy call that gives no id within 15 s of Ctrl-C is given up, and the error says nothing was cancelled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ac = new AbortController();
  const ops = [];
  // polls 1: should the 15 s never fire, the real 2 s limit ends the call and the assertion fails, not the file.
  const p = run(deployAfterStop(ac, ops, { answers: false }), { signal: ac.signal, polls: 1 });
  for (let i = 0; i < 1e4 && !ops.includes('deploy'); i++) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(15_000);
  await assert.rejects(p, { message: 'This operation was aborted; the deploy call gave no id, so a validate the org took is not cancelled' });
  assert.deepEqual(ops, ['deploy']);
});

test('a run stopped before the deploy call sends nothing', async () => {
  const ops = [];
  await assert.rejects(run(deployAfterStop(new AbortController(), ops), { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.deepEqual(ops, []);
});

// The cancel's fault is the org's own answer for a finished deploy, measured on a scratch org 2026-11-12.
test('a fault after the org finished says the validate had finished, not that a cancel failed', async () => {
  const ops = [];
  const post = async (s, body) => {
    ops.push(op(body));
    if (op(body) === 'deploy') return DEPLOYED;
    if (op(body) === 'cancelDeploy') throw Object.assign(new Error('SOAP 500: INVALID_ID_FIELD: Deployment already completed'), { status: 500 });
    throw new Error('SOAP 500: UNKNOWN_EXCEPTION');
  };
  await assert.rejects(run(post), { message: 'SOAP 500: UNKNOWN_EXCEPTION; validate 0AfCASCADE had already finished, and its result did not read: SOAP 500: UNKNOWN_EXCEPTION' });
  assert.deepEqual(ops, ['deploy', 'checkDeployStatus', 'cancelDeploy', 'checkDeployStatus']);
});
