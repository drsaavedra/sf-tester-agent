'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UNKNOWN, evaluate } = require('../src/rule');

const c = (leftValue, operator, rightValue) => ({ leftValue, operator, rightValue });
const ctx = { record: { Level__c: 'High', Count__c: 5, Done__c: true, Note__c: null, Account: { Name: 'Acme' } }, user: { Department: 'Ops' }, customPermissions: { Can_See: true, Cannot: false }, standardPermissions: { ViewSetup: true }, formFactor: 'DESKTOP' };
const run = (criteria, booleanFilter) => evaluate({ criteria, booleanFilter }, ctx);

test('a record field, a user field, both permission kinds and the form factor are read', () => {
  assert.equal(run([c('{!Record.Level__c}', 'EQUAL', 'High')]), true);
  assert.equal(run([c('{!Record.Level__c}', 'EQUAL', 'Low')]), false);
  assert.equal(run([c('{!Record.Account.Name}', 'EQUAL', 'Acme')]), true);
  assert.equal(run([c('{!$User.Department}', 'EQUAL', 'Ops')]), true);
  assert.equal(run([c('{!$Permission.CustomPermission.Can_See}', 'EQUAL', 'true')]), true);
  assert.equal(run([c('{!$Permission.CustomPermission.Cannot}', 'EQUAL', 'true')]), false);
  assert.equal(run([c('{!$Permission.StandardPermission.ViewSetup}', 'EQUAL', 'true')]), true);
  assert.equal(run([c('{!$Client.FormFactor}', 'EQUAL', 'PHONE')]), false);
});

test('operators: NE, numbers, CONTAINS and an empty right value for null', () => {
  assert.equal(run([c('{!Record.Level__c}', 'NE', 'Low')]), true);
  assert.equal(run([c('{!Record.Count__c}', 'GT', '4')]), true);
  assert.equal(run([c('{!Record.Count__c}', 'LE', '4')]), false);
  assert.equal(run([c('{!Record.Level__c}', 'CONTAINS', 'ig')]), true);
  assert.equal(run([c('{!Record.Note__c}', 'EQUAL', '')]), true);
  assert.equal(run([c('{!Record.Level__c}', 'EQUAL', '')]), false);
});

test('booleanFilter combines criteria, and no filter means AND', () => {
  const t = c('{!Record.Level__c}', 'EQUAL', 'High');
  const f = c('{!Record.Level__c}', 'EQUAL', 'Low');
  assert.equal(run([t, f], '1 AND 2'), false);
  assert.equal(run([t, f], '1 OR 2'), true);
  assert.equal(run([f, t, t], '1 AND (2 OR 3)'), false);
  assert.equal(run([t, f, t], '1 AND (2 OR 3)'), true);
  assert.equal(run([t, f]), false);
  assert.equal(evaluate(null, ctx), true);
});

test('what it cannot read is UNKNOWN, and a settled side still decides', () => {
  const t = c('{!Record.Level__c}', 'EQUAL', 'High');
  const f = c('{!Record.Level__c}', 'EQUAL', 'Low');
  const missing = c('{!Record.Absent__c}', 'EQUAL', 'x');
  assert.equal(run([missing]), UNKNOWN);
  assert.equal(run([c('{!$Permission.CustomPermission.Other}', 'EQUAL', 'true')]), UNKNOWN);
  assert.equal(run([c('{!$Label.Foo}', 'EQUAL', 'x')]), UNKNOWN);
  assert.equal(run([c('{!Record.Level__c}', 'EQUAL', 'high')]), UNKNOWN);
  assert.equal(run([c('{!Record.Level__c}', 'GT', 'A')]), UNKNOWN);
  assert.equal(run([t, c('{!Record.Level__c}', 'STARTSWITH', 'H')]), UNKNOWN);
  assert.equal(run([f, missing], '1 AND 2'), false);
  assert.equal(run([t, missing], '1 OR 2'), true);
  assert.equal(run([t, missing], '1 AND 2'), UNKNOWN);
  assert.equal(run([t, f], '1 AND 3'), UNKNOWN);
  assert.equal(run([t, f], '1 AND ('), UNKNOWN);
  assert.equal(run([t, f], '1 XOR 2'), UNKNOWN);
  assert.equal(run([t, t], '1 AND 2 &'), UNKNOWN);
  assert.equal(run([c('{!Record.Level__c}', 'CONTAINS', 'IG')]), UNKNOWN);
});

