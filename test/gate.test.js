'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanGates } = require('../src/gate');

const IMP = "import hasMore from '@salesforce/customPermission/SfUi_See_More';\nimport { LightningElement, api } from 'lwc';\n";
const scan = (body, html) => scanGates(`${IMP}export default class C extends LightningElement {\n${body}\n}`, html);

test('a getter that returns the import, read by lwc:if, is a static gate', () => {
  const [r] = scan('get canSee() { return hasMore; }', '<template><div lwc:if={canSee}>x</div></template>');
  assert.deepEqual([r.permission, r.status, r.gates], ['SfUi_See_More', 'STATIC', [{ prop: 'canSee', directive: 'lwc:if', shownWhenHeld: true }]]);
});

test('a field set to the import, the negation, and if:false each say when the markup shows', () => {
  const shown = (body, html) => scan(body, `<template>${html}</template>`)[0].gates.map((g) => g.shownWhenHeld);
  assert.deepEqual(shown('canSee = hasMore;', '<p lwc:if={canSee}></p>'), [true]);
  assert.deepEqual(shown('cannot = !hasMore;', '<p lwc:if={cannot}></p>'), [false]);
  assert.deepEqual(shown('canSee = hasMore;', '<p if:false={canSee}></p>'), [false]);
  assert.deepEqual(shown('canSee = hasMore;', '<p lwc:if={!canSee}></p>'), [false]);
});

test('an lwc:if chain reads as one: lwc:else shows the other way, and a block that also reads another value is NOT_STATIC', () => {
  const shown = (html) => scan('canSee = hasMore;', `<template>${html}</template>`)[0];
  assert.deepEqual(shown('<p lwc:if={canSee}></p><p lwc:else></p>').gates.map((g) => [g.directive, g.shownWhenHeld]), [['lwc:if', true], ['lwc:else', false]]);
  assert.deepEqual(shown('<p lwc:if={canSee}></p>\n<p lwc:elseif={other}></p>').status, 'NOT_STATIC', 'the elseif reads the permission and other');
  assert.deepEqual(shown('<p lwc:if={other}></p><p lwc:elseif={canSee}></p>').gates.map((g) => [g.directive, g.shownWhenHeld]), [['lwc:elseif', true]], 'a sibling before it on a value that reads no permission is left out');
  assert.deepEqual(shown('<p lwc:if={other}></p><p lwc:else></p><p lwc:if={canSee}></p>').gates.map((g) => g.shownWhenHeld), [true], 'an else on another value gates nothing');
  assert.equal(shown('<p lwc:if={canSee}></p><p lwc:elseif={canSee}></p>').gates.length, 1, 'a block its chain never shows gates nothing');
});

test('a flat chain and its nested lwc:else give one verdict; a chain of two permissions is NOT_STATIC for both', () => {
  const js = `import isAdminP from '@salesforce/customPermission/Admin_Perm';
import isMgrP from '@salesforce/customPermission/Mgr_Perm';
export default class X { isLoading = true; get isAdmin() { return isAdminP; } get isManager() { return isMgrP; } }`;
  const mgr = (html) => { const r = scanGates(js, `<template>${html}</template>`).find((g) => g.permission === 'Mgr_Perm'); return [r.status, r.gates.map((g) => g.shownWhenHeld)]; };
  const flat = mgr('<template lwc:if={isLoading}>spinner</template><template lwc:elseif={isManager}>B</template>');
  const nested = mgr('<template lwc:if={isLoading}>spinner</template><template lwc:else><template lwc:if={isManager}>B</template></template>');
  assert.deepEqual(flat, ['STATIC', [true]]);
  assert.deepEqual(flat, nested);
  const two = scanGates(js, '<template><template lwc:if={isAdmin}>A</template><template lwc:elseif={isManager}>B</template></template>');
  assert.deepEqual(two.map((g) => [g.permission, g.status]), [['Admin_Perm', 'NOT_STATIC'], ['Mgr_Perm', 'NOT_STATIC']]);
  assert.match(two[1].reason, /lwc:elseif in the chain of lwc:if=\{isAdmin\}/);
  const verdicts = (html) => scanGates(js, `<template>${html}</template>`).map((g) => g.status);
  const nestedTwo = '<template lwc:if={isAdmin}>A</template><template lwc:else><template lwc:if={isManager}>B</template></template>';
  assert.deepEqual(verdicts(nestedTwo), ['NOT_STATIC', 'NOT_STATIC'], 'nested under lwc:else, the earlier permission still counts');
  const nestedThree = '<template lwc:if={isLoading}>s</template><template lwc:else><template lwc:if={isAdmin}>A</template><template lwc:else><template lwc:if={isManager}>B</template></template></template>';
  assert.deepEqual(verdicts(nestedThree), ['NOT_STATIC', 'NOT_STATIC'], 'and two levels down');
});

