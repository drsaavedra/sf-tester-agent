# sf-tester-agent

**Teach your agent to test like a Salesforce developer.** A Claude Code agent that tests a Salesforce change the way a developer does: it checks each user's access first, then tests the Lightning page as that user, and saves the route so you can replay it in CI with no model.

> **Preview.** This is a working proof of concept, not a finished tool. What it gets wrong is listed below and in [docs/known-limits.md](docs/known-limits.md).

**Access first**: Apex under `System.runAs` in a check-only deploy, nothing stays in the org · **Then the page**: 51 MCP tools built for Lightning, driven by Playwright, proved from the saved data · **Then replay**: a saved route took 4 model turns where finding it took 10, and in CI it needs no model at all

[Install](#install) · [Use](#use) · [How it works](#how-it-works) · [Where it loses](#where-it-loses) · [Known limits](#known-limits) · [Roadmap](#roadmap) · [Reference](docs/reference.md)

---

AI builds a Salesforce feature in minutes. Checking it as every user it affects still takes me longer than building it. I built sf-tester because I wanted to trust an agent with that check, and I could only trust it if it worked in the same order I do.

It is not a QA agent, and it does not replace QA. I trust my agent to write code. sf-tester is how I trust it to verify the code it writes, the way a developer does: who can see and change the data first, then the page as that user. When something fails, it looks for what is wrong: a missing permission, a component that is not on the page, an error the component threw.

The same requirement on the same scratch org, as the same user, with the same model (Claude Sonnet 5.5, 2026-11-15): "The Standard User can open the Case but cannot delete it."

| | A generic agent (Playwright MCP + read-only sf CLI) | sf-tester |
|---|---|---|
| **Order** | Opened the browser first. Read the profile's permissions last, with the CLI | Checked access first: Apex under `runAs` in a check-only deploy, 4 of 4 green, before any page |
| **Finding the way** | Explored the UI: 21 model turns, 25 tool calls | Took the route from its catalogue: 10 model turns, 16 tool calls |
| **Proof** | No Delete in the page's menus, and the profile's permission | `deletable: false` from the UI API as that user, and the Subject on the page and in the saved record |
| **The next run** | Wrote a 66-line Playwright script when the brief asked for one. It needed one fix, then replays with no model: PASS in 46 s | The saved route replays with no model: PASS in 36 s |
| **Time** | 78 s | 106 s |
| **Verdict** | PASS, correct | PASS, correct |

Both got it right, and the generic agent was faster. For one check, use it. The generic agent ran with my bench prompt ([bench/pw-tester-cli.md](bench/pw-tester-cli.md)); plain Claude Code with the same tools got it right too. What sf-tester adds is a developer's order and what stays after the run: each user's access as Apex under `runAs`, a verdict that code decides, and a route the next push replays with no model.

## Install

Needs Node 22.10+, the Salesforce CLI logged in to your org, Google Chrome and Claude Code. To test as a second user, the org needs "Administrators Can Log in as Any User" turned on.

```
git clone https://github.com/drsaavedra/sf-tester-agent && cd sf-tester-agent && npm ci
claude mcp add sf-tester -s user -- node "$PWD/src/server.js"
mkdir -p ~/.claude/agents && ln -s "$PWD/agents/sf-tester.md" ~/.claude/agents/sf-tester.md
```

`npm ci` installs Playwright (`playwright-core` 1.56.1, pinned). It drives your installed Google Chrome, so there is no browser download. Then start a new Claude Code session. The agent is listed as `sf-tester`. A one-command plugin install is on the [roadmap](#roadmap).

<details>
<summary>No Chrome, saving routes, the optional progress pane</summary>

- **No Chrome:** set `SF_TESTER_BROWSER=chromium` and run `npx playwright-core install chromium`.
- **Saving routes:** set `SF_TESTER_COMBINATIONS` to a catalogue file in your project. Replays and CI run only promoted routes. The tester promotes a route it replayed green. A route run as another user stays a draft until you promote it with `sf_promote_route`, and `SF_TESTER_PROMOTE=manual` leaves every route to you.
- **Progress pane (optional):** `claude plugin marketplace add "$PWD/claude-mod"`, then `claude plugin install sf-tester-pane@sf-tester`, then `/sf-tester-pane` in Claude Code. It shows each running tester's scenarios and steps.

</details>

## Use

Name the org, the Lightning app, the users and the requirements. The users matter most: an admin never hits a missing permission.

```
Org alias: my-scratch. App: Sales. Personas: the alias owner and a Standard User.
Requirement 1: The alias owner creates a Case from the New button with a Subject, and the record page shows it.
Requirement 2: The Standard User can open the Case but cannot delete it.
```

Both requirements passed on a scratch org on 2026-11-15. The saved route for requirement 2, replayed as the Standard User:

```
step 0  sf_verify_checks  Standard User: Case read true, create true, delete false     green, no browser
step 1  sf_open_record    the Case, as the Standard User
step 2  sf_actions        the actions the page offers this user
step 3  sf_api            /ui-api/object-info/Case as the user: deletable false
step 4  sf_assert_field   Subject, on the page and in the saved record                 PASS
```

And the two controls that had to go red, and did:

```
same route, check flipped to delete true    FAIL at step 0  VERIFY_NOT_GREEN
same route, run as the admin                FAIL at step 3  VALUE_MISMATCH: deletable is true, not false
```

Without the users, it stops and asks. A missing permission or a component not on the page comes back as a FAIL with its cause. It never fixes the org to make a test pass.

## How it works

1. **Maps from metadata.** The route comes from the org's metadata, not from the screen: the FlexiPage says where a component is, the layout says which fields are required, the permission sets say what each user can do.
2. **Checks access first, with no browser.** Six check kinds (`record`, `pageRequired`, `classAccess`, `apex`, `flow`, `componentVisible`). The Apex ones run as the persona in a generated test inside a check-only validate, so nothing stays in the org. `runAs` does not check Apex class access or layout-required fields, so those are read from metadata instead.
3. **Then tests the page as that user.** Each Lightning action (open a record, set fields, save, click) is one MCP tool, so a test is built from small known pieces. Playwright clicks in a real Chrome. The proof is the saved data, not what the page seemed to show.
4. **Saves the route and replays it.** A passing scenario saves its route with the persona it ran as. Once it is promoted, a replay runs in CI with no model, as a regression test. Before it runs, it checks the route against the org (app, page, permissions). If the org changed, it refuses the route and names what changed.

Guardrails: every one of the 51 tools carries a safety class, and a test fails for a tool with none. The agent's own hook keeps it off anything that deploys or edits. Every flag, check kind and error code: [docs/reference.md](docs/reference.md)

## Where it loses

The same 6 routes, 3 runs each, 18 runs per arm ([bench](bench/README.md), 2026-10-20):

| Arm | Model turns | Tokens |
|---|---|---|
| A generic Playwright MCP agent, exploring | 12 | 460k |
| sf-tester, exploring | 10 | 455k |
| sf-tester, replaying the saved route | 4 | 169k |

All three passed 18 of 18. The Lightning tools alone barely beat the generic agent: 17% fewer turns, 1% fewer tokens. The saved route is the win. If you test a page once and never again, a generic browser agent is fine.

## Known limits

- **Break runs.** I tried to break it on three scratch orgs: 93 findings, each reproduced by a second agent. By class: 13 false greens, 39 false reds, 19 unclear errors, 13 components with no tool, 9 crashes or hangs. 11 of the 42 fix-list entries are fixed in this preview. The open ones are listed in [docs/known-limits.md](docs/known-limits.md) with the tool and the case: until they are fixed, a PASS or FAIL in those cases can be wrong.
- **Lightning Experience only.** Every tool opens a `/lightning/` page. No Experience Cloud sites yet, and no Setup pages, because it never changes org settings. For Setup automation, see [sfdx-browserforce-plugin](https://github.com/amtrack/sfdx-browserforce-plugin).
- **English Lightning UI only.** It finds Lightning's own controls by their English names.
- **Screen flows** come back as `NEEDS BROWSER` from the access check: Salesforce refuses to start a screen flow from Apex.
- **Access first is not enforced yet.** The agent skips the access check, and says so in its report, when it has no project to read, on a production org, or for a user whose access comes from a permission set group.
- **The tester never deploys, edits metadata or edits code.** A tester that can fix the build can also hide what is wrong with it.

## Roadmap

- **One-command install** as a Claude Code plugin.
- **A glossary of every Lightning component, checked each Salesforce release.** Each component names the tool that drives it. Each release preview shows which tools still work and which new components need one. First run: the Spring '27 preview.
- **Access before every UI run**, with the persona saved in every route.
- **Screen flows in the access check.**
- **Experience Cloud sites.**
- **Parallel replay**, to cut a full catalogue replay: 341 routes took 67 minutes on 2026-11-15.

## Licence

Apache-2.0. Third-party code and credits: [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
