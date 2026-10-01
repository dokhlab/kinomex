// Release test (JMB revision Task 1.6): fetches every page, the JSON APIs the
// pages read, and the README, and fails when any displayed catalog count differs
// from GET /api/catalog/accounting.
//
//   node scripts/release_check.mjs --base=https://kinomex.dokhlab.org [--render] [--output=audit/release-check.json]
//
// --render also loads each page in headless Chromium (requires the `playwright`
// package) and checks the rendered text; --render-base sets a different origin for the browser,
// and PW_ARGS passes "|"-separated Chromium arguments.
import fs from "node:fs/promises";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const RENDER_BASE = arg("render-base", BASE).replace(/\/$/, "");
const OUTPUT = arg("output", null);
const RENDER = process.argv.includes("--render");
const PAGES = ["/", "/explorer", "/tree", "/docs", "/tutorial", "/search", "/kinases/EGFR", "/kinases/PIK3CA"];

const results = [];
const check = (name, observed, expected) => {
  const pass = JSON.stringify(observed) === JSON.stringify(expected);
  results.push({ name, pass, observed, expected });
};
const num = (s) => Number(String(s).replace(/,/g, ""));

async function getJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const acc = await getJson("/api/catalog/accounting");
const src = Object.fromEntries(acc.sources.map((s) => [s.source, s]));
const core = acc.core_entries;
const ext = acc.extension_entries;
const total = acc.total_entries;
check("accounting: total = core + extensions", total, core + ext);

// Site-wide description in every page head.
const DESC = /Explore ([\d,]+) human kinase entries \(([\d,]+) KinHub core \+ ([\d,]+) reviewed UniProt extensions\)/;
for (const page of PAGES) {
  const html = await (await fetch(BASE + page)).text();
  const m = html.match(/<meta name="description" content="([^"]*)"/);
  const d = m?.[1].match(DESC);
  check(`${page}: meta description counts`, d ? [num(d[1]), num(d[2]), num(d[3])] : null, [total, core, ext]);
  const stale = html.match(/518\+|501 Protein Kinases|Live catalog accounting is unavailable|Next\.js 14|port 3007/);
  check(`${page}: no stale count or architecture text`, stale ? stale[0] : null, null);
}

// JSON the pages render.
const stats = await getJson("/api/kinases/stats");
check("stats.totalKinases", stats.totalKinases, total);
check("stats.groupDistribution", stats.groupDistribution, acc.core_group_counts);
check("stats.extensionClassDistribution", stats.extensionClassDistribution, acc.extension_class_counts);
check("stats.totalLigands", stats.totalLigands, src.ligands.records);
check("stats.totalStructures", stats.totalStructures, src.pdb.records);
check("stats.totalClinVarRecords", stats.totalClinVarRecords, src.clinvar.records);
check("stats.pdisScale", stats.pdisScale, "0-100");
check("stats.topMutatedKinases have PDIS", stats.topMutatedKinases.every((k) => typeof k.pdis_score === "number"), true);
const list = await getJson("/api/kinases?limit=1");
check("kinases.total", list.total, total);
check("kinases.partitionBreakdown", list.partitionBreakdown, { kinhub_core: core, uniprot_extended: ext });
const table = await getJson("/api/catalog/table");
check("catalog table rows", table.rows.length, total);

// README.
const readme = await fs.readFile(new URL(process.env.README_PATH || "../README.md", import.meta.url), "utf8");
const r = readme.match(/([\d,]+) human kinase entries \(([\d,]+) KinHub core \+ ([\d,]+) UniProt extensions\)/);
check("README catalog counts", r ? [num(r[1]), num(r[2]), num(r[3])] : null, [total, core, ext]);
const rs = readme.match(/snapshot of ([0-9-]{10})/);
check("README snapshot date", rs?.[1] ?? null, acc.snapshot_date);
for (const [label, key] of [["experimental structures", "pdb"], ["ligand records", "ligands"], ["ClinVar records", "clinvar"], ["GTEx records", "gtex"]]) {
  const m = readme.match(new RegExp(`([\\d,]+) ${label}`));
  check(`README ${label}`, m ? num(m[1]) : null, src[key].records);
}

// Rendered text.
if (RENDER) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.PW_ARGS ? { args: process.env.PW_ARGS.split("|") } : {});
  const text = async (path, waitFor) => {
    const page = await browser.newPage();
    await page.goto(RENDER_BASE + path, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(waitFor, null, { timeout: 120000 });
    const t = await page.innerText("body");
    await page.close();
    return t;
  };
  const home = await text("/", () => /Catalog:\s*\d+ entries/.test(document.body.innerText));
  const h = home.match(/Catalog:\s*(\d+) entries: (\d+) KinHub core entries \((\d+) KinHub kinase-domain rows\) and (\d+) reviewed/);
  check("home: rendered catalog counts", h ? h.slice(1).map(num) : null, [total, core, acc.kinhub_domain_rows, ext]);
  const explorer = await text("/explorer", () => /Catalog entries\s*\n?\s*\d+/.test(document.body.innerText) && document.querySelector("table"));
  const e = explorer.match(/Catalog entries\s*(\d+)\s*KinHub core\s*(\d+)\s*UniProt extensions\s*(\d+)/);
  check("explorer: rendered sidebar counts", e ? e.slice(1).map(num) : null, [total, core, ext]);
  const tree = await text("/tree", () => /The tree shows the \d+ catalog entries/.test(document.body.innerText));
  const t = tree.match(/The tree shows the (\d+) catalog entries.*?the (\d+) UniProt KW-0418 extensions/s);
  check("tree: rendered counts", t ? t.slice(1).map(num) : null, [total, ext]);
  const docs = await text("/docs", () => /[\d,]+\s*Catalog entries/.test(document.body.innerText));
  const d = docs.match(/([\d,]+)\s*Catalog entries\s*([\d,]+)\s*KinHub core entries\s*([\d,]+)\s*Reviewed UniProt extensions/);
  check("docs: rendered accounting cards", d ? d.slice(1).map(num) : null, [total, core, ext]);
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
for (const x of results) console.log(`${x.pass ? "PASS" : "FAIL"}  ${x.name}${x.pass ? "" : `  observed=${JSON.stringify(x.observed)} expected=${JSON.stringify(x.expected)}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks pass against ${BASE}`);
if (OUTPUT) {
  await fs.writeFile(OUTPUT, JSON.stringify({ base: BASE, run_at: new Date().toISOString(), rendered: RENDER, accounting_snapshot: acc.snapshot_date, results }, null, 2));
}
process.exit(failed.length ? 1 : 0);
