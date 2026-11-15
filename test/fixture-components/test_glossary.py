#!/usr/bin/env python3
"""Check glossary.py ticks only `driven` rows, stops on an unknown `tested` value, and prints the break run lines.

Run: python3 test/fixture-components/test_glossary.py
"""
import pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).parent
RUN = "## Break run\n\nsha:\ndate:\nusers:\n\n"
HEAD = "| id | group | row | doc URL | status | page | component API name | slice | note | tested |\n|---|---|---|---|---|---|---|---|---|---|\n"


def run(rows, block=RUN):
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "m.md").write_text(block + HEAD + "".join(f"| A6-{i:03} | lwc: x | c{i} | n/a | deployed | p |  |  |  | {t} |\n"
                                            for i, t in enumerate(rows)))
    p = subprocess.run([sys.executable, HERE / "glossary.py", d / "m.md", d], capture_output=True, text=True)
    return p, (d / "lwc.md").read_text() if p.returncode == 0 else ""


p, table = run(["driven", "seen", "no"])
assert p.returncode == 0, p.stderr
assert table.count("[x]") == 1 and table.count("[ ]") == 2, table
assert "1 driven, 1 seen, of 3 components." in table, table
assert "- Break run sha: not run yet\n- Break run date: not run yet\n- Break run users: not run yet" in table, table

p, table = run(["no"], RUN.replace("sha:", "sha: abc1234").replace("users:", "users: Probe Breaker"))
assert "- Break run sha: abc1234\n- Break run date: not run yet\n- Break run users: Probe Breaker" in table, table

p, _ = run(["no"], "")
assert p.returncode != 0 and "needs the lines" in p.stderr, (p.returncode, p.stderr)

p, _ = run(["no", "yes"])
assert p.returncode != 0 and "A6-001" in p.stderr, (p.returncode, p.stderr)
print("ok")
