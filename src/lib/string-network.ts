export interface StringInteraction {
  source: string;
  target: string;
  sourceStringId: string;
  targetStringId: string;
  score: number;
  experimentalScore: number;
  databaseScore: number;
  textMiningScore: number;
}

export function stringProteinUrl(identifier: string): string {
  return `https://string-db.org/network/homo_sapiens/${encodeURIComponent(identifier)}`;
}

export function stringAssociationUrl(source: string, target: string): string {
  const identifiers = `${source}\r${target}`;
  return `https://string-db.org/cgi/network?identifiers=${encodeURIComponent(identifiers)}&species=9606`;
}

export async function fetchStringAssociations(
  gene: string,
  addNodes = 10,
  requiredScore = 700,
  fetcher: typeof fetch = fetch,
): Promise<StringInteraction[]> {
  const body = new URLSearchParams({
    identifiers: gene,
    species: "9606",
    required_score: String(requiredScore),
    network_type: "functional",
    add_nodes: String(addNodes),
    caller_identity: "KinomeX",
  });
  const response = await fetcher("https://string-db.org/api/tsv/network", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/tab-separated-values" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return [];
  return parseStringNetworkTsv(await response.text());
}

export function parseStringNetworkTsv(tsv: string): StringInteraction[] {
  const [headerLine, ...lines] = tsv.trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = headerLine.split("\t");
  const index = (name: string) => headers.indexOf(name);
  return lines.flatMap((line) => {
    const cells = line.split("\t");
    const source = cells[index("preferredName_A")];
    const target = cells[index("preferredName_B")];
    const score = Number(cells[index("score")]);
    if (!source || !target || !Number.isFinite(score)) return [];
    return [{
      source,
      target,
      sourceStringId: cells[index("stringId_A")] || "",
      targetStringId: cells[index("stringId_B")] || "",
      score,
      experimentalScore: Number(cells[index("escore")]) || 0,
      databaseScore: Number(cells[index("dscore")]) || 0,
      textMiningScore: Number(cells[index("tscore")]) || 0,
    }];
  });
}
