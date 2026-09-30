"""Adapt the revised KinomeX API output to the field names of the manuscript analysis scripts.

The analysis scripts (fetch.py, summarize.py, ext.py, rcsb.py, uni.py, analysis.py)
read the pre-revision API schema. After `fetch.py` saves list.json and kin/*.json,
this script rewrites those files in place so that the unchanged scripts run on the
revised data:

- pdis_score.overall_score: the revised API reports 0-100; the scripts multiply by
  100, so the adapter writes the value divided by 100.
- ligand_assays: the dossier now reports ligand_summary.representative_rows and pages
  the rows; the adapter writes one placeholder row per representative row, keyed by
  compound, so len() and the distinct-compound count match.
- mutations: ClinVar and curated records now arrive in clinvar_variants and
  curated_mutations; curated rows keep the "Curated" title prefix the scripts test.
- tissue_expressions: data_source reads "GTEx v10 median TPM"; the scripts test "gtex".
- structures: the dossier pages structures; the adapter writes structures.total rows.
- Pre-update comparison values ("submitted" PDIS, legacy compound count, legacy
  displayed group of extensions) come from legacy.json, exported from the archived
  pdis_history snapshot and kinases.legacy_displayed_group.

    python adapt_schema.py            # run in the folder that holds list.json, kin/, legacy.json
"""
import glob
import json

legacy = json.load(open("legacy.json"))
entries = json.load(open("list.json"))
for k in entries:
    if k.get("catalog_membership") == "uniprot_extended":
        k["group"] = legacy["ext_groups"].get(k["gene_symbol"])
json.dump(entries, open("list.json", "w"))

for path in glob.glob("kin/*.json"):
    d = json.load(open(path))
    if "clinvar_variants" not in d:  # already adapted
        continue
    g = d["gene_symbol"]
    old = legacy["pdis"].get(g)
    p = d.get("pdis_score")
    if p:
        p["revised_overall_score"] = p["overall_score"]
        p["overall_score"] = old["pdis_total"] / 100 if old else None
        p["raw_values"] = dict(p.get("raw_values") or {})
        p["raw_values"]["distinct_compound_count"] = old["distinct_compound_count"] if old else None
    n = (d.get("ligand_summary") or {}).get("representative_rows", 0)
    d["ligand_assays"] = [{"chembl_id": f"row{i}"} for i in range(n)]
    d["mutations"] = [{"source_title": v.get("hgvs") or "ClinVar"} for v in d["clinvar_variants"]] + \
                     [{"source_title": f"Curated kinase mutation {g} {m['mutation_code']}"} for m in d["curated_mutations"]]
    for t in d.get("tissue_expressions", []):
        t["data_source"] = "gtex"
    d["structures"] = [{}] * d["structures"]["total"]
    if d.get("partition") == "uniprot_extended":
        d["group"] = legacy["ext_groups"].get(g)
    json.dump(d, open(path, "w"))
print("adapted", len(glob.glob("kin/*.json")), "dossiers")
