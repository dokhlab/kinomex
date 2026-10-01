"""Calculate a fresh candidate PDIS snapshot without touching live scores."""
from __future__ import annotations

import asyncio
import os

from .database import connect, disconnect, ensure_indexes, get_db, COLLECTIONS
from .ingestors.pdis_calculator import ingest_pdis


async def main() -> None:
    os.environ["KINOMEX_PDIS_TARGET_COLLECTION"] = COLLECTIONS["pdis_candidate"]
    try:
        await connect()
        await ensure_indexes()
        await get_db()[COLLECTIONS["pdis_candidate"]].delete_many({})
        print(f"Candidate records: {await ingest_pdis()}")
    finally:
        await disconnect()


if __name__ == "__main__":
    asyncio.run(main())
