"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { TabButton } from "@/components/docs/ui";
import AboutTab from "@/components/docs/AboutTab";
import TechnicalTab from "@/components/docs/TechnicalTab";
import EncyclopediaTab from "@/components/docs/EncyclopediaTab";
import AttributionsTab from "@/components/docs/AttributionsTab";

const tabs = ["About", "Technical", "Encyclopedia", "Attributions"] as const;
type Tab = (typeof tabs)[number];

function DocsContent() {
  const requested = useSearchParams().get("tab") as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(requested && tabs.includes(requested) ? requested : "About");

  return (
    <div className="min-h-screen bg-kinome-deep pb-16 pt-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-wrap items-center gap-2 border-b border-white/10 pb-4">
          {tabs.map((tab) => <TabButton key={tab} label={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)} />)}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
            {activeTab === "About" && <AboutTab />}
            {activeTab === "Technical" && <TechnicalTab />}
            {activeTab === "Encyclopedia" && <EncyclopediaTab />}
            {activeTab === "Attributions" && <AttributionsTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <DocsContent />
    </Suspense>
  );
}
