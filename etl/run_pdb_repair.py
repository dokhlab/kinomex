"""Run the kinase-specific PDB repair without refreshing UniProt."""
from __future__ import annotations

import asyncio

from .database import connect, disconnect, ensure_indexes
from .ingestors.pdb_ingestor import ingest_structures


async def main() -> None:
    try:
        await connect()
        await ensure_indexes()
        print(f"Mapped structures: {await ingest_structures()}")
    finally:
        await disconnect()


if __name__ == "__main__":
    asyncio.run(main())
