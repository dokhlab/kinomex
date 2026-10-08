# KinomeX JMB revision: verification report

Manuscript JMB-D-26-01062. Snapshot 2026-09-30. This report follows Section 5 of the update instructions.

## 1. Summary

| Item | Value |
|---|---|
| Code | GitHub `dokhlab/kinomex`, branch `jmb-revision` (built on `main` `d9954fd`); local baseline tag `pre-jmb-revision` |
| Deployed commit | `65e39c2` (same tree as GitHub `jmb-revision` `54fda70`), deployed 2026-10-01 at 14:05 UTC to `https://kinomex.dokhlab.org` |
| Release tag | `v1.1.0-jmb` not created yet (requires a GitHub token; the deploy key can push branches only) |
| Production data | Release modules applied to `kinomex` on 2026-10-01 from the frozen 2026-09-30 cache; the production audit (`audit/database-audit-2026-10-01.json`; accounting in `audit/catalog-accounting-2026-10-01.json`) equals the audit of the verified copy database in every value |
| Release test (Task 1.6) | `scripts/release_check.mjs --render` against `https://kinomex.dokhlab.org`: **38/38 checks pass** (`audit/release-check-2026-10-01.json`) |
| Automated tests | Jest 138 passed (+6 database checks that pass with `KINOMEX_DB_TESTS=1`); pytest 89 passed; `next build` succeeds |
| Analysis re-run (Task 12.2) | The six manuscript scripts run unchanged through `audit/analysis/adapt_schema.py`; against the live API (`audit/analysis/production-2026-10-01/`): 1,696 of 1,704 values equal `analysis_results_2026-09-30.json`; Section 3.3 explains the 8 differences |
| Backups | `storage/kinomex/backups/kinomex-pre-jmb-revision-20260930.archive.gz` (sha256 `a340c927…62cdd`); immediately before deployment `kinomex-pre-deploy-20261001T140023.archive.gz` (sha256 `dbfa4282…4a38`) |

## 2. Ledger check

Observed values come from the migrated copy database through the preview API, the release audit (`audit/analysis/preview-2026-09-30/database-audit-kinomex_jmb.json`), and the analysis re-run.

### 2.1 Catalog

| Quantity | Expected | Observed | Result |
|---|---|---|---|
| Catalog entries / core / extensions | 678 / 522 / 156 | 678 / 522 / 156 | PASS |
| KinHub kinase-domain rows | 536 | 536 | PASS |
| Reviewed human KW-0418 entries | 625 | 625 (catalog metadata) | PASS |
| KW-0418 entries overlapping KinHub / KinHub outside KW-0418 | 469 / 53 | 469 / 53 | PASS |
| Reviewed human KW-0723 or KW-0829 | 469 | not re-queried (no UniProt query in this update) | NOT CHECKED |
| Inactive historical entry | PRKY (O43930) | PRKY (O43930), status inactive | PASS |
| Core group counts | AGC 63, CAMK 74, CK1 12, CMGC 63, STE 47, TK 90, TKL 43, RGC 5, Atypical 44, Other 81 | same | PASS |
| Extension class counts | 5, 38, 11, 36, 38, 20, 8 | 5, 38, 11, 36, 38, 20, 8 | PASS |
| Legacy display of extensions | Atypical 150, CMGC 2, CAMK 2, AGC 1, TK 1 | same (`legacy_displayed_group`) | PASS |
| Core entries with PS50011/PF00069/PF07714 | 476 | 476 | PASS |
| Core entries with KW-0723/KW-0829 | 461 | 461 | PASS |
| Pharos TDL, core | Tclin 65, Tchem 346, Tbio 97, Tdark 12, unmapped 2 | same | PASS |
| Pharos TDL, all | Tclin 69, Tchem 387, Tbio 200, Tdark 20, unmapped 2 | same (unmapped: GTF2F1, TRIM66) | PASS |

