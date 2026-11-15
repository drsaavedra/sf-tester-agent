'use strict';

// Readiness signals measured on a scratch org, never fixed sleeps.

// Milliseconds to a deadline, at least 1 (0 means no timeout to Playwright) and at most cap.
const left = (deadline, cap = Infinity) => Math.min(cap, Math.max(1, deadline - Date.now()));

// One app is up and knows who the user is.
async function lightning(page, { timeout = 60_000 } = {}) {
  const end = Date.now() + timeout; // the two waits share one timeout
  await page.waitForURL(/\.lightning\.force\.com\/lightning\//, { timeout });
  await page.waitForFunction(() => window.$A && $A.get && $A.get('$SObjectType.CurrentUser.Id'), null, { timeout: left(end) });
}

module.exports = { lightning, left };
