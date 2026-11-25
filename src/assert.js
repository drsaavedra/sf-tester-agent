'use strict';

// Check a field's value through the UI API, the record page, or both; both catches display bugs.
const { SfUiError } = require('./errors');
const api = require('./api');
const nav = require('./nav');
const discover = require('./discover');
const A = require('./anchors');
const { instantOf } = require('./iso');

// View mode shows "<label>\n<value>\nEdit <label>" inside the layout item that carries field-label, or on a
// Dynamic Forms page inside the field element App Builder names sfdc:RecordField.<object>.<field>.
async function uiValue(s, recordId, label, objectApiName, apiName) {
  await nav.openRecord(s, recordId);
  const any = s.page.locator(`${A.layoutItem}[field-label="${label}"], [data-target-selection-name="sfdc:RecordField.${objectApiName}.${apiName}"]`);
  const item = any.locator('visible=true').first();
  // The panel can still be rendering after the highlights: a short wait, then Details only when the page has one.
  // A field on neither is FIELD_NOT_SHOWN with the page's tabs. ponytail: a custom tab other than Details is not opened.
  const notShown = async () => {
    const tabs = (await s.page.getByRole('tab').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    const hidden = (await any.count()) > 0; // in the DOM, not visible: this page's or a background console tab's
    return new SfUiError('FIELD_NOT_SHOWN', hidden ? `${label} is in the page but hidden (a collapsed section, a tab other than Details, or another console tab)`
      : `${label} is on this user's layout but the record page shows it on neither the landing tab nor Details`, { apiName, label, tabs, hidden });
  };
  if (!(await item.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false))) {
    const details = s.page.getByRole('tab', { name: 'Details', exact: true });
    if ((await details.count()) === 1) await details.click(); // a click that fails is its own error, not a missing field
    // With no Details tab the landing panel is still the only place, so it gets the same 10 s as Details.
    if (!(await item.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false))) throw await notShown();
  }
  // The first load after the user collapses a section shows it open, then closes it (~200 ms on sfui-s4-cascade).
  // ponytail: a fixed 1 s settle on every read; a page that closes the section later than that still passes.
  if (await item.waitFor({ state: 'hidden', timeout: 1_000 }).then(() => true, () => false)) throw await notShown();
  const lines = (await item.innerText()).split('\n').map((l) => l.trim());
  // A lookup's link carries a visually hidden "Preview" control that innerText still reads.
  const lookup = (await item.locator(`${A.lookup}, ${A.hoverableLink}`).count()) > 0;
  // A blank line inside a Text Area's value is kept; blank lines around it are not.
  return lines.filter((l) => l !== label && l !== `Edit ${label}` && !(lookup && l === 'Preview')).join('\n').replace(/^\n+|\n+$/g, '');
}

// The stored value is the wanted one: equal, the same record by a 15-char id (id), or a display name (name).
// A UI save stores a Text Area's line ends as CRLF, so the stored text reads as LF before it is compared.
const sameValue = (want, value, display, { id, name } = {}) => String(value ?? '').replace(/\r\n/g, '\n') === want
  || (!!id && want.length === 15 && nav.isId(want) && /^[a-zA-Z0-9]{18}$/.test(String(value ?? '')) && String(value).slice(0, 15) === want)
  || (!!name && display === want);
// A datetime or time stored as ...00.000Z is the same value typed as ...00Z, ...+0000 (as SOQL prints it) or 14:30. Only
// an ISO value with a zone counts for a datetime, so the test machine's own time zone never decides a match.
const ISO = { DateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/, Time: /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/ };
const instant = (type, v) => instantOf(type === 'Time' ? `1970-01-01T${v.replace(/Z$/, '')}Z` : v);
const sameInstant = (type, stored, want) => !!ISO[type] && typeof stored === 'string' && ISO[type].test(want) && ISO[type].test(stored)
  && instant(type, stored) === instant(type, want);
