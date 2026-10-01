// Returns the upper-case gene symbol or null when the route segment is invalid.
export function normalizeGene(raw: string | undefined): string | null {
  if (!raw) return null;
  let gene: string;
  try {
    gene = decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    return null;
  }
  return /^[A-Z0-9][A-Z0-9_.-]{0,39}$/.test(gene) ? gene : null;
}
