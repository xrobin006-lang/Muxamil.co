#!/usr/bin/env python3
"""Export legacy Work Guideline SQLite business data to JSON for one-time import.

This does not export password hashes or Supabase identity IDs. The import maps
members to the canonical Muxamil account when they next sign in by email.
"""
from __future__ import annotations
import argparse
import json
import sqlite3
from pathlib import Path

TABLES = [
    "User", "Currency", "RewardsProgram", "ProgramGuide", "CardRate",
    "PaymentMethod", "TutorialStep", "TutorialProgress", "Submission",
    "SubmissionStatusHistory", "PaymentRecord", "Notification", "SiteSetting",
    "AdminAuditLog", "ContactMessage",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", help="Path to the old Work Guideline db/custom.db")
    parser.add_argument("--out", default="work-guideline-legacy-data.json", help="Output JSON path")
    args = parser.parse_args()

    source = Path(args.database).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"SQLite database not found: {source}")

    connection = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    available = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    payload: dict[str, list[dict]] = {}
    for table in TABLES:
        if table not in available:
            payload[table] = []
            continue
        rows = [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
        if table == "User":
            for row in rows:
                # Never bring legacy password identity/privilege into Muxamil.
                row.pop("supabaseUserId", None)
                row["role"] = "USER"
                row["email"] = (row.get("email") or "").strip().lower()
        payload[table] = rows
    connection.close()

    output = Path(args.out).expanduser().resolve()
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Exported business data to {output}")
    print("Counts: " + ", ".join(f"{name}={len(rows)}" for name, rows in payload.items()))
    print("Security: password hashes and legacy Supabase user IDs were not exported.")


if __name__ == "__main__":
    main()
