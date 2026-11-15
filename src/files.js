'use strict';

// Files go in the way the OS file picker hands them over: set on the one file input inside a scope (a
// component host, a modal, a related list), hidden or not, so the component's own upload handling runs.
// ponytail: drop-only zones with no file input (an ondrop handler alone) are not reached.
const { SfUiError, AT } = require('./errors');
const { requireEnglish } = require('./session');
const { armToasts } = require('./act');

const UPLOAD_REQUEST = /FileUploadAction|\/chatter\/handlers\/file\/body/;

async function upload(s, scope, paths, { timeout = 60_000 } = {}) {
  await requireEnglish(s);
  const input = scope.locator('input[type=file]');
  await input.first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {}); // lists render late
  const count = await input.count();
  if (count !== 1) throw new SfUiError('NO_SINGLE_FILE_INPUT', `expected one file input in the scope, found ${count}`, { count });
  await armToasts(s.page); // the toasts an upload raises, not the last click's, so a wait after it sees only these
  // The uploader asks for its config, then posts the file: either says a dialog is coming, however late (16 s seen on a busy org).
  // Heard from the click on, and counted up to 5 s after the file is set, however long the chooser took.
  let sent = false;
  const heard = (r) => { if (UPLOAD_REQUEST.test(r.url())) sent = true; };
  s.page.on('request', heard);
  // lightning-file-upload and the Files lists store the file, then wait in an "Upload Files" dialog for Done.
  const dialog = s.page.getByRole('dialog', { name: 'Upload Files', exact: true });
  let at, shown;
  try {
    // Setting the input directly left the file unlinked to the record in 3 of 6 runs; a click on its label
    // and the file chooser linked 8 of 8. ponytail: an input with no label falls back to the direct set.
    const label = (await input.evaluateHandle((el) => (el.labels && el.labels[0]) || null)).asElement();
    if (label) {
      const [chooser] = await Promise.all([s.page.waitForEvent('filechooser', { timeout }), label.click()]);
      await chooser.setFiles(paths);
    } else {
      await input.setInputFiles(paths);
    }
    at = { fileSet: new Date().toISOString() };
    // ponytail: a refused file (empty) sends no request, so its dialog counts only if it shows within 5 s.
    shown = await dialog.waitFor({ timeout: 5_000 }).then(() => true, () => false);
  } finally {
    s.page.off('request', heard); // also when the chooser never opened
  }
  if (!shown && !sent) return { dialog: false, [AT]: at };
  try {
    // Done turns on once every file is stored; a failed file shows an alert and a Got It button instead.
    const done = dialog.getByRole('button', { name: 'Done', exact: true, disabled: false });
    await done.or(dialog.getByRole('alert')).first().waitFor({ timeout });
    const alerts = await dialog.getByRole('alert').allInnerTexts();
    const [count, uploaded, of] = (await dialog.innerText()).match(/(\d+) of (\d+) files? uploaded/) || [];
    if (alerts.length || !count || uploaded !== of) {
      // Lightning hides div.viewport about 0.5 s after the dialog shows; a close before that leaves the page hidden for good.
      const viewport = await s.page.locator('div.viewport').count().then((n) => (!n ? 'no viewport' : s.page.locator('div.viewport[aria-hidden="true"]').first()
        .waitFor({ state: 'attached', timeout: 3_000 }).then(() => 'hidden'))).catch((e) => (e.name === 'TimeoutError' ? 'not hidden in 3 s' : `unread: ${e.message}`));
      const close = dialog.getByRole('button', { name: /^(Done|Got It)$/, disabled: false }).first();
      const closed = await close.click({ timeout: 5_000 }).then(() => dialog.waitFor({ state: 'hidden', timeout: 5_000 })).then(() => true, () => false);
      throw new SfUiError('UPLOAD_FAILED', `the Upload Files dialog says ${count || 'no count'}${alerts.length ? `: ${alerts.join('; ')}` : ''}`, { count: count || null, alerts, closed, viewport });
    }
    await done.click({ timeout });
    at.done = new Date().toISOString();
    await dialog.waitFor({ state: 'hidden', timeout });
  } catch (e) {
    e[AT] = at; // the file was set, so a failed Done still says when
    throw e;
  }
  return { dialog: true, [AT]: at };
}

module.exports = { upload };
