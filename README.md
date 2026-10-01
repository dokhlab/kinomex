This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Ligand evidence

ChEMBL activity records are mapped to KinomeX genes through UniProt-linked
human targets. Quantitative records retain their ChEMBL activity IDs and are
upserted by `(source, activity_id)`, while the kinase dossier consolidates
each source compound to its most potent finite nM measurement and reports the
number of supporting assay records. Curated development candidates are shown
separately and each candidate requires a trial-registry or primary-literature
source link.

After a ligand data refresh, generate the integrity report with:

```bash
npm run audit:ligands
```

The report is written to `reports/ligand-coverage.json`. A kinase absent from
the report has no mapped record in the connected source snapshot; this is not
evidence that no ligand exists. The Ligands table supports compound search,
nM range filters, binding/assay filters, source links, resizable columns, and
100-compound pagination.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