// The page groups a number's digits (12,345) and adds a Percent's sign (25%); the UI API gives neither a display value.
// ponytail: en-style separators only; a comma-decimal locale's page text reads as no number and stays red.
const NUMERIC = ['Double', 'Int', 'Long', 'Percent'];
const num = (type, v) => (NUMERIC.includes(type) && new RegExp(`^-?(\\d{1,3}(,\\d{3})+|\\d+)(\\.\\d+)?${type === 'Percent' ? '%?' : ''}$`).test(v)
  ? Number(v.replace(/[,%]/g, '')) : NaN);

async function fieldValue(s, recordId, apiName, expected, { via = 'both' } = {}) {
  const model = await discover.formModel(s, recordId, { mode: 'View' });
  const onLayout = model.fields.find((f) => f.apiName === apiName);
  // A field only a Dynamic Forms page places is not in the layout's View model: object-info gives its label and type.
  const info = (!onLayout || (via !== 'ui' && onLayout.dataType === 'Reference'))
    && (await api.call(s, `/ui-api/object-info/${model.objectApiName}`)).fields[apiName];
  const field = onLayout || info;
  const result = {};
  // A lookup stores an Id; its relationship field's display value is the record name a route sets it by.
  const rel = via !== 'ui' && field && field.dataType === 'Reference' && info && info.relationshipName;
  // An all-day Event's page shows Start and End as the day (6/1/2027), as ActivityDate and EndDate display it.
  const dayField = model.objectApiName === 'Event' && { StartDateTime: 'ActivityDate', EndDateTime: 'EndDate' }[apiName];
  let dayDisplay = null;
  // Via ui, a date or time given as ISO still needs the stored value and its display value to reach the page's text.
  const temporal = !!field && ['Date', 'DateTime', 'Time'].includes(field.dataType);
  let stored = null;
  if (via !== 'ui' || temporal) {
    const optional = rel ? `${model.objectApiName}.${rel}.Id` : dayField ? `Event.IsAllDayEvent,Event.${dayField}` : '';
    const { fields } = await api.call(s, `/ui-api/records/${recordId}?fields=${model.objectApiName}.${apiName}${optional ? `&optionalFields=${optional}` : ''}`);
    stored = { value: fields[apiName].value, display: rel ? (fields[rel] ? fields[rel].displayValue : null) : fields[apiName].displayValue };
    if (via !== 'ui') Object.assign(result, { api: stored.value, apiDisplay: stored.display });
    if (dayField && fields.IsAllDayEvent?.value === true) dayDisplay = fields[dayField]?.displayValue ?? null;
  }
  if (via !== 'api') {
    if (!field) throw new SfUiError('FIELD_NOT_ON_FORM', `${apiName} is not a field of ${model.objectApiName} this user can see`, { apiName });
    result.ui = await uiValue(s, recordId, field.label, model.objectApiName, apiName);
  }
  const want = expected === null ? '' : String(expected).replace(/\r\n/g, '\n');
  // A field off the View model (Dynamic Forms) has no known type, so a 15-char id may name its stored 18-char one.
  const storedOk = !!stored && (sameValue(want, stored.value, stored.display, { id: rel || !field, name: rel })
    || sameInstant(field && field.dataType, stored.value, want)
    || num(field && field.dataType, want) === stored.value);
  const apiOk = !('api' in result) || storedOk;
  // A checkbox reads "True" or "False" on the page, with no API display value to bridge it to true or false.
  const shown = field && field.dataType === 'Boolean' && result.ui != null ? result.ui.toLowerCase() : result.ui;
  // A time field's page shows the seconds (2:30:00 PM) that its API display value leaves out (2:30 PM).
  const page = field && field.dataType === 'Time' && result.ui != null ? result.ui.replace(/(\d:\d{2}):00\b/, '$1') : result.ui;
  // The page renders a run of spaces or tabs as one space.
  const spaced = (v) => v.replace(/[ \t]+/g, ' ');
  const uiOk = !('ui' in result) || spaced(shown) === spaced(want) || num(field.dataType, result.ui) === num(field.dataType, want)
    || (storedOk && ((stored.display != null && page === stored.display) || (dayDisplay != null && page === dayDisplay)));
  if (!apiOk || !uiOk) throw new SfUiError('FIELD_VALUE_MISMATCH', `${apiName} expected ${JSON.stringify(expected)}`, { expected, ...result });
  return result;
}

module.exports = { fieldValue, sameValue };
