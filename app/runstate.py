"""In-process registry of active run streams, so /api/runs/{id}/stop can cancel a run
that some other browser tab (or nobody) is watching. Lives in its own module to avoid an
import cycle between main.py (which registers runs) and db_api.py (which stops them)."""
from __future__ import annotations

import asyncio

ACTIVE: dict[str, asyncio.Event] = {}
