"use client";

import { motion } from "framer-motion";
import ChatInterface from "@/components/chat/ChatInterface";
import KinaseAssistantIcon from "@/components/ui/KinaseAssistantIcon";

export default function SearchPage() {
  return (
    <div className="min-h-screen pb-12 pt-6 sm:pt-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6 flex items-center gap-4"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-kinome-cyan/20 bg-kinome-cyan/10 shadow-[0_0_30px_rgba(56,189,248,0.08)]">
            <KinaseAssistantIcon className="h-7 w-7 text-kinome-cyan" />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-kinome-cyan/80">
              Evidence workspace
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              AI Kinase Research Assistant
            </h1>
          </div>
        </motion.header>

        <motion.main
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="relative h-[calc(100vh-13rem)] min-h-[620px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/45 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl"
        >
          <div className="pointer-events-none absolute -left-32 -top-32 h-72 w-72 rounded-full bg-kinome-cyan/[0.06] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-36 -right-28 h-80 w-80 rounded-full bg-kinome-violet/[0.06] blur-3xl" />
          <div className="relative h-full p-4 sm:p-6">
            <ChatInterface />
          </div>
        </motion.main>
      </div>
    </div>
  );
}
