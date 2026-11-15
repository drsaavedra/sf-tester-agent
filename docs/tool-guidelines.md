# Tool guidelines

Read this file before you open a pull request that adds an `sf_*` tool or changes what a tool can do. A change to a
tool's arguments, its description or the paths it reaches is a change to what the tool can do.

sf-tester is a test tool. A tester reports what it sees, and it does not change the org that it tests. If a tool can
change the org, a PASS can show an org that the repo does not ship.

## Rules

1. A tool writes to the org only through the UI, as the user of the session. The permissions of that user apply.
2. A tool does not take an HTTP method, a request body or a free URL. The token of the alias owner is for reads that
   the user cannot do.
3. `api.call` in `src/api.js` checks each GET against `READ_ROOTS`, for every caller. This list names what passes. Do
   not write a list of what to refuse. Add a root only after you do step 4.
4. A GET can change an org. `/tooling/executeAnonymous` runs Apex on a GET. Read the Salesforce documentation of a path
   before you add it to the list.
5. A tool argument that goes into a page URL is one path segment. Call `nav.segment` before you open the page.
6. No tool writes metadata. Custom metadata records stay UI-only, because they are metadata. Exception: `sf_list filter`
   saves a list view filter, and a test that adds one removes it with `sf_list removeFilter` in the same test.
7. A tool that reads a local file runs behind `agents/guard.js`. Add the tool to the hook matcher in each tester agent
   file, and to `GUARDED` in `bench/bench.js`.
8. A route step goes around the agent's `tools:` line and its hooks. Add a tool to `NOT_A_STEP` in `src/tool-limits.js`
   if a tester must not call it, or if it keeps a record of the run. If a route step can reach a local file, make the
   guard read that step, in `sf_run_route` and in `sf_save_route`. Add any new limit on an argument to `stepLimits` in
   `src/server.js`, so that a route meets it before its first step.
9. A tool that writes a local file takes a checked path, or it writes only to its own file.

## Classes

Each tool has one class in `src/tool-limits.js`. `test/tool-limits.test.js` fails for a tool with no class.

| Class | What the tool can do |
|---|---|
| `read` | It reads, or it changes only the browser session or an unsaved form. |
| `readSideEffect` | It reads, and it can open a record page or a list, so the org can change the recent items or the last list view of the user. |
| `login` | It logs in. The org keeps a login record. |
| `uiWrite` | It can save data through the UI, as a user can. |
| `apiRead` | It reads through the API, on the listed paths only. A SOQL `FOR VIEW` query can change the recent items too. |
| `runsTools` | It runs other tools. |
| `localFile` | It writes a local file, not the org. |

There is no class for a write through the API, and no class for a metadata write. If a test needs one of these, stop
and ask the repo owner. Do not add a class.

## Procedure

1. Find the class of the tool. Use the class that shows the most that the tool can do.
2. Add the tool to `src/tool-limits.js`.
3. Do a check of the tool against the rules above.
4. Add the tool to the `tools:` line of `agents/sf-tester.md` if a tester needs it. If not, add it to `NOT_A_STEP`.
5. Add a test that fails if you remove each limit. Remove the limit and make sure that the test fails.
6. Run `npm test`.
7. Do the full route replay in README.md, section "Tests".
8. Write the class of the tool in the pull request body.

## Allowed exceptions

An admin persona can change these records only if a brief names the persona and a test needs the change: permission
set assignments, user setup and custom setting rows. No tool gives this access today.
