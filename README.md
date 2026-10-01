# KinomeX

KinomeX is a source-linked atlas of 678 human kinase entries (522 KinHub core + 156 UniProt extensions).
The KinHub core holds the KinHub/Manning roster reconciled to reviewed UniProt accessions; the extensions are
reviewed human UniProt entries with the Kinase keyword (KW-0418) and no KinHub row, each assigned one of seven
extension classes. The web resource runs at <https://kinomex.dokhlab.org> and requires no login.

This release reports the snapshot of 2026-09-30. It holds 10,043 experimental structures (RCSB PDB, ≤3.5 Å),
1,021,421 ligand records (ChEMBL and PubChem AID 1433), 63,649 ClinVar records, and 36,396 GTEx records.
Every page and API response reads its counts from `GET /api/catalog/accounting`; the release test
(`scripts/release_check.mjs`) fails when this README or any page disagrees with that endpoint.

Paper: KinomeX, *Journal of Molecular Biology* (manuscript JMB-D-26-01062, in revision). The link follows publication.

## Features

- **Explorer** (`/explorer`): partition and category filters (ten KinHub groups, seven extension classes), evidence
  filters (maximum citations, experimental structure, minimum distinct compounds), GTEx tissue enrichment, and
  adjustable PDIS weights with presets. The browser recomputes scores, ranks, the 20-bin histogram, and the PDIS
  interval; the address stores the weights (`?w=0.25,0.25,0.25,0.25`); “Export CSV” writes the filtered table.
- **Dossier** (`/kinases/{gene}`): PDIS components with raw inputs; paginated experimental structures with method,
  resolution, EMDB accession, and bound ligands; the AlphaFold DB model colored by pLDDT; GTEx v10 expression;
  one representative ligand row per source compound, expandable to every record; ClinVar classifications with review
  status; literature-curated mutations; STRING network; UniProt diseases.
- **Tutorial** (`/tutorial`): Protocols S1–S3 with “Try it” links.
- **Research assistant** (`/search`, optional): source-linked answers. Literature-derived statements appear only
  with a matching PubMed ID and DOI. This check confirms that the cited article exists; it does not confirm that
  the article supports the statement. Read the cited source before relying on a statement.

## PDIS

PDIS (formula `3.0-weighted-mean`, 0–100) is the weighted mean of four components: citations
`100·ln(1+n)/ln(1+n_max)`, clinical trials `min(100, t)`, structures `0.6·s(best) + 0.4·s(mean)` with
`s(r) = clamp(100·(4.0−r)/2.5, 0, 100)`, and compounds `100·ln(1+c)/ln(1+c_max)`. The default weights are
0.30/0.30/0.15/0.15. PDIS summarizes documented development evidence; it does not measure biological importance,
efficacy, safety, or clinical priority.

## API

| Endpoint | Content |
|---|---|
| `GET /api/catalog/accounting` | Entry, group, class, and per-source counts with coverage gaps and the snapshot date |
| `GET /api/catalog/table` | All entries with the four stored PDIS components |
| `GET /api/kinases?weights=a,b,c,d&sort=pdis&partition=kinhub_core` | Filtered, weighted, ranked entries (`pdis_default`, `pdis_weighted`, `rank_weighted`) |
| `GET /api/kinases/{gene}` | Dossier, including `pdis_score.components`, `raw_values`, `default_weights`, `formula_version` |
| `GET /api/kinases/{gene}/structures?page=` | Scored experimental structures, 25 per page |
| `GET /api/kinases/{gene}/ligands?uncensored=1` | Representative ligand rows; `/ligands/records?compound_key=` lists the underlying records |

## Development

```bash
npm install
npm test                                   # Jest unit tests
KINOMEX_DB_TESTS=1 npm test                # adds the database checks against MONGODB_URI/MONGODB_DB_NAME
python -m pytest etl/tests                 # ETL unit tests
node scripts/release_check.mjs --base=http://localhost:3000 --render
```

The ETL modules in `etl/jmb_revision/` cache every upstream response under
`/home/html/storage/kinomex/jmb_revision_cache/` before they write to MongoDB, so a database can be rebuilt from
the frozen snapshot without new queries. Data attributions and reuse terms: see `NOTICE.md` and `/docs` (Attributions).
