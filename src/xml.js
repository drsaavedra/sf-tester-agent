'use strict';

// XML's five named entities and numeric references, in one pass so a decoded & is not read again; a code point
// past Unicode is left as written.
const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|lt|gt|quot|apos|amp);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n <= 0x10ffff ? String.fromCodePoint(n) : m;
});

// The reverse, for text put into XML: control characters XML 1.0 forbids are dropped.
const esc = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

module.exports = { unxml, esc };
