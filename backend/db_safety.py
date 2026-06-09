"""
Production safety guard for standalone DB scripts (seeders, migrations, fixers).

Any script that connects to MongoDB directly and writes/wipes data should call
`guard_destructive_db(DB_NAME)` BEFORE touching the database. If the target DB
looks like production, the script aborts unless the operator has explicitly set
the ALLOW_PROD_WIPE environment variable.

This exists because seed scripts default to DB_NAME=smartshape_prod and call
delete_many({}) on every collection — one careless run would erase the business.
"""
import os
import sys

_TRUE = {"1", "true", "yes", "on"}


def is_prod_db(db_name: str) -> bool:
    """Heuristic: any DB whose name contains 'prod' is treated as production."""
    return "prod" in (db_name or "").lower()


def prod_wipe_allowed() -> bool:
    return os.environ.get("ALLOW_PROD_WIPE", "").strip().lower() in _TRUE


def guard_destructive_db(db_name: str, action: str = "modify or seed") -> None:
    """Abort the process if pointed at a production DB without explicit opt-in."""
    if not is_prod_db(db_name):
        return
    if prod_wipe_allowed():
        sys.stderr.write(
            f"[db_safety] ALLOW_PROD_WIPE is set — proceeding against PRODUCTION "
            f"database '{db_name}'.\n"
        )
        return
    sys.stderr.write(
        "\n" + "=" * 72 + "\n"
        f"  REFUSING TO RUN — target database is '{db_name}' (looks like PRODUCTION).\n"
        f"  This script would {action} live data and can PERMANENTLY DESTROY it.\n\n"
        "  If you are absolutely certain, re-run with the explicit opt-in:\n"
        "      bash/zsh :  ALLOW_PROD_WIPE=1 python <script>.py\n"
        "      PowerShell:  $env:ALLOW_PROD_WIPE=1; python <script>.py\n"
        + "=" * 72 + "\n\n"
    )
    raise SystemExit(2)
