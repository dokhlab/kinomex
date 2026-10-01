"""Promote a validated candidate PDIS snapshot to the live collection."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from .database import COLLECTIONS, connect, disconnect, ensure_indexes, get_db

logger = logging.getLogger("kinomex.promote_pdis")


async def promote() -> int:
    await connect()
    try:
        db = get_db()
        await ensure_indexes()
        run_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        candidate = await db[COLLECTIONS["pdis_candidate"]].find({}, {"_id": 0}).to_list(length=None)
        kinase_genes = set(await db[COLLECTIONS["kinases"]].distinct("gene_symbol"))
        candidate_genes = {doc.get("gene_symbol") for doc in candidate if doc.get("gene_symbol")}

        if candidate_genes != kinase_genes:
            missing = sorted(kinase_genes - candidate_genes)
            extra = sorted(candidate_genes - kinase_genes)
            raise RuntimeError(
                f"Candidate PDIS coverage mismatch: missing={missing[:10]} extra={extra[:10]}"
            )

        live = await db[COLLECTIONS["pdis"]].find({}, {"_id": 0}).to_list(length=None)
        if live:
            await db["pdis_history"].insert_one({
                "run_id": run_id,
                "archived_at": now,
                "records": live,
            })

        await db[COLLECTIONS["pdis"]].delete_many({})
        if candidate:
            await db[COLLECTIONS["pdis"]].insert_many(candidate, ordered=False)
        await db["pdis_runs"].insert_one({
            "run_id": run_id,
            "promoted_at": now,
            "candidate_count": len(candidate),
            "previous_count": len(live),
            "score_version": "2.0-evidence-only",
        })
        logger.info("Promoted %d PDIS records; archived %d previous records", len(candidate), len(live))
        return len(candidate)
    finally:
        await disconnect()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    try:
        count = asyncio.run(promote())
        print(f"Promoted {count} PDIS records")
    finally:
        # The async helper owns the client lifecycle during normal execution.
        pass


if __name__ == "__main__":
    main()