### 2.2 Evidence records and coverage (Table 1)

| Quantity | Expected | Observed | Result |
|---|---|---|---|
| Experimental structures (≤3.5 Å) | 10,043 | 10,043 | PASS (see 3.2 for the scope of this set) |
| Entries with a structure / gap (core) | 476 / 202 (384) | 476 / 202 (384) | PASS |
| RCSB mapped entries (all / ≤3.5 Å / cryo-EM ≤3.5 Å) | 10,938 / 10,184 / 390 | 10,938 / 10,184 / 390 on 2026-09-30 | PASS |
| AlphaFold DB models / gap | 671 / 7 | **667 / 11** | **FAIL** (cause below) |
| Ligand records | 1,021,421 (1,019,354 ChEMBL; 2,067 PubChem) | same | PASS |
| Compound–kinase pairs | 717,452 | 717,452 | PASS |
| Entries with ligand records / gap (core) | 566 / 112 (472) | 566 / 112 (472) | PASS |
| Quarantined legacy ChEMBL rows | 43,720 | **no quarantine collection exists** in the database or the 2026-08-14 and 2026-09-30 backups | **FAIL** (cannot verify) |
| PubChem assay | AID 1433 only | AID 1433 only | PASS |
| GTEx records / genes / gap | 36,396 / 674 / 4 | 36,396 / 674 / 4 (gaps GK3, PRP4K, TSSK2, WHR1) | PASS |
| Quarantined non-GTEx expression rows | 322 on 161 genes | 322 on 161 genes (`expression_quarantine`) | PASS |
| ClinVar records / genes / gap | 63,649 / 260 / 418 | 63,649 / 260 / 418 | PASS |
| Literature-curated mutations | 87 on 36 genes | 87 on 36 genes | PASS |
| UniProt disease documents / gap | 256 / 422 | 256 / 422 | PASS |
| PDIS documents | 678 | 678 | PASS |
| Entries with ≥1 PubMed count / gap | 671 / 7 | 671 / 7 | PASS |
| Entries with ≥1 counted trial / gap | 168 / 510 | 168 / 510 | PASS |
| Pharos TDL assignments / gap | 676 / 2 | 676 / 2 | PASS |

**AlphaFold DB (FAIL).** Task 8.5 defines the model as `AF-<UniProt>-F1`. Seven accessions return no prediction (ATM, OBSCN, PRKDC, SEPHS2, TRIM66, TRRAP, TTN, as expected). Four more (KALRN, SMG1, SPEG, TRIO) return only isoform models (for example `AF-Q15772-4-F1`, 113 residues of SPEG) and no F1 model of the canonical accession. `analysis/ext.py` counted any non-empty response, which gives 671. Corrected sentence: “AlphaFold DB provides a model for 667 entries; 11 entries have no model of the canonical accession.”

**Quarantined legacy ChEMBL rows (FAIL).** The database holds no collection with legacy ChEMBL rows, and neither backup contains one. KinomeX cannot display or verify 43,720. The author either removes the number or supplies its source; the accounting endpoint reports `bioactivities_quarantine` as unavailable.

### 2.3 PDIS

