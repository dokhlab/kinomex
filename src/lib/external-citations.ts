export interface ExternalCitation {
  pmid: string;
  doi: string;
}

const PMID_RE = /\bPMID\s*[:#]?\s*(\d{5,9})\b/gi;
const DOI_RE = /\bDOI\s*[:#]?\s*(10\.\d{4,9}\/[-._;()/:a-z0-9]+)(?=[\s\],}]|$)/gi;

export function extractExternalCitations(text: string): ExternalCitation[] {
  const pmids = Array.from(text.matchAll(PMID_RE), (match) => match[1]);
  const dois = Array.from(text.matchAll(DOI_RE), (match) => match[1].replace(/[.,;]+$/, ""));
  if (!pmids.length || pmids.length !== dois.length) return [];
  return pmids.map((pmid, index) => ({ pmid, doi: dois[index] }));
}

export async function verifyExternalCitations(
  citations: ExternalCitation[],
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!citations.length) return false;
  return (await Promise.all(citations.map(async ({ pmid, doi }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const params = new URLSearchParams({ db: "pubmed", id: pmid, retmode: "json" });
      if (process.env.PUBMED_API_KEY) params.set("api_key", process.env.PUBMED_API_KEY);
      const response = await fetcher(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`,
        { signal: controller.signal },
      );
      if (!response.ok) return false;
      const body = await response.json();
      const articleIds = body?.result?.[pmid]?.articleids;
      if (!Array.isArray(articleIds)) return false;
      const verifiedDoi = articleIds.find((id: { idtype?: string }) => id.idtype === "doi")?.value;
      return typeof verifiedDoi === "string" && verifiedDoi.toLowerCase() === doi.toLowerCase();
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }))).every(Boolean);
}

export function externalClaimsAreCited(text: string, allowed: ExternalCitation[]): boolean {
  const allowedPairs = new Set(allowed.map(({ pmid, doi }) => `${pmid}|${doi.toLowerCase()}`));
  const used = extractExternalCitations(text);
  if (!used.length || used.some(({ pmid, doi }) => !allowedPairs.has(`${pmid}|${doi.toLowerCase()}`))) return false;
  return text.split("\n").every((raw) => {
    const line = raw.replace(/^[-*#>\s]+/, "").trim();
    if (!line || /^sources:?$/i.test(line) || /^PMID\s*:/i.test(line)) return true;
    if (/^\|.*\|$/.test(line) && (/^\|?\s*:?-+/.test(line) || /kinase|reference|evidence/i.test(line))) return true;
    if (line.length < 20) return true;
    return /\bPMID\s*[:#]?\s*\d{5,9}\b/i.test(line) && /\bDOI\s*[:#]?\s*10\./i.test(line);
  });
}
