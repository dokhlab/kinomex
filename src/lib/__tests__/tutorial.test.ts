import { PROTOCOLS } from "@/lib/tutorial";
import { explorerHref, stateFromParams } from "@/lib/catalog/url";

test("each protocol's Try it address restores its filters and weights", () => {
  for (const p of PROTOCOLS) {
    const href = explorerHref({ filters: p.filters, weights: p.weights });
    const state = stateFromParams(new URLSearchParams(href.split("?")[1] ?? ""));
    expect(state.weights).toEqual(p.weights);
    expect(state.filters).toMatchObject(p.filters);
  }
  expect(explorerHref({ filters: PROTOCOLS[0].filters, weights: PROTOCOLS[0].weights }))
    .toBe("/explorer?partition=kinhub_core&max_citations=100&has_structure=1&min_compounds=100&w=0%2C0%2C0.5%2C0.5");
  expect(explorerHref({ filters: PROTOCOLS[1].filters, weights: PROTOCOLS[1].weights })).toBe("/explorer?organ=CNS&enriched=1");
});