test('a block nested under a permission chain that reads no permission itself leaves the chain STATIC', () => {
  const js = `import isAdminP from '@salesforce/customPermission/Admin_Perm';
import isMgrP from '@salesforce/customPermission/Mgr_Perm';
export default class X { isLoading = true; showHelp = false; get isAdmin() { return isAdminP; } get isManager() { return isMgrP; } }`;
  const admin = (html) => { const r = scanGates(js, `<template>${html}</template>`)[0]; return [r.status, r.gates.map((g) => [g.directive, g.shownWhenHeld])]; };
  const gated = ['STATIC', [['lwc:if', true], ['lwc:else', false]]];
  assert.deepEqual(admin('<template lwc:if={isAdmin}>A</template><template lwc:else><template lwc:if={isLoading}>s</template><p>no</p></template>'), gated, 'a loading flag under the else');
  assert.deepEqual(admin('<template lwc:if={isAdmin}>A</template><template lwc:else><div><section><template if:true={showHelp}>h</template></section></div></template>'), gated, 'if:true three levels down');
  assert.deepEqual(admin('<template lwc:if={isAdmin}><template lwc:if={isLoading}>s</template></template><template lwc:else>no</template>'), gated, 'the same under the lwc:if');
  assert.equal(admin('<template lwc:if={isAdmin}>A</template><template lwc:else><template lwc:if={isManager}>B</template></template>')[0], 'NOT_STATIC', 'a permission under the else still counts');
});

test('two permissions nested under lwc:if are NOT_STATIC, as under lwc:else', () => {
  const js = `import isAdminP from '@salesforce/customPermission/Admin_Perm';
import isMgrP from '@salesforce/customPermission/Mgr_Perm';
export default class X { isLoading = true; get isAdmin() { return isAdminP; } get isManager() { return isMgrP; } }`;
  const verdicts = (html) => scanGates(js, `<template>${html}</template>`).map((g) => g.status);
  assert.deepEqual(verdicts('<template lwc:if={isAdmin}><template lwc:if={isManager}>B</template></template>'), ['NOT_STATIC', 'NOT_STATIC']);
  assert.deepEqual(verdicts('<template lwc:if={isLoading}><template lwc:if={isAdmin}>A</template></template>')[0], 'STATIC', 'a loading flag around a permission is left out');
});

test('the reason for a nested block names the block around it', () => {
  const js = `import isAdminP from '@salesforce/customPermission/Admin_Perm';
import isMgrP from '@salesforce/customPermission/Mgr_Perm';
export default class X { get isAdmin() { return isAdminP; } get isManager() { return isMgrP; } }`;
  const reasons = (html) => scanGates(js, `<template>${html}</template>`).map((g) => g.reason);
  const underElse = reasons('<template lwc:if={isAdmin}>A</template><template lwc:else><template lwc:if={isManager}>B</template></template>');
  for (const r of underElse) assert.equal(r, 'lwc:if nested under the lwc:else of lwc:if={isAdmin} reads the permission with another value');
  for (const r of reasons('<template lwc:if={isAdmin}><template lwc:if={isManager}>B</template></template>')) assert.equal(r, 'lwc:if nested under lwc:if={isAdmin} reads the permission with another value');
  assert.match(reasons('<template lwc:if={isAdmin}>A</template><template lwc:elseif={isManager}>B</template>')[1], /lwc:elseif in the chain of lwc:if=\{isAdmin\}/, 'a flat chain keeps its wording');
});