| Quantity | Expected | Observed | Result |
|---|---|---|---|
| n_max | 33,585 (EGFR) | 33,585 (EGFR) | PASS |
| c_max | 25,763 (PLK1) | 25,763 (PLK1) | PASS |
| Default weights | 0.30/0.30/0.15/0.15 | same | PASS |
| Range; maximum entry | 0–96.36; EGFR 100, 100, 83.52, 94.62; best 1.07 Å; mean 2.53 Å; 14,911 compounds; 432 trials | same | PASS |
| Entries at 0 | 5 | 5 (HYKK, PDPK2P, PMS2P1, PMS2P11, PRPS1L1) | PASS |
| Median; entries ≥ 50 | 33.3; 71 | 33.28; 71 | PASS |
| Top 10 | EGFR 96.36 … KDR 87.52 | same order and values | PASS |
| Spearman ρ, revised vs submitted | 0.941 | 0.9406 | PASS |
| Submitted maximum | 95.74 (EGFR) | 95.74 (archived `pdis_history`) | PASS |
| Legacy compound table: max; entries at 0; current-ligand entries with legacy 0 | 23; 407; 295 | 23; 407; 295 | PASS |
| Legacy-zero examples | MTOR 9,292; JAK2 15,839; PIK3CA 11,661; CDK4 4,410; BCR 1,183 | current counts match; **legacy counts: MTOR 0, CDK4 0, BCR 0, JAK2 9, PIK3CA 1** | **FAIL** |
| All 678 components and totals vs `expected_pdis_2026-09-30.csv` | within 0.01 | all totals and ranks equal exactly | PASS |

**Legacy-zero examples (FAIL).** `analysis.py` lists the five genes with their current compound counts but does not test their legacy value. JAK2 and PIK3CA had legacy counts of 9 and 1. Corrected sentence: “The legacy table assigns no compound to entries with extensive ligand records, for example MTOR (9,292 compounds), CDK4 (4,410), and BCR (1,183), and nearly none to JAK2 (9 of 15,839) and PIK3CA (1 of 11,661).”

### 2.4 Sensitivity and benchmark

All values equal the expected results: Equal weights ρ 0.992 and top-50 overlap 45 (top five EGFR, BTK, MTOR, MET, KIT); tractability-weighted ρ 0.971; clinical-weighted ρ 0.997; leave-one-out 0.920–0.995; random weights median ρ 0.955 [0.866–0.994], 86.6% ≥ 0.90, median top-50 overlap 42; lowest top-25 retention BCR 93.1%; median rank-interval width 34 (top 50) and 141.5 (all); ρ with the citation component 0.859 (0.874 core); citation-only top-20 overlap 13 and median rank shift 54.5; median PDIS by TDL 5.4 / 21.3 / 36.8 / 53.7; Kruskal–Wallis P 1.7 × 10⁻⁶⁵; ρ with ordinal TDL 0.665 and 0.562; AUROC 0.918/0.896 and 0.857/0.786/0.945; Tclin in the top 69: 44 (PDIS) and 36 (citations). PASS.

### 2.5 Worked examples

| Quantity | Expected | Observed | Result |
|---|---|---|---|
| Core ≤100 citations; with structure; ≥100 compounds | 257; 141; 93 | 257; 141; 93 | PASS |
| Example 1: no trial; TDL | 87; Tchem 87, Tbio 4, Tclin 2 | same | PASS |
| Tractability-only leaders (Explorer) | CSNK1D 84.4, CSNK2A2 83.0, BRD2 82.2, MAPK9 81.8 | same (browser check) | PASS |
| CSNK1D | 31; 46 PDB; 1.40 Å; 2,537; 1,808; 964; τ 0.41 | same (τ 0.414) | PASS |
| CSNK2A2; MAPK10; MAPK9; DAPK3 | as listed | same | PASS |
| Example 2 set | 47; 39 core; FLT3, FGFR2, CDC7, PRKCG, DCLK1 | same (browser check) | PASS |
| … with structure; ligands; ≥100 compounds; ClinVar; disease; no trial; median PDIS | 31; 41; 31; 14; 9; 43; 31.6 | same | PASS |
| CAMKK2 | τ 0.921; Brain Cerebellar Hemisphere 457.5 TPM; 24 PDB; 433 | same | PASS |
| MAP3K12; TTBK1 | τ 0.844, Brain Cerebellum 173.1, 12, 1,100; τ 0.894, 17, 87 | same | PASS |
| CAMK2B | τ 0.920; 216 ClinVar; intellectual developmental disorder, autosomal dominant 54 | same (UniProt disease name) | PASS |

## 3. Reconciliations

