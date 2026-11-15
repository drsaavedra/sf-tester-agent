'use strict';

// Evaluates a FlexiPage visibility rule (criteria plus a booleanFilter) for a user and record state: true, false or UNKNOWN.
// What it cannot read or has not measured is UNKNOWN, never a guess; a settled side still decides AND and OR.
const UNKNOWN = 'UNKNOWN';

// One {!...} token's value: { value } or { unknown: why }. ctx: { record, user, customPermissions, standardPermissions, formFactor, access, unreadable }.
function token(text, ctx) {
  // A missing value, or text that opens {! without being exactly one token, is not read as a literal.
  if (typeof text !== 'string') return { unknown: 'a criterion has no value to read' };
  const m = /^\{!\s*([^}]+?)\s*\}$/.exec(text);
  if (!m) return text.includes('{!') ? { unknown: `${JSON.stringify(text)} is not one token` } : { value: text, literal: true };
  const path = m[1].split('.');
  const pick = (obj, keys) => {
    let cur = obj;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') return { unknown: `${text} is not in the given state` };
      const key = Object.keys(cur).find((x) => x.toLowerCase() === k.toLowerCase());
      if (key === undefined) return { unknown: `${text} is not in the given state` };
      cur = cur[key];
    }
    return { value: cur };
  };
  const [root, ...rest] = path;
  if (root === 'Record') {
    // ctx.access: the persona's read access per field, lowercase name -> 'read' | 'none' | 'unknown'.
    const a = ctx.access?.[rest.join('.').toLowerCase()];
    if (a === 'unknown') return { unknown: `${text}: the persona's read access to it is not decided` };
    // A rule kind not calibrated against the rendered page (ctx.unreadable 'unknown') does not guess what the org does with it.
    if (a === 'none') return ctx.unreadable === 'unknown' ? { unknown: `${text}: the persona cannot read it, and this kind of rule is not calibrated` } : { value: null };
    return pick(ctx.record, rest);
  }
  if (root === '$User') return pick(ctx.user, rest);
  if (root === '$Client' && rest.join('.') === 'FormFactor') return ctx.formFactor == null ? { unknown: `${text} is not in the given state` } : { value: ctx.formFactor };
  if (root === '$Permission' && rest[0] === 'CustomPermission' && rest.length === 2) return pick(ctx.customPermissions, [rest[1]]);
  if (root === '$Permission' && rest[0] === 'StandardPermission' && rest.length === 2) return pick(ctx.standardPermissions, [rest[1]]);
  return { unknown: `${text} is not a token this evaluator reads` };
}

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const isNull = (v) => v == null || v === '';

// One criterion: true, false or UNKNOWN.
function criterion(c, ctx) {
  const left = token(c.leftValue, ctx);
  const right = token(c.rightValue ?? '', ctx);
  if (left.unknown || right.unknown) return UNKNOWN;
  const [a, b] = [left.value, right.value];
  const op = c.operator;
  if (op === 'EQUAL' || op === 'NE') {
    let eq;
    if (isNull(a) || isNull(b)) eq = isNull(a) && isNull(b);
    else if (typeof a === 'boolean' || typeof b === 'boolean') eq = String(a).toLowerCase() === String(b).toLowerCase();
    else if (String(a) === String(b)) eq = true;
    else if (num(a) !== null && num(b) !== null && num(a) === num(b)) return UNKNOWN; // a text field would not equate '01' and 1
    else if (String(a).toLowerCase() === String(b).toLowerCase()) return UNKNOWN; // case rules not measured
    else eq = false;
    return op === 'EQUAL' ? eq : !eq;
  }
  if (['GT', 'GE', 'LT', 'LE'].includes(op)) {
    // Only numbers are compared: text a field holds may compare as text, so it is not read as a number. The rule's own literal is.
    if (num(a) === null || num(b) === null || [left, right].some((t) => !t.literal && typeof t.value === 'string')) return UNKNOWN;
    return { GT: num(a) > num(b), GE: num(a) >= num(b), LT: num(a) < num(b), LE: num(a) <= num(b) }[op];
  }
  if (op === 'CONTAINS') return isNull(a) ? false : String(a).includes(String(b)) ? true : String(a).toLowerCase().includes(String(b).toLowerCase()) ? UNKNOWN : false;
  return UNKNOWN;
}

const and = (x, y) => (x === false || y === false ? false : x === UNKNOWN || y === UNKNOWN ? UNKNOWN : true);
const or = (x, y) => (x === true || y === true ? true : x === UNKNOWN || y === UNKNOWN ? UNKNOWN : false);

// "1 AND (2 OR 3)" over the criteria's results, by recursive descent; a filter it cannot parse is UNKNOWN.
function filter(expr, results) {
  const toks = expr.match(/\(|\)|\w+/g) || [];
  if (toks.join('') !== expr.replace(/\s+/g, '')) return UNKNOWN;
  // AND against OR with no parentheses between: the precedence is not measured.
  const levels = [{}];
  for (const t of toks) {
    if (t === '(') levels.push({});
    else if (t === ')') levels.pop();
    else if (/^(and|or)$/i.test(t)) {
      const lv = levels.at(-1);
      if (!lv) return UNKNOWN;
      lv[t.toLowerCase()] = true;
      if (lv.and && lv.or) return UNKNOWN;
    }
  }
  let i = 0;
  const fail = Symbol('bad');
  const atom = () => {
    const t = toks[i++];
    if (t === '(') { const v = orExpr(); if (toks[i++] !== ')') throw fail; return v; }
    if (/^\d+$/.test(t) && results[Number(t) - 1] !== undefined) return results[Number(t) - 1];
    throw fail;
  };
  const andExpr = () => { let v = atom(); while (toks[i]?.toUpperCase() === 'AND') { i++; v = and(v, atom()); } return v; };
  const orExpr = () => { let v = andExpr(); while (toks[i]?.toUpperCase() === 'OR') { i++; v = or(v, andExpr()); } return v; };
  try { const v = orExpr(); return i === toks.length ? v : UNKNOWN; } catch (e) { if (e === fail) return UNKNOWN; throw e; }
}

// rule: { criteria, booleanFilter }, as Tooling gives it or ruleFromXml reads it. No rule means always shown.
function evaluate(rule, ctx = {}) {
  if (!rule) return true;
  const criteria = [].concat(rule.criteria ?? []);
  const results = criteria.map((c) => criterion(c, ctx));
  if (rule.booleanFilter) return filter(rule.booleanFilter, results);
  return results.reduce(and, true);
}

module.exports = { UNKNOWN, evaluate, and, or };
