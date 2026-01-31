#!/usr/bin/env python
"""Pretty print all users in the database."""

import sqlite3
from pathlib import Path

db_path = Path(__file__).parent.parent / "squill.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

cursor.execute("SELECT * FROM users")
rows = cursor.fetchall()

if not rows:
    print("No users found.")
else:
    for row in rows:
        print("-" * 60)
        for key in row.keys():
            print(f"{key:25} : {row[key]}")
    print("-" * 60)
    print(f"\nTotal: {len(rows)} user(s)")

conn.close()
