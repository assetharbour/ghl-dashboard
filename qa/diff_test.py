"""Differential test: the Python reference (sales_metrics.py) and the dashboard's JavaScript port must agree on
random data. Generates cases, runs both implementations, compares every number."""
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(DASH), "ghl-reporting-sync"))
from app import sales_metrics as sm  # noqa: E402

NOW = datetime(2026, 10, 22, 12, 0, 0, tzinfo=timezone.utc)
STATUS = ["new", "confirmed", "confirmed", "showed", "showed", "showed", "noshow", "cancelled", "invalid", ""]
BOOKERS = ["Hugo Sharpe", "Ava Morris-Boundy", "Harry Kalsi", "Sarah Bennett", "", "Ava Mae Morris-Boundy"]
ADVISORS = ["Joe Nicholls", "Xavier Collin", "Cecilia Szabo", "Henny Lessey", "", "Anita Andrews"]
OUTCOMES = ["Full Fact Find Took Place - YES", "Full Fact Find took place: Yes", "Advice Given - YES", "Review - YES", "Annual Review - YES", "Amendment - YES", "", "  full fact find "]


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def make_case(seed):
    rnd = random.Random(seed)
    n_contacts = rnd.randint(5, 150)
    contacts = {}
    for i in range(n_contacts):
        completed = rnd.random() < 0.25
        done = NOW - timedelta(days=rnd.randint(-5, 120))
        contacts[f"c{i}"] = {
            "fact_find_outcome": rnd.choice(OUTCOMES),
            "completed": completed,
            "completed_at": rnd.choice([iso(done)[:10], iso(done), ""]) if completed else "",
        }
    appts = []
    for i in range(rnd.randint(0, 600)):
        booked = NOW - timedelta(days=rnd.uniform(-2, 100), seconds=rnd.randint(0, 86400))
        start = booked + timedelta(days=rnd.uniform(-1, 14))
        appts.append({
            "appointment_id": f"a{i}", "contact_id": rnd.choice([f"c{rnd.randrange(n_contacts)}", ""] if rnd.random() < 0.03 else [f"c{rnd.randrange(n_contacts)}"]),
            "booked_by_official": rnd.choice(BOOKERS), "advisor": rnd.choice(ADVISORS),
            "booked_at": iso(booked) if rnd.random() > 0.02 else "", "start_time": iso(start) if rnd.random() > 0.02 else "",
            "status": rnd.choice(STATUS), "deleted": "TRUE" if rnd.random() < 0.05 else "",
        })
    period = rnd.choice([None, (NOW - timedelta(days=rnd.randint(7, 60)), NOW - timedelta(days=rnd.randint(-5, 6))), (NOW - timedelta(days=30), None)])
    return {"appts": appts, "contacts": contacts, "period": period}


def py_fair(case):
    start, end = case["period"] if case["period"] else (None, None)
    return {r["person"]: [r["appointments"], r["share"], r["vs_equal"]] for r in sm.round_robin_fairness(case["appts"], ["Henny Lessey", "Joe Nicholls", "Xavier Collin", "Cecilia Szabo"], start=start, end=end)}


def py_table(case, group):
    start, end = case["period"] if case["period"] else (None, None)
    rows = sm.build(case["appts"], case["contacts"], NOW, start=start, end=end, group_by="booked_by" if group == "booker" else "advisor",
                    sales_team=["Harry Kalsi", "Ava Morris-Boundy", "Hugo Sharpe"])
    out = {}
    for r in rows:
        out[r["person"]] = {
            "booked": r["booked"], "cancelled": r["cancelled"], "noShow": r["no_show"], "rebooked": r["rebooked"], "showed": r["showed"], "upcoming": r["upcoming"],
            "due": r["due"], "fullFactFinds": r["full_fact_finds"], "completed": r["completed"], "isSalesTeam": r["is_sales_team"],
            "conversion": r["conversion"], "conversionToCompletion": r["conversion_to_completion"], "completionPerFullFf": r["completion_per_full_ff"],
            "showRate": r["show_rate"], "ffPerShow": r["ff_per_show"],
        }
    return out


cases = [make_case(s) for s in range(60)]
payload = [{"appts": c["appts"], "contacts": c["contacts"],
            "start": iso(c["period"][0]) if c["period"] and c["period"][0] else None,
            "end": iso(c["period"][1]) if c["period"] and c["period"][1] else None} for c in cases]
with open(os.path.join(HERE, "diff_cases.json"), "w", encoding="utf-8") as fh:
    json.dump({"now": iso(NOW), "cases": payload}, fh)

js = subprocess.run(["npx", "vite-node", "qa/diff_run.mjs"], capture_output=True, text=True, encoding="utf-8", cwd=DASH, shell=True)
if js.returncode != 0:
    print(js.stderr[-1500:])
    sys.exit(1)
js_out = json.loads(js.stdout)

mismatches, compared = [], 0
for idx, case in enumerate(cases):
    for group in ("booker", "advisor"):
        expected, actual = py_table(case, group), js_out[idx][group]
        if set(expected) != set(actual):
            mismatches.append((idx, group, "people", sorted(set(expected) ^ set(actual))))
            continue
        for person, row in expected.items():
            for key, value in row.items():
                compared += 1
                got = actual[person][key]
                same = (value is None and got is None) or (isinstance(value, (int, float)) and got is not None and not isinstance(value, bool) and abs(float(value) - float(got)) < 1e-9) or value == got
                if not same:
                    mismatches.append((idx, group, person, key, value, got))
for idx, case in enumerate(cases):
    expected, actual = py_fair(case), js_out[idx]["fair"]
    if set(expected) != set(actual):
        mismatches.append((idx, "fair", "people", sorted(set(expected) ^ set(actual))))
        continue
    for person, vals in expected.items():
        for k, (a, b) in enumerate(zip(vals, actual[person])):
            compared += 1
            if not ((a is None and b is None) or (a is not None and b is not None and abs(a - b) < 1e-9)):
                mismatches.append((idx, "fair", person, k, a, b))
print("cases:", len(cases), "| values compared:", compared, "| mismatches:", len(mismatches))
for m in mismatches[:12]:
    print("  ", m)
