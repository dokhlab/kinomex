import InfoTip from "./InfoTip";
import type { KinaseDetail } from "./types";

export default function ExpressionTab({ kinase }: { kinase: KinaseDetail }) {
  const tissues = [...kinase.tissue_expressions].sort((a, b) => b.tpm_value - a.tpm_value);
  const maxTpm = Math.max(...tissues.map((t) => t.tpm_value), 1);
  const { source, gene_url, tau_specificity } = kinase.expression;

  if (tissues.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-slate-400">
        GTEx v10 expression is unavailable for this entry (no GTEx gene record in the snapshot).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Tissue expression: {source}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {tissues.length} GTEx tissues. Tissue specificity τ = {tau_specificity === null ? "unavailable" : tau_specificity.toFixed(3)}{" "}
              <InfoTip text="τ (Yanai et al., 2005) ranges from 0 (uniform expression) to 1 (expression in one tissue); KinomeX computes it from the GTEx v10 median TPM of the tissues listed here." />
            </p>
          </div>
          <a href={gene_url} target="_blank" rel="noopener noreferrer" className="text-xs text-kinome-cyan hover:underline">GTEx gene page ↗</a>
        </div>
        <div className="space-y-2">
          {tissues.map((t) => (
            <div key={t.tissue_name} className="flex items-center gap-3">
              <a href={t.gtex_url} target="_blank" rel="noopener noreferrer" className="w-48 flex-shrink-0 truncate text-right text-sm text-slate-300 hover:text-kinome-cyan" title={`${t.tissue_name} (${t.organ_system})`}>
                {t.tissue_name}
              </a>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, rgba(56,189,248,0.6), rgba(168,85,247,0.6))", width: `${(t.tpm_value / maxTpm) * 100}%` }} />
              </div>
              <span className="w-24 text-right text-xs tabular-nums text-slate-400">{t.tpm_value.toFixed(1)} TPM</span>
              <span className="hidden w-28 truncate text-xs text-slate-500 md:block">{t.organ_system}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Source: <a href="https://gtexportal.org/" target="_blank" rel="noopener noreferrer" className="text-kinome-cyan hover:underline">GTEx Portal</a>, release v10, median gene-level TPM per tissue. Each tissue links to the GTEx gene page.
        </p>
      </div>
    </div>
  );
}
