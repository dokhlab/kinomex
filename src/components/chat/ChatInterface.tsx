"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CHAT_SESSION_KEY, parseChatSession, saveChatSession, type ChatMessage } from "@/lib/chat-session";
import KinaseAssistantIcon from "@/components/ui/KinaseAssistantIcon";
import { loadAiSettings } from "@/lib/user-ai-settings";

const RETRYABLE_EVIDENCE_FAILURES = [
  "No connected KinomeX, STRING, UniProt, or PubMed source returned verifiable evidence",
  "External information is unavailable because its PubMed and DOI references could not be verified",
];

function isRetryableEvidenceFailure(content: string): boolean {
  return RETRYABLE_EVIDENCE_FAILURES.some((message) => content.includes(message));
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return "Earlier in this session";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Earlier in this session";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function isDeterministicEvidenceQuery(query: string): boolean {
  return /\b(interact\w*|associat\w*|network|partners?|binds?|binding)\b/i.test(query);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(line: string): string {
  return line
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 text-xs bg-white/10 rounded text-kinome-cyan font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em class="text-slate-300">$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-kinome-cyan underline hover:opacity-80">$1</a>');
}

function formatMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inTable = false;
  let tableRows: string[] = [];

  function flushTable() {
    if (!tableRows.length) return;
    const headerCells = tableRows[0].split("|").filter(Boolean);
    const bodyRows = tableRows.slice(2);
    let html = '<div class="overflow-x-auto my-4 rounded-xl border border-white/10 bg-slate-950/30"><table class="w-full text-sm border-collapse">';
    html += '<thead><tr>';
    for (const cell of headerCells) {
      html += `<th class="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold text-kinome-cyan uppercase tracking-wider border-b border-white/10 bg-white/[0.06]">${renderInline(cell.trim())}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of bodyRows) {
      const cells = row.split("|").filter(Boolean);
      if (!cells.length) continue;
      html += '<tr class="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]">';
      for (const cell of cells) {
        html += `<td class="px-4 py-3 align-top text-slate-300">${renderInline(cell.trim())}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    out.push(html);
    tableRows = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (raw.startsWith("```")) {
      if (inCode) { inCode = false; out.push("</pre>"); }
      else { inCode = true; out.push('<pre class="my-3 px-4 py-3 bg-slate-900/80 border border-white/10 rounded-xl overflow-x-auto text-xs text-slate-300 font-mono leading-relaxed">'); }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw) + "\n");
      continue;
    }

    // Table row
    if (raw.startsWith("|") && raw.endsWith("|")) {
      // Separator row (|---|) — skip it, but mark that we're in a table
      if (/^\|[\s:-]+\|$/.test(raw)) {
        if (!inTable) { inTable = true; tableRows = []; }
        continue;
      }
      inTable = true;
      tableRows.push(raw);
      continue;
    } else {
      if (inTable) { flushTable(); inTable = false; }
    }

    // Empty line
    if (!raw.trim()) { out.push('<div class="h-2"></div>'); continue; }

    // Headers
    if (raw.startsWith("### ")) { out.push(`<h4 class="text-sm font-bold text-white mt-4 mb-1">${renderInline(raw.slice(4))}</h4>`); continue; }
    if (raw.startsWith("## ")) { out.push(`<h3 class="text-base font-bold text-white mt-4 mb-1">${renderInline(raw.slice(3))}</h3>`); continue; }
    if (raw.startsWith("# ")) { out.push(`<h2 class="text-lg font-bold text-white mt-4 mb-1">${renderInline(raw.slice(2))}</h2>`); continue; }

    // List item
    if (/^[\-\*]\s/.test(raw)) { out.push(`<li class="text-slate-300 ml-4 list-disc">${renderInline(raw.replace(/^[\-\*]\s/, ""))}</li>`); continue; }

    // Numbered list
    if (/^\d+\.\s/.test(raw)) { out.push(`<li class="text-slate-300 ml-4 list-decimal">${renderInline(raw.replace(/^\d+\.\s/, ""))}</li>`); continue; }

    // Horizontal rule
    if (/^---+\s*$/.test(raw)) { out.push('<hr class="my-4 border-white/10" />'); continue; }

    // Regular paragraph line
    out.push(`<p class="text-sm text-slate-300 leading-relaxed">${renderInline(raw)}</p>`);
  }

  if (inTable) flushTable();
  if (inCode) out.push("</pre>");

  return out.join("\n");
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      setMessages(parseChatSession(window.sessionStorage.getItem(CHAT_SESSION_KEY)));
    } catch {
      setMessages([]);
    }
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    try {
      saveChatSession(window.sessionStorage, messages);
    } catch {
      // The conversation still works when browser storage is unavailable.
    }
  }, [messages, sessionLoaded]);

  useEffect(() => {
    if (followLatestRef.current) {
      bottomRef.current?.scrollIntoView({
        behavior: streamingContent ? "auto" : "smooth",
        block: "nearest",
      });
    }
  }, [messages, streamingContent]);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesRef.current;
    if (!viewport) return;
    followLatestRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72;
  }, []);

  const handleSubmit = useCallback(async (retryText?: string) => {
    const text = (retryText ?? input).trim();
    if (!text || loading) return;

    if (!retryText) setInput("");
    setError("");
    followLatestRef.current = true;

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    setStreamingContent("");

    try {
      if (isDeterministicEvidenceQuery(text)) {
        const evidenceResponse = await fetch(`/api/chat/evidence?q=${encodeURIComponent(text)}&request=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        const responseText = await evidenceResponse.text();
        let evidence: { matched?: boolean; content?: string; error?: string } = {};
        try { evidence = JSON.parse(responseText); } catch {}
        if (!evidenceResponse.ok) throw new Error(evidence.error || `Evidence endpoint returned HTTP ${evidenceResponse.status}.`);
        if (evidence.matched && evidence.content) {
          const evidenceContent = evidence.content;
          setMessages((prev) => [...prev, { role: "assistant", content: evidenceContent, timestamp: new Date().toISOString() }]);
          setLoading(false);
          return;
        }
        throw new Error(evidence.error || "The deterministic KinomeX evidence search returned no matches.");
      }
      const aiSettings = loadAiSettings();
      let accountConfigured = false;
      if (!aiSettings) {
        const accountResponse = await fetch("/api/auth/session");
        if (accountResponse.ok) accountConfigured = Boolean((await accountResponse.json()).user?.aiSettings);
      }
      if (!accountConfigured && (!aiSettings || (aiSettings.vendor !== "ollama" && !aiSettings.apiKey))) {
        setError("Open User & AI settings in the top-right corner and add your AI provider API key.");
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/chat?request=${Date.now()}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          ...(aiSettings ? { aiSettings } : {}),
        }),
      });

      if (!res.ok) {
        let msg = `Chat API error (${res.status})`;
        try {
          const data = await res.json();
          if (data.error) msg = data.error;
        } catch {}
        setError(msg);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response stream");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let fullContent = "";
      let eventBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        eventBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = eventBuffer.split("\n");
        eventBuffer = done ? "" : lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.content) {
              fullContent += parsed.content;
              setStreamingContent(fullContent);
            }
          } catch {}
        }
        if (done) break;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fullContent || "The response stream ended before any content was received. Please retry this request.", timestamp: new Date().toISOString() },
      ]);
      setStreamingContent("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const newChat = useCallback(() => {
    try {
      window.sessionStorage.removeItem(CHAT_SESSION_KEY);
    } catch {}
    setMessages([]);
    setStreamingContent("");
    setError("");
  }, []);

  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-white/[0.07] pb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <svg className="h-5 w-5 text-kinome-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM21 12c0 4.142-4.03 7.5-9 7.5a10.3 10.3 0 0 1-3.85-.73L3 20.25l1.57-3.66A6.78 6.78 0 0 1 3 12c0-4.142 4.03-7.5 9-7.5s9 3.358 9 7.5Z" />
            </svg>
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-kinome-emerald" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white sm:text-lg">Research conversation</h2>
            <p className="text-xs text-slate-500">Connected scientific sources</p>
          </div>
        </div>
        {hasMessages && (
          <button
            onClick={newChat}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        onScroll={handleMessagesScroll}
        className="mb-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-2 scrollbar-thin"
      >
        {!hasMessages && (
          <div className="flex min-h-full items-center justify-center py-8">
            <div className="w-full max-w-2xl rounded-3xl border border-white/[0.08] bg-white/[0.025] px-6 py-8 text-center shadow-[0_20px_60px_rgba(2,6,23,0.25)] sm:px-10">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-kinome-cyan/15 to-kinome-violet/15 shadow-[0_0_40px_rgba(56,189,248,0.08)]">
              <svg className="h-7 w-7 text-kinome-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
              <h3 className="mb-2 text-xl font-semibold text-white">Begin a research conversation</h3>
              <p className="mx-auto max-w-lg text-sm leading-relaxed text-slate-400">
                Ask about kinase biology, function, interactions, disease evidence, or records available in KinomeX.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Connected evidence sources">
                {[
                  ["KinomeX", "text-kinome-cyan border-kinome-cyan/20 bg-kinome-cyan/[0.07]"],
                  ["Swiss-Prot", "text-kinome-violet border-kinome-violet/20 bg-kinome-violet/[0.07]"],
                  ["STRING", "text-kinome-emerald border-kinome-emerald/20 bg-kinome-emerald/[0.07]"],
                  ["PubMed", "text-amber-300 border-amber-400/20 bg-amber-400/[0.07]"],
                ].map(([label, style]) => (
                  <span key={label} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${style}`}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={`flex items-start gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-kinome-cyan/15 bg-kinome-cyan/[0.07] text-kinome-cyan sm:flex">
                <KinaseAssistantIcon className="h-5 w-5" />
              </div>
            )}
            <div
              className={`rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === "user"
                  ? "max-w-[78%] rounded-tr-md border border-kinome-cyan/20 bg-kinome-cyan/[0.12] text-slate-200"
                  : "max-w-[94%] rounded-tl-md border border-white/10 bg-slate-800/45 text-slate-300"
              }`}
            >
              {msg.role === "assistant" ? (
                <div>
                  <div
                    className="text-sm leading-relaxed prose prose-invert"
                    dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                  />
                  {isRetryableEvidenceFailure(msg.content) && (() => {
                    const priorQuestion = [...messages.slice(0, i)].reverse().find((item) => item.role === "user")?.content;
                    return priorQuestion ? <button onClick={() => void handleSubmit(priorQuestion)} disabled={loading} className="mt-3 rounded-lg border border-kinome-cyan/25 bg-kinome-cyan/[.08] px-3 py-1.5 text-xs font-medium text-kinome-cyan hover:bg-kinome-cyan/[.14] disabled:opacity-40">Retry with current evidence sources</button> : null;
                  })()}
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
              <time dateTime={msg.timestamp} className={`mt-1.5 block text-[10px] leading-none text-slate-500 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                {formatTimestamp(msg.timestamp)}
              </time>
            </div>
          </motion.div>
        ))}

        <AnimatePresence>
          {streamingContent && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="max-w-[94%] rounded-2xl rounded-tl-md border border-white/10 bg-slate-800/45 px-4 py-3 text-slate-300 shadow-sm">
                <div
                  className="text-sm leading-relaxed prose prose-invert"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(streamingContent) }}
                />
                <span className="inline-block w-2 h-4 bg-kinome-cyan/60 ml-0.5 animate-pulse rounded-sm" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-center"
          >
            <div className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400 max-w-md text-center">
              {error}
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-2 shadow-[0_12px_40px_rgba(2,6,23,0.3)] backdrop-blur-md transition-colors focus-within:border-kinome-cyan/25">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about KinomeX or the kinase literature..."
            rows={1}
            disabled={loading}
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-4 py-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 disabled:opacity-50"
          />
          <button
            onClick={() => void handleSubmit()}
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-kinome-cyan/30 bg-gradient-to-br from-kinome-cyan/25 to-kinome-cyan/10 text-white shadow-[0_0_24px_rgba(56,189,248,0.08)] transition-all duration-200 hover:border-kinome-cyan/50 hover:from-kinome-cyan/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
