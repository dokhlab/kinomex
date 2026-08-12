"""Bring the local database to the minimum schema required by the website."""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from etl.database import connect, disconnect, get_db
from etl.pipeline import run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("kinomex.auto_populate")

STARTUP_SCHEMA_VERSION = 1
MIGRATION_DOCUMENT_ID = "startup-migrations"
SWISS_PROT_MIGRATION = "swiss_prot_annotations_v1"
SWISS_PROT_FIELDS = (
    "uniprot_section",
    "function_annotations",
    "catalytic_activities",
    "subunit_annotations",
    "annotation_source",
)


def _missing_swiss_prot_query() -> dict[str, Any]:
    """Find current catalogue records that predate Swiss-Prot annotations."""
    return {
        "reviewed": True,
        "catalog_membership": {"$in": ["kinhub_core", "uniprot_extended"]},
        "$or": [{field: {"$exists": False}} for field in SWISS_PROT_FIELDS],
    }


def _step_succeeded(results: dict[str, Any], step: str) -> bool:
    return results.get(step, {}).get("status") == "ok"


async def _run_catalog_refresh() -> None:
    """Refresh both keyword and KinHub-only reviewed UniProt records."""
    await disconnect()
    results = await run_pipeline(step_names=["kinhub"])
    if not _step_succeeded(results, "uniprot") or not _step_succeeded(results, "kinhub"):
        failed = [
            name for name in ("uniprot", "kinhub")
            if not _step_succeeded(results, name)
        ]
        raise RuntimeError(f"Required catalogue refresh failed: {', '.join(failed)}")
    await connect()


async def main() -> None:
    await connect()
    try:
        db = get_db()
        kinase_count = await db.kinases.count_documents({})
        migration_state = await db.catalog_metadata.find_one(
            {"_id": MIGRATION_DOCUMENT_ID}
        )
        recorded_version = (migration_state or {}).get("schema_version", 0)
        migration_recorded = bool(
            (migration_state or {}).get("migrations", {}).get(SWISS_PROT_MIGRATION)
        )
        catalog_refreshed = False
        missing_annotations = (
            await db.kinases.count_documents(_missing_swiss_prot_query())
            if kinase_count
            else 0
        )

        if kinase_count == 0:
            logger.info("Database empty — importing the reviewed kinase catalogue")
            await _run_catalog_refresh()
            catalog_refreshed = True
            db = get_db()
        elif recorded_version < STARTUP_SCHEMA_VERSION or missing_annotations:
            logger.info(
                "Catalogue update required (schema %s → %s; %d records missing annotations)",
                recorded_version,
                STARTUP_SCHEMA_VERSION,
                missing_annotations,
            )
            await _run_catalog_refresh()
            catalog_refreshed = True
            db = get_db()
        else:
            logger.info("Database schema and required catalogue imports are current")

        missing_after = await db.kinases.count_documents(_missing_swiss_prot_query())
        if missing_after:
            raise RuntimeError(
                f"Catalogue update incomplete: {missing_after} reviewed records still "
                "lack required Swiss-Prot annotation fields"
            )

        if catalog_refreshed or recorded_version < STARTUP_SCHEMA_VERSION or not migration_recorded:
            now = datetime.now(timezone.utc)
            await db.catalog_metadata.update_one(
                {"_id": MIGRATION_DOCUMENT_ID},
                {
                    "$set": {
                        "schema_version": STARTUP_SCHEMA_VERSION,
                        "updated_at": now,
                        f"migrations.{SWISS_PROT_MIGRATION}": {
                            "completed_at": now,
                            "required_fields": list(SWISS_PROT_FIELDS),
                        },
                    }
                },
                upsert=True,
            )

        scientific_collections = [
            "bioactivities", "variants", "diseases", "expression", "pdis", "structures"
        ]
        coll_counts = {
            name: await db[name].count_documents({}) for name in scientific_collections
        }
        missing = [name for name, count in coll_counts.items() if count == 0]
        if missing:
            logger.warning(
                "Verified data absent from collections: %s. Run `python -m etl.pipeline` "
                "to retrieve authoritative records; synthetic fallback data is disabled.",
                ", ".join(missing),
            )
        else:
            logger.info("All scientific collections contain data")
    finally:
        await disconnect()


if __name__ == "__main__":
    asyncio.run(main())