### 3.1 Ligand records (Task 1.5)

`/api/kinases/stats` reported `totalLigands: 1021668` because it counted every bioactivity record with a gene key. 247 PubChem AID 1433 records carry a key outside the catalog: 28 unreviewed TrEMBL accessions (for example Q59FK4, Q59F04, B3KWC4, A8K379) and three retired symbols (PCTK1, CDC2L2, TSSK1). The revised endpoint counts records mapped to a catalog gene: **1,021,421** (1,019,354 ChEMBL + 2,067 PubChem). The August 13 audit reported 2,085 PubChem records (18 more). Two of the non-catalog keys hold exactly 18 records each (A8K379, B3KWC4), so one of them most likely mapped to a catalog gene at audit time; the snapshot holds no record that shows which.

### 3.2 Structures (Task 8.6)

- **10,043 versus 10,034.** All 10,043 documents entered the database on 2026-08-12 between 19:12:55 and 19:12:58 UTC. Nine of them carry the RCSB release date 2026-08-12 (36IV, 9OM2, 9OXH, 9OYA, 9RN5, 9S6G, 9W7Y, 9W81, 9Y68): the weekly release about 19 hours before the import. 10,043 − 9 = 10,034, the value of the earlier audit and the August 11 manuscript draft. The 2026-08-14 backup holds the same 10,043 identifiers. Final value: **10,043**.
- **10,043 versus 10,184.** Every stored identifier still belongs to RCSB's ≤3.5 Å set. 141 RCSB entries are absent: 85 released after the import; 49 with resolution exactly 3.5 Å (the import used `< 3.5`); 7 without a Homo sapiens source organism (the import required one). Rerunning the import query today returns 10,125 = 10,043 + 82 later releases. Corrected Methods wording: “KinomeX scores RCSB PDB entries mapped to catalog accessions with a human source organism and a resolution below 3.5 Å (10,043 entries covering 476 catalog entries; 354 by cryo-EM).”
- **Covered genes:** 476 (384 core). **Cryo-EM among stored:** 354; all carry an EMDB accession.
- **Other experimental entries (not scored):** 620 (352 cryo-EM above 3.5 Å, 268 NMR) on 166 genes.
- **Gene-name matches:** 113 stored entries list an extra gene that the original import matched by gene name (for example PDK1 39, STK3 34, MAP2K1 10). The dossier lists entries by UniProt accession and states the difference; the PDIS structure inputs stay unchanged under ground rule 2 (Section 7).

### 3.3 Analysis re-run differences (8 of 1,704)

| Value | Expected | Observed | Cause |
|---|---|---|---|
| `max_abs_dev_stored_vs_formula` cd; tot | 0.0031; 0.0067 | 97.72; 16.29 | Diagnostic of the pre-update state: the stored compound component is now the revised one. Not a manuscript number. |
| Leave-one-out ρ (without structure; without compounds), all and core | 0.920403; 0.927819; 0.966419; 0.972918 | 0.920406; 0.927825; 0.966413; 0.972911 | Differences in the sixth decimal from floating-point order; identical at three decimals. |
| Non-GTEx expression records; genes | 322; 161 | 0; 0 | Intended effect of Task 6: the rows sit in quarantine and leave every view. |

## 4. Placeholder values

**Supplementary Methods S2, query templates** (`etl/ingestors/pdis_calculator.py`):
- PubMed E-utilities `esearch.fcgi`, `db=pubmed`, `rettype=count`, term: `{GENE}[Gene] AND kinase[Title/Abstract]`
- ClinicalTrials.gov API v2 `/api/v2/studies`, `query.term={GENE} kinase inhibitor`, `filter.overallStatus=RECRUITING|ACTIVE_NOT_RECRUITING|COMPLETED|ENROLLING_BY_INVITATION`, `countTotal=true`

