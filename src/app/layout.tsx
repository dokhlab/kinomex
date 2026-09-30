import type { Metadata } from "next";
import "./globals.css";
import Navigation from "@/components/ui/Navigation";
import BiomedicalBackground from "@/components/ui/BiomedicalBackground";
import { loadCatalog } from "@/lib/catalog/load";
import { siteDescription } from "@/lib/catalog/description";

export const dynamic = "force-dynamic";
const KEYWORDS = ["kinome", "kinase", "phosphorylation", "signal transduction", "proteomics", "bioinformatics"];

// The description reads its counts from the catalog accounting at request time.
export async function generateMetadata(): Promise<Metadata> {
  const accounting = await loadCatalog().then((c) => c.accounting).catch(() => null);
  return {
    title: "KinomeX - Human Kinome Explorer",
    description: siteDescription(accounting),
    keywords: KEYWORDS,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-kinome-dark antialiased">
        <BiomedicalBackground />
        <Navigation />
        <main className="pt-16 relative z-10">{children}</main>
      </body>
    </html>
  );
}
