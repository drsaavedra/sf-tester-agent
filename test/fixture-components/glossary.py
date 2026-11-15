#!/usr/bin/env python3
"""Write one glossary table per surface from the fixture manifest.

Usage: glossary.py <manifest.md> <out dir>
A box is ticked only when the manifest row's `tested` column says `driven`; any value but driven, seen or no stops it.
Each table prints the `## Break run` lines (sha, date, users) under its title; a manifest without them stops it.
"""
import sys, re, pathlib, collections

SURFACES = {"lwc": "LWC", "aura": "Aura", "lightning ui": "Lightning UI", "flow": "Flow"}
SHOW_NOTE = {"limitation", "NOT DEPLOYABLE", "not UI"}
TESTED = {"driven", "seen", "no"}
RUN_KEYS = ("sha", "date", "users")


def surface(rid, group, row):
    head = group.split(":", 1)[0].strip().lower()
    if ":" in group and head in SURFACES:
        return SURFACES[head]
    prefix = rid.split("-", 1)[0]
    if prefix in ("A1", "A2", "A3", "A4", "A5"):
        return "Lightning UI"
    if prefix == "A6":
        g = group.strip().lower()
        return "Flow" if g.startswith("flow") else "Lightning UI" if g.startswith("overlay") else "LWC"
    if prefix == "A7":
        return "Aura"
    if prefix == "GAP":
        return "Flow" if row.lower().startswith("flow") else "Lightning UI"
    return None  # P rows are tool pairs, not components


def rows(manifest):
    cols = None
    for line in pathlib.Path(manifest).read_text().splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cols is None:
            cols = cells
        elif not set(line) <= set("|-: "):
            yield dict(zip(cols, cells))


def break_run(manifest):
    m = re.search(r"^## Break run\n(.*?)(?=^## |\Z)", pathlib.Path(manifest).read_text(), re.M | re.S)
    found = dict(re.findall(r"^(sha|date|users):[ \t]*(.*)$", m.group(1), re.M)) if m else {}
    if set(found) != set(RUN_KEYS):
        sys.exit(f"{manifest}: the '## Break run' block needs the lines sha:, date:, users:")
    return [f"- Break run {k}: {found[k].strip() or 'not run yet'}" for k in RUN_KEYS]


def main(manifest, out):
    run = break_run(manifest)
    tables, skipped, total = collections.defaultdict(list), 0, 0
    for r in rows(manifest):
        total += 1
        if r.get("tested") not in TESTED:
            sys.exit(f"{r['id']}: tested is {r.get('tested')!r}, expected one of driven, seen, no")
        s = surface(r["id"], r["group"], r["row"])
        if s is None or "the same shape as " in r["note"]:  # pairs, and reference pages that repeat a row
            skipped += 1
            continue
        tables[s].append(r)
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for s, rs in sorted(tables.items()):
        ticked = sum(r["tested"] == "driven" for r in rs)
        seen = sum(r["tested"] == "seen" for r in rs)
        lines = [f"# {s}: what sf-tester can test", "", *run, "",
                 f"{ticked} driven, {seen} seen, of {len(rs)} components.", "",
                 "Generated from `test/fixture-components/manifest.md`. A box is ticked only when a break run has"
                 " driven the component with sf-tester's tools; `seen` means it was only seen on the page.", ""]
        by_group = collections.defaultdict(list)
        for r in rs:
            by_group[r["group"]].append(r)
        for g, grs in by_group.items():
            lines += [f"## {g}", "", "| Component | Can be tested | In the fixture | Note |", "|---|---|---|---|"]
            for r in grs:
                box = "[x]" if r["tested"] == "driven" else "[ ]"
                name = r["row"]
                if r["doc URL"].startswith("http"):
                    name = f"[{name}]({r['doc URL']})"
                note = r["note"] if r["status"] in SHOW_NOTE else ""
                lines.append(f"| {name} | {box} | {r['status']} | {note} |")
            lines.append("")
        f = out / (re.sub(r"\W+", "-", s.lower()) + ".md")
        f.write_text("\n".join(lines))
        print(f"{s}: {len(rs)} rows, {ticked} ticked -> {f}")
    print(f"read {total}, tabled {total - skipped}, skipped {skipped} (P pairs and repeated shapes)")


if __name__ == "__main__":
    main(*sys.argv[1:3])
