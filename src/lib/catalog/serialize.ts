import type { ScoredRow } from "@/lib/catalog/query";

export function serializeEntry(row: ScoredRow) {
  return {
    gene_symbol: row.gene_symbol,
    name: row.name,
    uniprot_id: row.uniprot_id,
    uniprot_record_status: row.uniprot_record_status,
    partition: row.partition,
    catalog_membership: row.partition,
    group: row.group,
    extension_class: row.extension_class,
    display_category: row.display_category,
    subfamily: row.subfamily,
    kinase_domain_count: row.kinase_domain_count,
    organism: "Human",
    components: row.components,
    raw_values: row.raw_values,
    pdis_default: row.pdis_default,
    rank_default: row.rank_default,
    pdis_weighted: row.pdis_weighted,
    rank_weighted: row.rank_weighted,
    pdis_score: row.pdis_default,
    pharos_tdl: row.pharos_tdl,
    expression: row.expression,
    organ_systems_impacted: row.organ_systems,
    diseases_associated: row.diseases,
    mutation_count: row.clinvar_records + row.curated_mutations,
    clinvar_records: row.clinvar_records,
    curated_mutations: row.curated_mutations,
  };
}
