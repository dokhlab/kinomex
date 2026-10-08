"use client";

import Link from "next/link";
import { PDIS_NOTE, WEIGHT_PRESETS, WEIGHTS_NOTE } from "@/lib/pdis";
import { explorerHref } from "@/lib/catalog/url";
import { Card, MathBlock, Section } from "./ui";
import { fmt, useAccounting } from "./useAccounting";

const icon = (d: string) => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} /></svg>
);

export const PUBMED_TERM = "{GENE}[Gene] AND kinase[Title/Abstract]";
export const TRIALS_QUERY = "query.term={GENE} kinase inhibitor";
export const TRIALS_STATUS = "filter.overallStatus=RECRUITING|ACTIVE_NOT_RECRUITING|COMPLETED|ENROLLING_BY_INVITATION";

function CoverageTable() {
  const acc = useAccounting();
  if (acc.status !== "ready") {
    return <p className="text-sm text-slate-400">{acc.status === "loading" ? "The coverage table loads from the catalog accounting endpoint…" : "Catalog accounting is unavailable; the page shows no estimated values."}</p>;
  }
  const a = acc.data;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Records</th><th className="px-3 py-2 text-right">Entries with ≥1 record</th><th className="px-3 py-2 text-right">Gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-slate-300">
          {a.sources.map((s) => (
            <tr key={s.source}>
              <td className="px-3 py-2">{s.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.records === null ? "–" : fmt(s.records)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(s.entries_with_records)}{s.core_entries_with_records != null ? <span className="text-slate-500"> ({fmt(s.core_entries_with_records)} core)</span> : null}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(s.gap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Counts cover the {fmt(a.total_entries)} catalog entries (snapshot {a.snapshot_date ?? "unavailable"}). A gap means KinomeX holds no record for the entry in that source snapshot; it is not evidence that no such record exists.
        {a.quarantine.filter((q) => q.records).map((q) => ` The ${q.collection} collection holds ${fmt(q.records)} excluded rows on ${fmt(q.genes)} genes (${q.reason}).`).join("")}
      </p>
    </div>
  );
}

export default function TechnicalTab() {
  return (
    <div className="space-y-12">
      <Section title="Catalog definition" icon={icon("M4 6h16M4 12h16M4 18h7")}>
        <Card>
          <p className="text-sm leading-relaxed text-slate-300">
            The <strong className="text-white">KinHub core</strong> holds the entries of the KinHub/Manning roster, each reconciled to one reviewed UniProt accession;
            a core entry displays its KinHub group. The <strong className="text-white">UniProt extensions</strong> are reviewed human UniProt entries that carry
            the Kinase keyword (KW-0418) but have no KinHub row. An extension displays one of seven extension classes (for example lipid kinase or
            nucleotide, nucleoside or nucleic-acid kinase) instead of a Manning group, and its dossier states the classification basis.
            The Explorer and the API report both fields: <code className="text-kinome-cyan">group</code> (the KinHub group, or null for an extension) and <code className="text-kinome-cyan">display_category</code>.
          </p>
        </Card>
      </Section>

      <Section title="PDIS — Pharmaceutical Development Interest Score" icon={icon("M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z")}>
        <Card title="Components (formula 3.0-weighted-mean, 0–100 scale)">
          <MathBlock>{"C_cit    = 100 · ln(1 + n) / ln(1 + n_max)        n = PubMed count, n_max = the catalog maximum\nC_trial  = min(100, t)                             t = counted ClinicalTrials.gov studies\nC_struct = 0.6 · s(best) + 0.4 · s(mean)            s(r) = min(100, max(0, 100 · (4.0 − r) / 2.5)); 0 without a structure\nC_cmpd   = 100 · ln(1 + c) / ln(1 + c_max)        c = distinct source compound identifiers (ChEMBL ID or PubChem CID)"}</MathBlock>
          <MathBlock>{"PDIS = Σ wᵢ·Cᵢ / Σ wᵢ        default w = (0.30, 0.30, 0.15, 0.15) for (citation, trials, structure, compounds)"}</MathBlock>
          <p className="text-sm leading-relaxed text-slate-300">
            KinomeX stores each component and the default-weight total with two decimals and computes the total from the rounded components.
            Ties share the integer part of their average rank.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            PubMed E-utilities term: <code className="text-kinome-cyan">{PUBMED_TERM}</code>. ClinicalTrials.gov API v2: <code className="text-kinome-cyan">{TRIALS_QUERY}</code> with <code className="text-kinome-cyan">{TRIALS_STATUS}</code>.
            The citation, trial, and structure inputs date from August 12, 2026.
          </p>
        </Card>
        <Card title="Adjustable weights">
          <p className="text-sm leading-relaxed text-slate-300">{WEIGHTS_NOTE} The Explorer recomputes every score in the browser, re-ranks the catalog, redraws the histogram, and applies the PDIS interval to the recomputed scores. The page address stores non-default weights as <code className="text-kinome-cyan">?w=a,b,c,d</code>, and <code className="text-kinome-cyan">GET /api/kinases?weights=a,b,c,d</code> returns <code>pdis_weighted</code> and <code>rank_weighted</code>.</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            {WEIGHT_PRESETS.map((p) => (
              <li key={p.id}><Link href={explorerHref({ weights: p.weights })} className="inline-block rounded-full border border-white/10 px-3 py-1 text-slate-300 hover:border-kinome-cyan/50">{p.label}</Link></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-amber-200/90">{PDIS_NOTE}</p>
        </Card>
      </Section>

      <Section title="Ligand records" icon={icon("M9 3h6m-5 0v6l-5 8a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-8V3")}>
        <Card>
          <ul className="space-y-2 text-sm leading-relaxed text-slate-300">
            <li><strong className="text-white">Representative row.</strong> For each compound–kinase pair, KinomeX selects an uncensored (=, &lt;, ≤, ~) Kd or Ki first, then an uncensored IC50 or EC50, then any other uncensored activity type, and a censored bound (&gt;, ≥, ≫) only when nothing else exists; within a tier the lowest value wins. A ChEMBL record without a relation qualifier counts as “=”.</li>
            <li><strong className="text-white">Reporting range.</strong> The dossier lists a compound only with a measurement above 0 nM and at most 10,000 nM: a value of 0 nM is not a measurement, and a value above 10,000 nM (or a lower bound at 10,000 nM or above) reports no activity at 10 µM. When the representative row falls outside that range, the dossier shows the best measurement inside it under the same hierarchy; the representative rows and the PDIS compound counts are unchanged.</li>
            <li><strong className="text-white">Cross-source duplicates.</strong> A PubChem compound with the same standard InChIKey as a ChEMBL compound for the same kinase is one ligand: the dossier lists it once, with its ChEMBL ID and PubChem CID, and picks its measurement from the records of both sources.</li>
            <li><strong className="text-white">Potency plot.</strong> One mark per compound at −log₁₀ of its molar value. Shape gives the measure (IC50 circle, Ki diamond, Kd square, EC50 triangle, other measures inverted triangle); colour gives the action: the ChEMBL mechanism record when one exists, otherwise inhibition for IC50 and Ki, binding for Kd, and unspecified for EC50, potency and other measures. Bounds (&lt;, &gt;) are listed in the table but not plotted.</li>
            <li><strong className="text-white">Censored values</strong> read as bounds (“&gt; 10,000 nM”) and never serve as point values; the Ligands tab offers an “Uncensored only” filter.</li>
            <li><strong className="text-white">Binding mode</strong> appears only when a ChEMBL mechanism record supplies it; every other row reads “Not annotated.”</li>
            <li><strong className="text-white">Provenance.</strong> ChEMBL rows carry the ChEMBL document ID, PubMed ID, and DOI where ChEMBL provides them; each row expands to every underlying record with its source link.</li>
            <li><strong className="text-white">Cross-database redundancy.</strong> KinomeX compares standard InChIKeys; a row whose InChIKey occurs in both ChEMBL and PubChem for the same kinase shows an “Also in PubChem/ChEMBL” badge. Counts use source compound identifiers.</li>
          </ul>
        </Card>
      </Section>

      <Section title="Structures, expression, and variants" icon={icon("M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Structures">
            <p className="text-sm leading-relaxed text-slate-300">The Structure tab lists every scored RCSB PDB entry mapped to the entry’s UniProt accession (≤3.5 Å) with method, resolution, bound ligands (solvents, ions, and common additives excluded), and, for cryo-EM entries, the EMDB accession. Cryo-EM entries above 3.5 Å and NMR entries appear in a collapsed section and enter neither the PDIS structure component nor the structure count. A separate panel shows the AlphaFold DB model (AF-accession-F1) colored by pLDDT and labels it as a predicted model.</p>
          </Card>
          <Card title="Expression">
            <p className="text-sm leading-relaxed text-slate-300">The Distribution tab shows GTEx v10 median TPM for 54 tissues and links each tissue to the GTEx gene page. Tissue specificity τ (Yanai et al., 2005) uses the GTEx v10 tissue medians only. Rows without a GTEx identifier or source record sit in a quarantine collection and enter no view or count.</p>
          </Card>
          <Card title="Variants">
            <p className="text-sm leading-relaxed text-slate-300">ClinVar missense records show the VCV accession, germline classification, review status (stars), conditions, and a ClinVar link; classifications reflect the ClinVar release of September 29, 2026. Literature-curated resistance and activating mutations form a separate section. The gatekeeper flag marks only mutations at KLIFS pocket residue 45, mapped to the UniProt canonical sequence, and a drug appears only when the cited publication names it.</p>
          </Card>
          <Card title="Interaction network">
            <p className="text-sm leading-relaxed text-slate-300">The Network tab queries STRING for human proteins (species 9606) with a chosen confidence and association type. STRING associations combine functional evidence and do not necessarily establish direct physical binding.</p>
          </Card>
        </div>
      </Section>

      <Section title="Coverage by source" icon={icon("M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z")}>
        <Card><CoverageTable /></Card>
      </Section>
    </div>
  );
}
