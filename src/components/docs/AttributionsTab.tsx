import { Card } from "./ui";

const attributionSources = [
  {
    name: "UniProtKB/Swiss-Prot",
    use: "Reviewed protein identity, sequence, domains, function, catalytic activity, subunit and disease annotations.",
    rights: "Copyrightable database content is CC BY 4.0. KinomeX identifies UniProt as the source, links each entry, and labels normalized or combined fields as KinomeX processing.",
    href: "https://www.uniprot.org/help/license",
    license: "CC BY 4.0",
  },
  {
    name: "STRING",
    use: "Human functional and physical protein associations and evidence-channel confidence scores.",
    rights: "STRING data and downloads are CC BY 4.0. KinomeX uses the documented API for limited queries, credits STRING, links associations, and does not scrape STRING pages. Scores are described as associations, not proof of direct binding.",
    href: "https://string-db.org/cgi/access?footer_active_subpage=licensing",
    license: "CC BY 4.0",
  },
  {
    name: "RCSB Protein Data Bank / wwPDB",
    use: "PDB identifiers, experimental structures, methods, resolution and bound-ligand metadata.",
    rights: "PDB archive and programmatic API data are CC0 1.0. KinomeX nevertheless credits RCSB PDB and preserves PDB identifiers and links; original structure authors should be cited when a structure is used in research.",
    href: "https://www.rcsb.org/pages/usage-policy",
    license: "CC0 1.0",
  },
  {
    name: "AlphaFold Protein Structure Database",
    use: "One predicted model per UniProt accession (AF-<accession>-F1, latest version) with its global pLDDT, shown in a separate panel labeled as a predicted model; it never enters the structure count or PDIS.",
    rights: "Predictions are available under CC BY 4.0 for academic and commercial use. KinomeX labels them as predictions, links the source entry, and does not present them as experimentally validated or clinically approved.",
    href: "https://alphafold.ebi.ac.uk/faq",
    license: "CC BY 4.0",
  },
  {
    name: "ChEMBL",
    use: "Kinase targets, compounds, assays, standardized activity values and document identifiers.",
    rights: "ChEMBL data are CC BY-SA 3.0. ChEMBL-derived records and adaptations exposed by KinomeX remain under CC BY-SA 3.0; attribution and the same license must accompany any redistribution or derivative export.",
    href: "https://www.ebi.ac.uk/chembl/",
    license: "CC BY-SA 3.0",
  },
  {
    name: "PubChem",
    use: "PubChem identifiers, compound properties and the deposited Ambit kinase-profiling assay (AID 1433).",
    rights: "PubChem is an open NLM archive, but contributor-specific rights can apply. KinomeX retains PubChem identifiers and provenance, does not bulk republish PubChem, and requires users of exported records to inspect the source record's current contributor license.",
    href: "https://pubchem.ncbi.nlm.nih.gov/docs/downloads",
    license: "Record-specific",
  },
  {
    name: "GTEx Portal",
    use: "Public aggregate median tissue-expression values from the documented GTEx release.",
    rights: "KinomeX uses only public aggregate Portal data, not controlled individual-level dbGaP data. Publications and presentations must acknowledge GTEx, identify the Portal/release, and include the access date requested by GTEx.",
    href: "https://gtexportal.org/home/documentationPage",
    license: "Public aggregate data; citation required",
  },
  {
    name: "NCBI ClinVar",
    use: "Submitted variant identifiers and clinical-significance assertions.",
    rights: "NCBI requests attribution when ClinVar data are copied or distributed. KinomeX links source records and states that submissions are not independently verified and are not for direct diagnosis or medical decisions without genetics-professional review.",
    href: "https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/",
    license: "NCBI data-use policy",
  },
  {
    name: "PubMed / NCBI E-utilities",
    use: "Citation metadata, PMID/DOI verification, publication counts and transient abstracts used to ground answers.",
    rights: "Citation metadata may be reused with NLM acknowledgment, but abstracts may be copyrighted by authors or publishers. KinomeX does not store or republish article full text, instructs the AI to paraphrase retrieved evidence, and links users to PubMed and the DOI.",
    href: "https://www.ncbi.nlm.nih.gov/home/about/policies/",
    license: "Metadata/public-domain portions; abstracts record-specific",
  },
  {
    name: "ClinicalTrials.gov",
    use: "Aggregate active/completed study counts used as one PDIS component.",
    rights: "KinomeX attributes ClinicalTrials.gov, uses study records without altering their meaning, does not imply NIH/NLM endorsement, and does not redistribute uploaded study documents, which may carry third-party copyright.",
    href: "https://clinicaltrials.gov/about-site/terms-conditions",
    license: "U.S. public-domain data; additional international/third-party rights may apply",
  },
  {
    name: "KinHub and Manning classification",
    use: "Core human-kinome roster reconciliation and factual kinase group/domain classification.",
    rights: "KinomeX cites the Manning et al. classification and KinHub/KinMap, copies no KinHub artwork or explanatory prose, and does not offer the KinHub source roster as a standalone download. Because no explicit current KinHub data license is published, broader or commercial redistribution should obtain permission from the source maintainers.",
    href: "http://www.kinhub.org/",
    license: "No explicit source-data license located",
  },
  {
    name: "OMIM",
    use: "Outbound identifiers and links supplied through UniProt disease cross-references.",
    rights: "OMIM content is copyrighted. KinomeX does not ingest or reproduce OMIM narrative text; it displays identifiers and links only. Any direct OMIM content use requires compliance with OMIM's terms.",
    href: "https://omim.org/help/copyright",
    license: "Copyrighted; links/identifiers only",
  },
  {
    name: "EMDB (Electron Microscopy Data Bank)",
    use: "Map accessions for cryo-EM entries, taken from the related EMDB identifiers of each PDB entry; KinomeX links each accession to its EMDB page.",
    rights: "EMDB data are freely available under CC0; KinomeX displays accessions and links only.",
    href: "https://www.ebi.ac.uk/emdb/documentation/policies",
    license: "CC0 1.0; links only",
  },
  {
    name: "Pharos / Target Central Resource Database",
    use: "Target development level (Tclin, Tchem, Tbio, Tdark) per UniProt accession, retrieved from the Pharos GraphQL API on September 30, 2026.",
    rights: "Pharos data are public; KinomeX shows the TDL label with a link to the Pharos target page. Cite Pharos/TCRD when reusing the labels.",
    href: "https://pharos.nih.gov/about",
    license: "Public; cite TCRD",
  },
  {
    name: "KLIFS",
    use: "Kinase pocket alignment used to locate the gatekeeper residue (KLIFS pocket residue 45) for the gatekeeper flag on curated mutations.",
    rights: "KinomeX stores the derived residue position with a link to KLIFS; cite KLIFS when reusing the mapping.",
    href: "https://klifs.net/faq.php",
    license: "Academic use; cite KLIFS",
  },
];

