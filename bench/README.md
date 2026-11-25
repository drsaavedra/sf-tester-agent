# Known-route benchmark

This benchmark compares three ways for the sf-tester to do one task:

- **A**: the tester finds the route itself.
- **B**: the brief gives the route as a list of sf-tester calls.
- **C**: the brief gives the route as one `sf_run_route` call.

Arms D, E and G give the same task to a generic Playwright tester instead: D with the task only, E with the route
as a guide, and G with the task and read-only sf CLI reads (see [Held-out corpus](#held-out-corpus)).

The targets are the `tested` entries in `../combinations.json`. Each entry has a task for arm A and a route for
arms B, C and E. When you add an entry to the catalogue, you add a target to the benchmark. A held-out corpus brings its own targets
(see [Held-out corpus](#held-out-corpus)).

Run the benchmark only on a scratch org: the sf-tester fixture org (`test/fixture`), or the org of a held-out corpus
(see [Held-out corpus](#held-out-corpus)). Never run it on a client org.

## Before you start

1. Make sure that the fixture org has the current `test/fixture/force-app`.
2. Run `node --test test/combinations.test.js` with `SF_TESTER_ORG` and `SF_TESTER_USER` set. All routes must pass.
3. In Claude Code, reconnect the `sf-tester` MCP server (`/mcp`). New sf-tester tools load only at connect.
4. Link both tester agents from a checkout that has `agents/guard.js`: `seed` refuses otherwise. The guard runs before
   each Read, Grep, Glob and file upload of an sf-tester or pw-tester, and before a pw-tester opens a page, and refuses
   any that reaches `bench/`, `test/bench.test.js`, `~/.sf-tester/bench` (the briefs, `cells.json` and the metrics of
   every run), the defect state or the session transcripts, and any page that is not `http` or `https`. It runs only
   inside a tester, so the main session reads all of these as usual. A Grep or Glob over a folder that holds the key is
   refused too, so a tester searches `src` or `test/fixture` instead. `seed` and `defect --apply` refuse while
   `SF_TESTER_BENCH` names a folder other than `~/.sf-tester/bench`, because the guard protects that one.
   pw-tester does not have `browser_run_code_unsafe`: it runs code in the Playwright server, where the guard cannot see it.
5. For arm G, also link `bench/pw-tester-cli.md`. It has Bash, and Bash can read any file, so its agent file also runs
   `bench/sf-read-guard.js` before each Bash call. That guard lets through only one plain `sf data query`,
   `sf sobject describe` or `list`, or `sf api request rest` GET, with `-o` naming a scratch org. A REST path must be
   one `sf_api` can read. It refuses shell syntax, file flags, writes, every other command and
   `tooling/executeAnonymous`. `seed` refuses arm G if the installed agent does not run both guards.

CAUTION: THE SERVER TESTS END WITH A LOGIN AS. A LOGIN AS STOPS THE OTHER BROWSER SESSIONS OF THE SAME ALIAS. DO
NOT RUN `test/server.test.js` ON THE ORG WHILE THE BENCHMARK RUNS.

## Procedure

1. Make the records and the briefs:

   ```sh
   node bench/bench.js seed --org sfui-fixture --run <name> --n 3
   ```

   The command writes `~/.sf-tester/bench/<name>/cells.json` and one brief for each cell in `briefs/`. Each cell gets
   its own records, named with the random `key` that the command prints, never with the run name. `--only id,id` limits
   the targets. `--arms A,C` limits the arms.
2. From a Claude Code session, start one tester subagent for each brief: `sf-tester` for arms A to C, `pw-tester` for D
   and E, `pw-tester-cli` for G. Use the brief text as the prompt.
   Use the model and the effort of the agent file. Start a maximum of 4 at a time, because sf-tester has a limit of 4
   sessions. Mix the arms in each batch.
3. For each subagent, add one line to `~/.sf-tester/bench/<name>/spawn.log` before you read its result:
   `<cell> <agentId>`.
4. If something outside the arm stops a run (for example, an expired session), put `#` at the start of its line.
   Write the cause after the line. Then run the cell again and log the new agent.
5. Read the metrics from the subagent transcripts:

   ```sh
   node bench/bench.js metrics --run <name> --transcripts ~/.claude/projects/<project>/<session>/subagents
   ```

   With `CLAUDE_CONFIG_DIR` set, the transcripts are under `$CLAUDE_CONFIG_DIR/projects/` instead.

   The command writes `metrics.tsv` (one row for each run) and `summary.tsv` (the mean for each target, defect
   and arm, and for each arm; n and the means count only the cells that finished). It also lists the cells that have no `RESULT` line, except a `refused` cell (see below), which counts as finished with or without one.
6. Delete the records:

   ```sh
   node bench/bench.js cleanup --run <name>
   ```

## Defect corpus

`defects.json` lists mutations of the fixture, one at a time, each with the target it breaks and the verdict it
expects. Use a separate scratch org for it. The `defect` command never deploys, so you deploy the fixture after each
step.

1. Apply one defect, then deploy `test/fixture/force-app` to the org:

   ```sh
   node bench/bench.js defect --id <id> --apply --org <alias>
   ```

   A `patch` defect runs `git apply` on the working tree. A `user` defect (`non-english-user`) changes a field of the
   alias owner's User over REST. It needs `--org`, and the revert needs the same `--org` value. It keeps the old value in `~/.sf-tester/bench-defect-state/<org>__<id>.json` (the org percent-encoded), outside any run folder.
2. Make the cells with `seed ... --defect <id>`. The command limits the targets to the defect's `target` (`--only`
   overrides this) and writes `defect` and `expected` into each cell. `--defect none` is the control: it
   defaults to the targets of all the defects, and it expects PASS.
   `seed` refuses unless that defect is the only one applied (for a patch, its reverse must apply to the working tree;
   for a user defect or a seeded patch, its state file must exist and name this `--org`), and `--defect none` refuses when any defect
   is applied, a user defect or a seeded patch on any org included. This proves the state of the worktree and the state files only. It does not prove that you deployed the fixture to the org.
   `seed` then reverts a patch defect in the working tree, because each tester gets a git status at start that would
   name the patched file. The org keeps the defect, so deploy before you seed. A state file records the defect until
   step 4, so the checks above stay true and a second seed of the same defect needs no second apply. `seed` refuses
   when `test/fixture` is not clean after that, because a tester would read the change in its git status.
3. Run the cells as in the procedure above, then read the metrics. `metrics.tsv` has four more columns:
   - `outcome`: `caught` (FAIL expected, FAIL given), `missed` (FAIL expected, PASS given), `pass`, `refused` (PASS
     expected, no PASS, and a tool returned an error with the code `UNSUPPORTED_LANGUAGE`; what the agent wrote is
     not read), `false-fail` (any other FAIL where PASS was expected) or `unfinished` (no `RESULT` line and not
     refused).
   - `caughtBy`: the `oracle` of the first failed check in the `checks` that an `sf_scenario` end or `sf_end`
     returned, else `error:<code>` of the first sf-tester tool error, else `none`. Errors of `sf_start`, `sf_scenario` and
     `sf_end`, and the codes `BAD_ARGS`, `NO_SESSION` and `BUDGET_SPENT`, catch no defect and are skipped. Under
     `ROUTE_STEP_FAILED` the code is the failing step's. It is empty for a run that ended PASS, and for a run with no
     sf-tester call (D, E).

   `summary.tsv` has one `out_<outcome>` count for each outcome, over all the cells of a group, so `out_unfinished`
   shows the cells that `n` leaves out.
4. Revert the defect with `--revert` (the same command) and deploy again. A revert of a `user` defect writes the old
   value back. A revert of a `patch` defect that `seed` took out of the tree clears its state file, reverts the patch
   if it is back in the tree, and prints the org to deploy. With `--org`, it refuses any org but the seeded one.

`tab-renamed` is caught by every arm: the routes of B and C open the tab by the label the requirement quotes, so a
rename fails their `sf_open_tab` step with `TAB_UNAVAILABLE`. On a quoted label it finds under another name, an
sf-tester (A, B, C) ends `BLOCKED: ... What label does the source set?`; the session running the bench answers with the
label from the fixture's `tabs/<Api>.tab-meta.xml` and resumes it with SendMessage, so the cell ends with its `RESULT`
line. A pw-tester (D, E) keeps the generic rule and reports FAIL at once, so its time has no wait for an answer.

During a run the working tree holds the fixture without the defect, so the label answer is the label from before the
rename, and the FAIL names the org as the side to fix.

## Held-out corpus

A held-out corpus tests an app that nobody on this repo wrote, with defects that nobody on this repo seeded. Ours is
`trailheadapps/dreamhouse-lwc` on its own scratch org, and its defects were seeded by an independent agent that could
not read this repo: 10 defects, 5 of them persona defects, each with a harmless control change.

1. Put one corpus file and its patches under `~/.sf-tester/bench/`, where the tester guard covers them. `seed` and
   `defect` refuse a corpus file anywhere else, and `seed` and `defect --apply` also refuse a patch anywhere else. A
   revert reads the patch wherever it is, because it is the way out.

   ```json
   { "root": "<the app's git checkout>",
     "defects": [{ "id": "h01", "target": "h01", "expected": "FAIL", "kind": "patch", "patch": "patches/h01.patch" }],
     "targets": [{ "id": "h01", "task": "<the requirement>", "app": "Dreamhouse",
                   "persona": { "name": "Val Viewer", "username": "<username>" } }] }
   ```

   A patch path is relative to the corpus file. A control is one more defect entry on the same target, with
   `"expected": "PASS"`. A target makes no records: the app has its own data.
2. Add `--corpus <file>` to every `seed` and `defect` command. `defect` then applies the patch in `root`, and the clean
   check covers the whole app tree, not only `test/fixture`. Deploy from `root` after each apply and each revert.
   Seed with `--arms A,D,G` until a target carries a saved route: `seed` refuses B, C and E for a target with none.
3. A target with a persona gives every arm the same instruction: start as the alias owner, then become the persona by
   Login As (`sf_login_as` for A to C, Setup's Login As for D, E and G). So one signed-in browser serves every
   persona. The org needs `enableAdminLoginAsAnyUser` in its security settings.
4. Run persona cells one at a time: a Login As can stop the other sessions of the same alias. Run G cells one at a
   time too, because the testers of one session share its Playwright MCP server. Before each cell, put the app's data
   back to its baseline, so that one cell's edits cannot change the next cell's verdict.

Arm G is the fair Playwright arm. It is D with read-only sf CLI reads, which reach what sf-tester's own org reads
reach (`sf_object_context`, `sf_api`). Arm A has no shell. G's Bash runs only the reads its guard allows: in the dry
run, G tried a `grep` on its own saved page snapshot, and the guard refused it. Neither arm is pinned to the brief's
org: an sf-tester can `sf_start` any alias, and G's guard allows any scratch org. Pinning only G would handicap it,
and no other org holds the app or its key. Instead `metrics` flags each cell whose `sf_start` or Bash `sf` command
named another org (`otherOrgs`), and reports "N of M" cells on another org; a flagged cell is reviewed, never
dropped. It does not see a browser that opens another org's URL.

A report gets a cause score as well as its verdict. The rule is written before any cell is scored:

- **named**: the report states the defect's cause class, in any words, as the cause or as the single most likely
  cause.
- **wrong**: the report states a different specific cause.
- **none**: the report gives the symptom only, or lists two or more causes without choosing one.

A scorer agent scores the reports in shuffled order, with each cell id, verdict line and tool or product name
replaced by `[tool]`. This blinding is partial: sf-tester's "Improvements" line and G's Login As wording still show
the arm.

## What the numbers mean

- **turns**: the number of model turns, including the turns `ToolSearch` spends loading schemas. Each turn reads
  the full context again, so turns cause most of the cost.
- **cacheRead**: the tokens that the model read again from the prompt cache.
- **fresh**: the new input tokens plus the tokens written to the cache.
- **cacheWrite** and **output**: the tokens written to the cache (part of fresh) and the tokens the model wrote. Both
  cost more per token than the rest, so price a run from the four counts: input (fresh less cacheWrite), cacheRead,
  cacheWrite and output. Take the prices from https://platform.claude.com/docs/en/about-claude/pricing.md and write
  the date you read it beside the result. On 2026-11-07 it gave Claude Sonnet 5.5 as $2 input, $2.50 for a 5-minute
  cache write, $0.10 for a cache read and $10 output, per million tokens. The cache read is not the usual 0.1x of input: the
  page says "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input
  price."
- **otherOrgs**: the orgs the run named other than its own, through `sf_start` or a Bash `sf` command's `-o` or
  `--target-org`. An alias and its username count as one org.
- **wallS**: the time from the first to the last transcript line, in seconds. Parallel runs and the org change this
  value, so use it only as context.
- **calls**: the tool calls of the run, less the `ToolSearch` calls that load a schema.

Since 2026-11-06 both testers, sf-tester (A, B, C) and pw-tester (D, E), load their tool schemas on demand through
`ToolSearch`, so compare runs from before that date only with each other. Each agent's own prompt still loads at the
start, and sf-tester's is about 25 kB against pw-tester's 3 kB, so compare `startCtx` within a family. An arm A run
starts at about 37.5k tokens on CLI 2.1.319 (55k before); a start near 55k means the deferral stopped working. B to E
are not measured yet, so D and E have no such figure.

Since 2026-11-06 `seed` takes a patch defect out of the working tree, so a tester that reads `test/fixture` sees the
source without the defect, and its git status does not name the file. Compare defect runs from before that date only
with each other.

The first result (2026-10-17, 4 targets, n = 3) was: arm C used 55% to 65% fewer cache-read tokens than arm A on
three targets. On the fourth target, the tool name is the route, and C used 17% fewer.

## Results of the run on 2026-10-20

The top-level README cites this run. It had 6 routes, 3 runs for each route and arm, thus 18 runs for each arm. All
72 runs passed. The table gives the mean of each arm (the `ALL` rows of `summary.tsv`).

| Arm | Tester | Model turns | cacheRead tokens | wallS |
|---|---|---|---|---|
| A | sf-tester, explores | 10 | 455,497 | 32 |
| C | sf-tester, one `sf_run_route` call | 4 | 169,096 | 20 |
| D | generic Playwright MCP agent, explores | 12 | 460,205 | 34 |
| E | generic Playwright MCP agent, with the route as a guide | 11 | 440,111 | 36 |

The routes: `combobox@record-tab`, `radio-decision@multi-screen-flow`, `record-picker@lightning-modal`,
`record-picker@record-tab`, `record-picker@screen-flow` and `rich-text@record-tab`. The run was before 2026-11-06, so
compare it only with runs before that date (see above). No arm had a defect to find in this run: it measures cost,
not the verdict.