test('the reason names the permission block that makes it NOT_STATIC, not a loading flag or the block itself', () => {
  const js = `import isAdminP from '@salesforce/customPermission/Admin_Perm';
import isMgrP from '@salesforce/customPermission/Mgr_Perm';
export default class X { isLoading = true; get isAdmin() { return isAdminP; } get isManager() { return isMgrP; } }`;
  const reasons = (html) => scanGates(js, `<template>${html}</template>`).map((g) => g.reason);
  const [, mgr] = reasons('<template lwc:if={isAdmin}>A</template><template lwc:elseif={isLoading}><template lwc:if={isManager}>M</template></template>');
  assert.equal(mgr, 'lwc:if nested under the lwc:elseif of lwc:if={isAdmin} reads the permission with another value', 'a permission under a loading elseif');
  const [admin] = reasons('<template lwc:if={isAdmin}>A</template><template lwc:elseif={isManager}>B</template>');
  assert.equal(admin, 'lwc:elseif in the chain of lwc:if={isAdmin} reads the permission with another value', 'a flat chain names the earlier block');
});

test('an lwc:else belongs to its own sibling chain, not to a nested one before it', () => {
  const r = scan('canSee = hasMore;', '<template><div lwc:if={canSee}><p lwc:if={x}><br></p><p lwc:else></p></div><div lwc:else></div></template>')[0];
  assert.equal(r.status, 'STATIC', r.reason);
  assert.deepEqual(r.gates.map((g) => [g.directive, g.shownWhenHeld]), [['lwc:if', true], ['lwc:else', false]]);
});

test('a getter that mixes the import with another value is NOT_STATIC, directly or through another getter', () => {
  const html = '<template><p lwc:if={show}></p></template>';
  assert.equal(scan('get show() { return hasMore && this.record.Level__c === "High"; }', html)[0].status, 'NOT_STATIC');
  assert.equal(scan('get canSee() { return hasMore; }\nget show() { return this.canSee && this.data; }', html)[0].status, 'NOT_STATIC');
  assert.match(scan('@api data;\nget show() { return hasMore || this.data; }', html)[0].reason, /mixes the permission/);
});

test('one mixed property poisons the permission even beside a plain gate', () => {
  const r = scan('get canSee() { return hasMore; }\nget show() { return this.canSee && this.data; }', '<template><p lwc:if={canSee}></p><p lwc:if={show}></p></template>')[0];
  assert.equal(r.status, 'NOT_STATIC');
});

test('an import no plain directive reads is NOT_STATIC, and a bundle with no import has no gates', () => {
  assert.equal(scan('get canSee() { return hasMore; }', '<template><p>x</p></template>')[0].status, 'NOT_STATIC');
  assert.deepEqual(scanGates("import { LightningElement } from 'lwc';\nexport default class C extends LightningElement {}", '<template></template>'), []);
});

test('the import read anywhere but a plain getter or field is NOT_STATIC: a multi-statement getter, a method, a reassigned field', () => {
  const html = '<template><p lwc:if={a}></p></template>';
  const multi = scan('get a() { return hasMore; }\nget b() { const x = this.y; return hasMore && x; }', '<template><p lwc:if={a}></p><p lwc:if={b}></p></template>')[0];
  assert.deepEqual([multi.status, multi.gates], ['NOT_STATIC', []]);
  assert.match(multi.reason, /outside a plain getter or field/);
  assert.equal(scan('get a() { return hasMore; }\nrun() { if (hasMore) { this.go(); } }', html)[0].status, 'NOT_STATIC');
  assert.equal(scan('a = hasMore;\nreset() { this.a = false; }', html)[0].status, 'NOT_STATIC');
  assert.equal(scan('a = hasMore;\ncheck() { return this.a === true; }', html)[0].status, 'STATIC', 'a comparison of the field is not a reassignment');
  for (const op of ['||=', '&&=', '??=']) assert.equal(scan(`a = hasMore;\nreset() { this.a ${op} this.b; }`, html)[0].status, 'NOT_STATIC', `${op} sets the field again`);
});

