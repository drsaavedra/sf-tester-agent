'use strict';

// Date.parse rolls a day past a month's end (2027-02-30 is March 2) and T24:00 to the next day, so a date or an
// instant is read only when it is on the calendar. Apex refuses an hour of 24, and a minute or second past 59.
const DATE = /^\d{4}-\d\d-\d\d$/;
const DATETIME = /^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)$/;
const dateOk = (d) => typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
// The instant in ms of an ISO value with a zone, or NaN when it is not one on the calendar.
const instantOf = (v) => (typeof v === 'string' && DATETIME.test(v) && dateOk(v.slice(0, 10)) ? Date.parse(v) : NaN);

module.exports = { DATE, DATETIME, dateOk, instantOf };