test('two strings that differ but parse to one number are UNKNOWN: a text field compares them as text', () => {
  const zip = { ...ctx, record: { Zip__c: '01234', Code__c: '16', Count__c: 5 } };
  const at = (field, op, right) => evaluate({ criteria: [c(`{!Record.${field}}`, op, right)] }, zip);
  assert.equal(at('Zip__c', 'EQUAL', '1234'), UNKNOWN);
  assert.equal(at('Zip__c', 'NE', '1234'), UNKNOWN);
  assert.equal(at('Code__c', 'EQUAL', '0x10'), UNKNOWN);
  assert.equal(at('Count__c', 'EQUAL', '5.0'), UNKNOWN);
  assert.equal(at('Zip__c', 'EQUAL', '01234'), true);
  assert.equal(at('Zip__c', 'EQUAL', '1235'), false);
  assert.equal(at('Count__c', 'EQUAL', '5'), true);
});

test('GT, GE, LT and LE refuse numeric-looking text from a field, which may compare as text', () => {
  const code = { ...ctx, record: { Code__c: '10', Count__c: 5 } };
  const at = (field, op, right) => evaluate({ criteria: [c(`{!Record.${field}}`, op, right)] }, code);
  assert.equal(at('Code__c', 'GT', '9'), UNKNOWN);
  assert.equal(at('Code__c', 'LE', '9'), UNKNOWN);
  assert.equal(at('Count__c', 'GT', '4'), true, 'a number compares with the rule\'s literal');
  assert.equal(evaluate({ criteria: [c('{!Record.Count__c}', 'LT', '{!Record.Code__c}')] }, code), UNKNOWN, 'text on the right too');
});

test('AND and OR mixed with no parentheses are UNKNOWN, as the precedence is not measured; parentheses settle it', () => {
  const t = c('{!Record.Level__c}', 'EQUAL', 'High');
  const f = c('{!Record.Level__c}', 'EQUAL', 'Low');
  assert.equal(run([t, f, t], '1 AND 2 OR 3'), UNKNOWN);
  assert.equal(run([f, f, t], '1 OR 2 AND 3'), UNKNOWN);
  assert.equal(run([f, t, t], '(1 AND 2) OR 3'), true);
  assert.equal(run([f, t, t], '1 AND (2 OR 3)'), false);
  assert.equal(run([t, t, f], '1 AND 2 AND 3'), false);
  assert.equal(run([f, f, t], '1 OR 2 OR 3'), true);
});

test('a malformed token or a missing left value is UNKNOWN, not a literal or null', () => {
  assert.equal(run([c('{!Record.Level__c} ', 'EQUAL', 'High')]), UNKNOWN);
  assert.equal(run([c(' {!Record.Level__c}', 'EQUAL', 'High')]), UNKNOWN);
  assert.equal(run([c('{!Record.Level__c}', 'EQUAL', '{!Record.Level__c} ')]), UNKNOWN);
  assert.equal(run([c(undefined, 'EQUAL', '')]), UNKNOWN);
  assert.equal(run([c(null, 'EQUAL', '')]), UNKNOWN);
  assert.equal(run([c('{!Record.Level__c}', 'EQUAL', 'High')]), true);
  assert.equal(run([c('{!Record.Note__c}', 'EQUAL', undefined)]), true, 'a blank right value is null');
});