test('a getter named like its import, or a comment that names it, is not another read of the import', () => {
  const html = '<template><p lwc:if={hasMore}></p></template>';
  assert.equal(scan('get hasMore() { return hasMore; }', html)[0].status, 'STATIC');
  assert.equal(scan('// hasMore shows the panel\n/* and hasMore again */\nget hasMore() { return hasMore; }', html)[0].status, 'STATIC');
  assert.equal(scan('hasMore = hasMore;', html)[0].status, 'STATIC', 'a field named like the import');
  assert.equal(scan('get hasMore() { return hasMore; }\nrun() { if (hasMore) { this.go(); } }', html)[0].status, 'NOT_STATIC', 'a real second read still counts');
});

test('a commented-out getter is not a plain property, so it cannot excuse a real read', () => {
  const html = '<template><p lwc:if={show}></p></template>';
  const body = '// get oldShow() { return hasMore; }\nget show() { return hasMore; }\nrun() { if (hasMore) { this.go(); } }';
  assert.equal(scan(body, html)[0].status, 'NOT_STATIC');
});

test('a second property with the same name and a mixed body is a read, not an allowed mention', () => {
  const html = '<template><p lwc:if={show}></p></template>';
  assert.equal(scan('show = hasMore;\nreset() {\n  show = hasMore || this.other;\n}', html)[0].status, 'NOT_STATIC');
});

test('a // inside a string does not erase a later read of the import', () => {
  const html = '<template><p lwc:if={show}></p></template>';
  assert.equal(scan("get show() { return hasMore; }\nrun() { const u = 'https://x'; if (hasMore) this.go(u); }", html)[0].status, 'NOT_STATIC');
  assert.equal(scan('get show() { return hasMore; } // the gate\nrun() { return 1; } /* hasMore */', html)[0].status, 'STATIC', 'a trailing comment is still stripped');
});

test('a // straight after code is a comment: its /* opens no block, and its words are no read', () => {
  const html = '<template><p lwc:if={show}></p></template>';
  assert.equal(scan('get show() { return hasMore; }\nrun() { this.x = 1;// old /* path\n  if (hasMore) this.go(); }\n/** doc */', html)[0].status, 'NOT_STATIC', 'the read after it is still seen');
  assert.equal(scan('get show() { return hasMore; }\nrun() { foo();//hasMore\n}', html)[0].status, 'STATIC', 'a mention inside it is not a read');
  assert.equal(scan("get show() { return hasMore; }\nrun() { const u = 'https://x'; if (hasMore) this.go(u); }", html)[0].status, 'NOT_STATIC', 'a // in a string stays');
});

test('comments are stripped by what the text is, not by the character before //', () => {
  const html = '<template><p lwc:if={show}></p></template>';
  const status = (run) => scan(`get show() { return hasMore; }\n${run}`, html)[0].status;
  assert.equal(status('run() { return x// hasMore\n}'), 'STATIC', 'a // right after an identifier is a comment');
  assert.equal(status('run() { const u = `${p}//${h}`; if (hasMore) this.go(u); }'), 'NOT_STATIC', 'a // in a template literal is text');
  assert.equal(status("run() { const css = 'url(//cdn/x.png)'; if (hasMore) this.go(css); }"), 'NOT_STATIC', 'a // in a string is text');
  assert.equal(status("run() { const a = '/* x'; if (hasMore) this.go(a); }"), 'NOT_STATIC', 'a /* in a string opens no block');
  assert.equal(status('run() { return `a${`b//${x}`}c`; } // hasMore'), 'STATIC', 'a ${ } holds code, and a template inside it is text');
  assert.equal(status("run() { return `${ {a: 1}.a + 'q`' }`; } // hasMore"), 'STATIC', 'a brace inside ${ } does not end it early');
  assert.equal(status('run() { if (/^https?:\\/\\//.test(u) && hasMore) this.go(u); }'), 'NOT_STATIC', 'the // that ends an escaped regex literal opens no comment');
});
