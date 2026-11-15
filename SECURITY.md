# Security

This is a preview. Only the latest commit on `main` gets fixes.

## Report a vulnerability

Use "Report a vulnerability" on the Security tab of this repository. It opens a private report. Do not open a
public issue for a security problem.

Tell me which tool or file it is in, how to reproduce it, and what an attacker gains.

## What sf-tester can reach

- It uses the Salesforce CLI login of the org alias you give it. It can do in that org what that login can do
  through the browser and the REST API.
- The agent's hook and the tool limits keep a tester off deploys and off edits of metadata and code. The rules are
  in [docs/tool-guidelines.md](docs/tool-guidelines.md). A way around them is a vulnerability: report it.
- Run it on a scratch org or a sandbox first. On a production org it runs only what the brief states.