**Supplementary Methods S1, representative rows under the new hierarchy** (`audit/ligand-representatives-2026-09-30.json`, ChEMBL 37 provenance):
- Tier 1 (uncensored Kd/Ki) 97,782; tier 2 (uncensored IC50/EC50) 376,715; tier 3 (other uncensored) 55,025; tier 4 (censored) 187,930.
- By activity type: IC50 421,197; Ki 145,790; Kd 82,995 (80,928 ChEMBL + 2,067 PubChem); potency 52,086; EC50 11,261; AC50 1,762; DC50 984; GI50 795; KM 250; 19 other types 332.
- By relation: = 475,125 (27,735 of them unqualified ChEMBL values read as “=”); > 186,914; < 51,426; ≤ 2,948; ≥ 1,008; ~ 23; ≫ 8.
- Cross-database redundancy: 3,172 rows (1,586 per source) share a standard InChIKey with the other source for the same kinase; 36 distinct InChIKeys occur in both sources.
- Binding mode from ChEMBL mechanism records: 680 rows (inhibitor 672, activator 5, negative allosteric modulator 2, positive allosteric modulator 1); 716,772 rows read “Not annotated.”
- Provenance: all 66,217 ChEMBL assays map to 9,864 documents; 411,025 records carry a PubMed ID and 422,718 a DOI.

**CSNK1D (Task 5.7):** under the new hierarchy, 1,808 representative rows are uncensored IC50, Ki, Kd, or EC50 values and 964 of them are ≤10 nM, the same as the manuscript. Four CSNK1D pairs change representative (IC50 to Kd or Ki); none crosses 10 nM.

**Assistant evaluation (Task 10):** not run. The harness (`scripts/evaluate_assistant.py`) and the fixed prompt set (`evaluation/prompts.jsonl`, 100 prompts, 20 per query type, written 2026-09-30T21:09:13Z) are ready. A run needs a signed-in session with a configured, named, versioned model endpoint; two human reviewers then score `evaluation/assistant_eval.csv`, and `evaluate_assistant.py score` computes N, X of Y, the proportions with 95% Wilson intervals, the error modes, and Cohen's κ.

**Zenodo DOI (Task 11.2):** not created (Section 7, item 2).

## 5. Changed τ values (Task 6.2)

No τ value changes. The stored τ of all 674 genes derives from the 54 GTEx v10 tissues only; none used the quarantined rows. The stored τ reproduces exactly with the Yanai formula on **linear median TPM**, not on log2(TPM + 1) as the instructions state (on log2 values 668 of 674 genes differ, for example CAMKK2). The manuscript's τ values (CAMKK2 0.921, CSNK1D 0.41, and the τ ≥ 0.8 CNS set of 47) all use linear TPM. Corrected Methods sentence: “KinomeX computes tissue specificity τ (Yanai et al., 2005) from GTEx v10 median TPM across 54 tissues.”

## 6. Screenshots (Task 9.3)

1600-pixel-wide PNG files in `docs/tutorial/` (also served at `/tutorial/…`):
- `protocol-s1.png` — Explorer with Protocol S1 settings (93 entries)
- `protocol-s2.png` — Explorer with Protocol S2 settings (47 entries, 39 core)
- `protocol-s3.png` — Explorer with Equal weights

## 7. Open issues

