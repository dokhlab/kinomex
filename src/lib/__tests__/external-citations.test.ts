import { externalClaimsAreCited, extractExternalCitations, verifyExternalCitations } from "@/lib/external-citations";

describe("external citation enforcement", () => {
  it("requires paired PMID and DOI identifiers", () => {
    expect(extractExternalCitations("PMID: 12345678; DOI: 10.1000/example")).toEqual([
      { pmid: "12345678", doi: "10.1000/example" },
    ]);
    expect(extractExternalCitations("PMID: 12345678")).toEqual([]);
    expect(extractExternalCitations("DOI: 10.1000/example")).toEqual([]);
  });

  it("accepts only a DOI registered on the cited PubMed record", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          "12345678": { articleids: [{ idtype: "doi", value: "10.1000/example" }] },
        },
      }),
    }));
    await expect(verifyExternalCitations(
      [{ pmid: "12345678", doi: "10.1000/example" }],
      fetcher as any,
    )).resolves.toBe(true);
    await expect(verifyExternalCitations(
      [{ pmid: "12345678", doi: "10.1000/different" }],
      fetcher as any,
    )).resolves.toBe(false);
  });

  it("fails closed when PubMed cannot verify a citation", async () => {
    const fetcher = jest.fn(async () => ({ ok: false }));
    await expect(verifyExternalCitations(
      [{ pmid: "12345678", doi: "10.1000/example" }],
      fetcher as any,
    )).resolves.toBe(false);
  });

  it("requires every external factual line to cite an allowed article", () => {
    const allowed = [{ pmid: "12345678", doi: "10.1000/example" }];
    expect(externalClaimsAreCited(
      "EGFR is a receptor kinase. [PMID: 12345678; DOI: 10.1000/example]",
      allowed,
    )).toBe(true);
    expect(externalClaimsAreCited(
      "EGFR is a receptor kinase.\nIt is clinically important. [PMID: 12345678; DOI: 10.1000/example]",
      allowed,
    )).toBe(false);
    expect(externalClaimsAreCited(
      "| Kinase | Evidence | References |\n|---|---|---|\n| [GRK2](/kinases/GRK2) | GRK2 phosphorylates GPCRs. | [PMID: 12345678; DOI: 10.1000/example] |",
      allowed,
    )).toBe(true);
  });
});
