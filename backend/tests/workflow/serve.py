"""T2 live API launcher: the real FastAPI app on the named Firestore database ``t2-workflow``.

Usage (from the repo root, emulators running)::

    APP_ENV=development PAYMENT_PROVIDER=dev FIREBASE_PROJECT_ID=demo-taki \
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 CRON_SECRET=t2-cron-secret-0123456789 \
    backend/.venv/Scripts/python backend/tests/workflow/serve.py --port 8020

Identical to ``uvicorn app.main:app --app-dir backend --port 8020`` except that every repository
call goes to the named database (other testers wipe ``(default)``).
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(os.path.dirname(HERE))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8020)
    p.add_argument("--database", default=os.environ.get("T2_DATABASE", "t2-workflow"))
    args = p.parse_args()

    import uvicorn

    from app.repositories import base

    base.use_database(args.database)
    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
