import { cn } from "@/lib/utils";

type KinaseGroup =
  | "AGC"
  | "CAMK"
  | "CK1"
  | "CMGC"
  | "STE"
  | "TK"
  | "TKL"
  | "Atypical"
  | "RGC"
  | "Other";

interface GroupBadgeProps {
  // A KinHub group for core entries or an extension class for UniProt extensions.
  group: string;
  className?: string;
  // Lets a long extension label break across lines (after "/" or a space) in tables.
  wrap?: boolean;
}

const groupStyles: Record<KinaseGroup, string> = {
  AGC: "bg-kinome-cyan/15 text-kinome-cyan border border-kinome-cyan/20",
  CAMK: "bg-kinome-violet/15 text-kinome-violet border border-kinome-violet/20",
  CK1: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  CMGC: "bg-kinome-emerald/15 text-kinome-emerald border border-kinome-emerald/20",
  STE: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  TK: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  TKL: "bg-orange-500/15 text-orange-400 border border-orange-500/20",
  Atypical: "bg-slate-500/15 text-slate-400 border border-slate-500/20",
  RGC: "bg-teal-500/15 text-teal-400 border border-teal-500/20",
  Other: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
};

export const EXTENSION_SHORT_LABELS: Record<string, string> = {
  "Protein kinase outside KinHub roster": "Protein kinase (non-KinHub)",
  "Lipid kinase": "Lipid kinase",
  "Inositol phosphate kinase": "Inositol phosphate kinase",
  "Nucleotide, nucleoside or nucleic-acid kinase": "Nucleotide/nucleic-acid kinase",
  "Carbohydrate or central-metabolism kinase": "Carbohydrate/metabolism kinase",
  "Cofactor, amino-acid or other small-molecule kinase": "Cofactor/small-molecule kinase",
  "Keyword-annotated entry without established kinase catalytic role": "No established kinase role",
};

const extensionStyle = "bg-orange-400/10 text-orange-300 border border-dashed border-orange-300/40";

export default function GroupBadge({ group, className, wrap = false }: GroupBadgeProps) {
  const isGroup = group in groupStyles;
  return (
    <span
      title={isGroup ? `KinHub group ${group}` : `UniProt extension class: ${group}`}
      className={cn(
        wrap
          ? "inline-block max-w-[8rem] whitespace-normal rounded-2xl px-2.5 py-0.5 text-center text-xs font-medium leading-tight tracking-wide"
          : "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide whitespace-nowrap",
        isGroup ? groupStyles[group as KinaseGroup] : extensionStyle,
        className
      )}
    >
      {isGroup ? group : wrap ? (EXTENSION_SHORT_LABELS[group] ?? group).replace("/", "/\u200B") : EXTENSION_SHORT_LABELS[group] ?? group}
    </span>
  );
}

export type { KinaseGroup };
