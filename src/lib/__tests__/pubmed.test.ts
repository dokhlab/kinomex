import { buildPubMedQuery, findMentionedKinases, parsePubMedXml } from "@/lib/pubmed";

describe("PubMed evidence parsing", () => {
  it("expands GPCR phosphorylation into a broad literature query", () => {
    const query = buildPubMedQuery("Which kinases phosphorylate GPCRs?");
    expect(query).toContain("G protein-coupled receptor");
    expect(query).toContain("kinase");
  });

  it("keeps only articles with PMID, DOI, title, and abstract", () => {
    const xml = `<PubmedArticleSet>
      <PubmedArticle><MedlineCitation><PMID>12345678</PMID><Article>
        <Journal><Title>Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>Kinase evidence</ArticleTitle><Abstract><AbstractText>Verified abstract.</AbstractText></Abstract>
      </Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/example</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
      <PubmedArticle><MedlineCitation><PMID>87654321</PMID><Article><ArticleTitle>No DOI</ArticleTitle><Abstract><AbstractText>Excluded.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>
    </PubmedArticleSet>`;
    expect(parsePubMedXml(xml)).toEqual([{
      pmid: "12345678", doi: "10.1000/example", title: "Kinase evidence",
      abstract: "Verified abstract.", journal: "Journal", year: "2024",
    }]);
  });

  it("maps gene symbols in PubMed evidence to KinomeX profiles", async () => {
    const cursor = { toArray: jest.fn(async () => [
      { gene_symbol: "GRK2", full_name: "G protein-coupled receptor kinase 2" },
      { gene_symbol: "EGFR", full_name: "Epidermal growth factor receptor" },
    ]) };
    const db = { collection: jest.fn(() => ({ find: jest.fn(() => cursor) })) };
    const article = {
      pmid: "12345678", doi: "10.1000/example", title: "GRK2 assembly on GPCRs",
      abstract: "The structure contains GRK2.", journal: "Journal", year: "2024",
    };
    await expect(findMentionedKinases(db as any, [article])).resolves.toEqual([{
      gene_symbol: "GRK2",
      full_name: "G protein-coupled receptor kinase 2",
      evidence: [article],
    }]);
  });
});