export default function AttributionsTab() {
  return (
    <div className="space-y-10">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-kinome-cyan">Data provenance</p>
        <h1 className="mt-2 text-4xl font-bold text-white">Attributions &amp; reuse rights</h1>
        <p className="mt-4 text-base leading-relaxed text-slate-400">
          KinomeX is an integration and visualization layer, not the owner of upstream scientific data. Rights remain with the named providers and contributors. The notices below describe the project&apos;s current, deliberately conservative use of each source; source terms control if they change.
        </p>
        <p className="mt-2 text-xs text-slate-500">Terms reviewed against official provider pages on August 11, 2026; EMDB, Pharos, and KLIFS entries added on September 30, 2026. This inventory is operational guidance, not legal advice.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {attributionSources.map((source) => (
          <article key={source.name} className="glass rounded-2xl border border-white/10 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">{source.name}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{source.use}</p>
              </div>
              <span className="rounded-full border border-kinome-cyan/20 bg-kinome-cyan/[0.07] px-3 py-1 text-[11px] font-medium text-kinome-cyan">{source.license}</span>
            </div>
            <p className="mt-3 border-t border-white/[0.06] pt-3 text-sm leading-relaxed text-slate-300">{source.rights}</p>
            <a href={source.href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-kinome-cyan hover:underline">
              Official terms or source policy <span aria-hidden="true">↗</span>
            </a>
          </article>
        ))}
      </div>

      <Card title="Compliance boundaries">
        <ul className="space-y-2 text-sm leading-relaxed text-slate-300">
          <li>• Source names identify provenance and do not imply endorsement, partnership, or ownership.</li>
          <li>• Third-party logos, screenshots, and prose are not incorporated; KinomeX uses its own interface and graphics.</li>
          <li>• ChEMBL-derived records retain CC BY-SA 3.0 attribution and ShareAlike obligations.</li>
          <li>• PubMed abstracts and linked articles are not redistributed as a corpus; answers use short paraphrases with verified PMID and DOI links.</li>
          <li>• ClinVar and AlphaFold information is research-oriented and must not be treated as clinical advice or validated diagnosis.</li>
          <li>• API clients must preserve record-level source identifiers and these notices when redistributing data.</li>
        </ul>
      </Card>
    </div>
  );
}
