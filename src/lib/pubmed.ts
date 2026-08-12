export interface PubMedEvidence {
  pmid: string;
  doi: string;
  title: string;
  abstract: string;
  journal: string;
  year: string;
}

export interface MentionedKinase {
  gene_symbol: string;
  full_name: string;
  evidence: PubMedEvidence[];
}

export function buildPubMedQuery(query: string): string {
  if (/\bGPCRs?\b/i.test(query) && /phosphorylat/i.test(query)) {
    return '("G protein-coupled receptor"[Title/Abstract] OR GPCR[Title/Abstract]) AND (kinase[Title/Abstract] OR phosphorylation[Title/Abstract])';
  }
  return query;
}

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string {
  return decodeXml(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

export function parsePubMedXml(xml: string): PubMedEvidence[] {
  const articles = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi) || [];
  return articles.flatMap((article) => {
    const pmid = tag(article, "PMID");
    const doiMatch = article.match(/<ArticleId[^>]*IdType=["']doi["'][^>]*>([\s\S]*?)<\/ArticleId>/i);
    const doi = decodeXml(doiMatch?.[1] || "");
    const title = tag(article, "ArticleTitle");
    const abstractParts = Array.from(article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi), (match) => decodeXml(match[1]));
    const abstract = abstractParts.join(" ");
    const journal = tag(article, "Title") || tag(article, "ISOAbbreviation");
    const year = tag(article, "Year") || tag(article, "MedlineDate").slice(0, 4);
    return pmid && doi && title && abstract ? [{ pmid, doi, title, abstract, journal, year }] : [];
  });
}

export async function searchPubMedEvidence(
  query: string,
  limit = 8,
  fetcher: typeof fetch = fetch,
): Promise<PubMedEvidence[]> {
  const common = { db: "pubmed", retmode: "json" };
  const searchParams = new URLSearchParams({ ...common, term: buildPubMedQuery(query), retmax: String(limit), sort: "relevance" });
  if (process.env.PUBMED_API_KEY) searchParams.set("api_key", process.env.PUBMED_API_KEY);
  const search = await fetcher(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!search.ok) return [];
  const ids = (await search.json())?.esearchresult?.idlist;
  if (!Array.isArray(ids) || !ids.length) return [];

  const fetchParams = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "xml" });
  if (process.env.PUBMED_API_KEY) fetchParams.set("api_key", process.env.PUBMED_API_KEY);
  const records = await fetcher(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${fetchParams}`, {
    signal: AbortSignal.timeout(12_000),
  });
  return records.ok ? parsePubMedXml(await records.text()) : [];
}

export async function findMentionedKinases(
  db: import("mongodb").Db,
  evidence: PubMedEvidence[],
): Promise<MentionedKinase[]> {
  if (!evidence.length) return [];
  const kinases = await db.collection("kinases")
    .find({}, { projection: { gene_symbol: 1, full_name: 1 } })
    .toArray();
  return kinases.flatMap((kinase) => {
    const gene = String(kinase.gene_symbol || "").trim();
    if (!gene) return [];
    const escapedGene = gene.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fullName = String(kinase.full_name || "").trim();
    const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const symbolPattern = new RegExp(`(^|[^A-Za-z0-9])${escapedGene}([^A-Za-z0-9]|$)`, "i");
    const namePattern = escapedName ? new RegExp(`(^|[^A-Za-z0-9])${escapedName}([^A-Za-z0-9]|$)`, "i") : null;
    const matches = evidence.filter((article) => {
      const text = `${article.title} ${article.abstract}`;
      return symbolPattern.test(text) || Boolean(namePattern?.test(text));
    });
    return matches.length ? [{
      gene_symbol: gene,
      full_name: String(kinase.full_name || gene),
      evidence: matches,
    }] : [];
  }).sort((a, b) => b.evidence.length - a.evidence.length || a.gene_symbol.localeCompare(b.gene_symbol));
}