1. **Deployment** completed on 2026-10-01 (Section 1). The production container still builds from the live working tree at every start (item 8).
2. **GitHub and Zenodo.** The code is on GitHub (branch `jmb-revision`, pull request pending). The repository description (`gh repo edit dokhlab/kinomex …`), the `v1.1.0-jmb` release, and the Zenodo deposit (code, mongodump archive, audit JSON files, `expected_pdis` table) require a GitHub token with repository-administration rights and Zenodo access; the Data Availability DOI follows the deposit. The README's paper link follows publication.
3. **Literature-curated mutation citations are wrong.** 35 of the 37 distinct PMIDs resolve to unrelated articles (for example ABL1 T315I cites PMID 16959637, an avian-influenza study; EGFR C797S cites 25610870, an obesity review); 2 PMIDs (27492416, 28097279) do not exist; 22 rows carry no PMID. KinomeX lists the 87 mutations but withholds these links and shows the citation status instead; no drug appears because no cited article names one. The author supplies correct citations before the manuscript states “each with its PubMed link.”
4. **Gatekeeper flags.** KLIFS pocket residue 45 keeps the flag on 9 mutations (ABL1 T315I, EGFR T790M, ALK L1196M, FGFR2 V564F, KIT T670I, PDGFRA T674I, RET V804M, RET V804L, FGFR4 V550E) and removes it from 11 (EGFR C797S, ALK G1202R, ALK G1269A, MET D1246N, MET D1228H, FGFR2 N549K, FGFR3 V559M, ERBB2 L755S, ERBB2 T862A, KIT D816V, FGFR4 N535K). The FGFR3 gatekeeper is V555 in the canonical sequence. KLIFS annotates its “GCK” entry with a MAP4K2 pocket; KinomeX leaves GCK without a gatekeeper.
5. **ClinVar classifications** reflect the ClinVar release of 2026-09-29 (the August 12 snapshot stored no classification); the record set stays at 63,649 on 260 genes. UID 3769991 appears twice, under INSRR and NTRK1, as in ClinVar.
6. **Supplementary files.** The archive did not contain the manuscript, the Supplementary Information, or Supplementary Tables S1–S6. Protocols S1 and S2 follow the ledger's worked examples; Protocol S3 (weight sensitivity) needs a check against the Supplementary Information text.
7. **PDIS structure inputs** of genes with gene-name matches (for example PDK1, STK3) include structures of other proteins; ground rule 2 keeps these inputs, and the dossier states the difference.
8. **Deployment fragility.** `confs-kinomex-1` runs `npm run build` from the live working tree at every start. A host reboot during this update started a build of unfinished code; restoring the baseline stopped it. Building from a tagged release, or keeping development in the separate worktree, prevents a repeat.
9. `npm run lint` fails on the ESLint 9 configuration format (pre-existing; `tsc --noEmit` passes).

## Addendum, 2026-10-08: ligand reporting range and potency plot

- New ETL step `python -m etl.jmb_revision.ligands --step display --apply` writes a `display` measurement on every `ligand_representatives` row: the representative re-selected (same tier rules) from the records with 0 < value ≤ 10,000 nM, excluding lower bounds at 10,000 nM or above; `null` when no record is in range. The frozen representative fields, the audit counts above and the PDIS compound counts are unchanged.
- Run on a copy of the 2026-10-06 database: 717,452 pairs; 548,042 with an in-range measurement, 169,410 without (hidden in the dossier); 246 pairs whose representative was out of range but which have an in-range record now show that record (e.g. ABL1 / CHEMBL553695: IC50 72,000 nM → 5,000 nM).
- 518 representative rows read 0 nM (ChEMBL `standard_value` "0.0"; 454 of them PFKFB3). None of these compounds has a non-zero record for the same kinase, so they drop out.
- 24 in-range values are below 0.1 pM (e.g. CDK12 Kd 0.00005 nM), likely unit errors in the deposited records; they are kept, and the plot draws them at its 0.1 pM edge.
- The dossier Ligands tab adds a potency plot (shape = measure, colour = action), whose colours were checked for colour-vision deficiency against the card surface.
- Cross-source duplicates are merged in the dossier: the `display` step folds each PubChem row into the ChEMBL row with the same standard InChIKey for the same kinase (`merged_into` on the PubChem row, `merged_from` / `merged_pubchem_cids` on the ChEMBL row, `sources` on every row). The merged row's measurement is selected from the records of both sources, and the table lists the ChEMBL ID and the PubChem CID. The frozen representative rows and the cross-database redundancy count above are unchanged.
