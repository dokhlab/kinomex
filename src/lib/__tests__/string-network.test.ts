import { parseStringNetworkTsv, stringAssociationUrl, stringProteinUrl } from "@/lib/string-network";

describe("STRING network parsing", () => {
  it("parses preferred kinase names and evidence scores", () => {
    const tsv = [
      "stringId_A\tstringId_B\tpreferredName_A\tpreferredName_B\tnscore\tfscore\tpscore\tascore\tescore\tdscore\ttscore\tscore",
      "9606.ENSP1\t9606.ENSP2\tEGFR\tERBB2\t0\t0\t0\t0\t0.8\t0.7\t0.4\t0.95",
    ].join("\n");
    expect(parseStringNetworkTsv(tsv)).toEqual([{
      source: "EGFR", target: "ERBB2", sourceStringId: "9606.ENSP1", targetStringId: "9606.ENSP2",
      score: 0.95, experimentalScore: 0.8, databaseScore: 0.7, textMiningScore: 0.4,
    }]);
  });

  it("ignores malformed interaction rows", () => {
    expect(parseStringNetworkTsv("preferredName_A\tpreferredName_B\tscore\nEGFR\t\tbad")).toEqual([]);
  });

  it("builds STRING human-protein links with an explicit species path", () => {
    expect(stringProteinUrl("IP6K3")).toBe("https://string-db.org/network/homo_sapiens/IP6K3");
  });

  it("builds a direct STRING association link for a protein pair", () => {
    expect(stringAssociationUrl("PTK2", "PXN")).toBe(
      "https://string-db.org/cgi/network?identifiers=PTK2%0DPXN&species=9606"
    );
  });
});
