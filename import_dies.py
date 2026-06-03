#!/usr/bin/env python3
"""Import dies from dies_import.csv into the SmartShape inventory via the API."""

import requests
import sys
import os

BASE_URL = "https://app.smartshape.in"
EMAIL = "info@smartshape.in"
PASSWORD = "admin123"


def login(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    data = r.json()
    # Auth sets access_token cookie on the session automatically
    token = session.cookies.get("access_token")
    if not token:
        # Fallback: try response body
        token = data.get("access_token") or data.get("token")
    if not token:
        print("Login response:", data)
        print("Cookies:", dict(session.cookies))
        raise ValueError("No token found after login")
    print(f"Logged in as {data.get('name')} ({data.get('role')})")
    return token


def import_csv(session, csv_path):
    with open(csv_path, "rb") as f:
        r = session.post(
            f"{BASE_URL}/api/dies/import",
            files={"file": ("dies_import.csv", f, "text/csv")},
        )
    r.raise_for_status()
    result = r.json()
    print(f"\nImport result:")
    print(f"  Created          : {result.get('created', 0)}")
    print(f"  Duplicates (skip): {result.get('duplicates', 0)}")
    errors = result.get("errors", [])
    if errors:
        print(f"  Errors ({len(errors)}):")
        for e in errors:
            print(f"    - {e}")
    else:
        print("  Errors           : none")
    return result


def main():
    csv_path = os.path.join(os.path.dirname(__file__), "dies_import.csv")
    if not os.path.exists(csv_path):
        print(f"CSV not found: {csv_path}")
        sys.exit(1)

    print(f"Importing dies from: {csv_path}")
    print(f"Target: {BASE_URL}\n")

    session = requests.Session()
    login(session)
    import_csv(session, csv_path)


if __name__ == "__main__":
    main()
