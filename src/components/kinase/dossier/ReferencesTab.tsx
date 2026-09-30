import type { KinaseDetail } from "./types";

type KeyReference = KinaseDetail["key_references"][number];

export default function ReferencesTab({ references }: { references: KeyReference[] }) {
  const relevanceColors: Record<string, string> = {
    review: "bg-kinome-cyan/15 text-kinome-cyan border border-kinome-cyan/20",
    structural: "bg-kinome-violet/15 text-kinome-violet border border-kinome-violet/20",
    functional: "bg-kinome-emerald/15 text-kinome-emerald border border-kinome-emerald/20",
    clinical: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
    "drug discovery": "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    "pathway analysis": "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  };

  function getTagColor(tag: string): string {
    const lower = tag.toLowerCase();
    for (const [key, val] of Object.entries(relevanceColors)) {
      if (lower.includes(key)) return val;
    }
    return "bg-slate-500/15 text-slate-400 border border-slate-500/20";
  }

  return (
    <div className="space-y-3">
      {references.length === 0 ? (
        <div className="glass-card p-8 text-center text-slate-500 text-sm">
          No references available.
        </div>
      ) : (
        references.map((ref, idx) => (
          <div
            key={ref.pubmed_id ?? idx}
            className="glass-card p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 leading-relaxed mb-2">
                  {ref.citation_text}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getTagColor(ref.relevance_tag)}`}>
                    {ref.relevance_tag}
                  </span>
                  {ref.pubmed_id && (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${ref.pubmed_id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-kinome-cyan hover:text-kinome-cyan/80 transition-colors"
                    >
                      PubMed
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                  {ref.doi && (
                    <a
                      href={`https://doi.org/${ref.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-kinome-violet hover:text-kinome-violet/80 transition-colors"
                    >
                      DOI
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
