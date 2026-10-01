"use client";

import { useEffect, useState } from "react";
import {
  AI_SESSION_KEY,
  AiSettings,
  AiVendor,
  VENDOR_DEFAULTS,
  VENDOR_MODELS,
} from "@/lib/user-ai-settings";

export type PublicUser = {
  name: string;
  username: string;
  hasPasskey: boolean;
  isAdmin: boolean;
  aiSettings: {
    mode: "personal" | "system";
    vendor: string;
    model: string;
    hasApiKey: boolean;
  } | null;
};

type SavedAiSettings = {
  mode: "personal" | "system";
  vendor: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
} | null;

type SystemSummary = {
  available: boolean;
  vendor: AiVendor | null;
  model: string | null;
};

type SettingsResponse = {
  settings: SavedAiSettings;
  capabilities: {
    isAdmin: boolean;
    canUseSystemKey: boolean;
    system?: SystemSummary;
  };
};

type Props = {
  user: PublicUser;
  onUserRefresh: () => Promise<void>;
};

const defaultAi: AiSettings = {
  vendor: "openai",
  apiKey: "",
  model: VENDOR_DEFAULTS.openai.model,
  baseUrl: VENDOR_DEFAULTS.openai.baseUrl,
};

function isAiVendor(value: string): value is AiVendor {
  return Object.prototype.hasOwnProperty.call(VENDOR_DEFAULTS, value);
}

function providerLabel(vendor: AiVendor | string) {
  return isAiVendor(vendor) ? VENDOR_DEFAULTS[vendor].label : vendor;
}

export default function AiProviderSettings({ user, onUserRefresh }: Props) {
  const [settings, setSettings] = useState<SavedAiSettings>(null);
  const [capabilities, setCapabilities] = useState<SettingsResponse["capabilities"]>({
    isAdmin: user.isAdmin,
    canUseSystemKey: false,
  });
  const [activeTab, setActiveTab] = useState<"personal" | "system">("personal");
  const [ai, setAi] = useState<AiSettings>(defaultAi);
  const [custom, setCustom] = useState(false);
  const [aiTest, setAiTest] = useState<{
    kind: "idle" | "testing" | "success" | "error";
    message: string;
  }>({ kind: "idle", message: "" });

  const sync = async () => {
    const response = await fetch("/api/account/ai-settings", {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return;
    const data = await response.json() as SettingsResponse;
    setSettings(data.settings);
    setCapabilities(data.capabilities);

    const saved = data.settings;
    if (saved && isAiVendor(saved.vendor)) {
      const nextAi = {
        vendor: saved.vendor,
        apiKey: "",
        model: saved.model,
        baseUrl: saved.baseUrl,
      } satisfies AiSettings;
      setAi(nextAi);
      setCustom(!VENDOR_MODELS[saved.vendor].some((option) => option.id === saved.model));
      setActiveTab(saved.mode === "system" && data.capabilities.canUseSystemKey ? "system" : "personal");
    } else {
      setAi(defaultAi);
      setCustom(false);
      setActiveTab("personal");
    }
    sessionStorage.removeItem(AI_SESSION_KEY);
    window.dispatchEvent(new Event("kinomex-ai-settings"));
  };

  useEffect(() => {
    void sync();
  }, [user.username, user.isAdmin]);

  // Ollama is server-local in the server-side resolver, so it is not a
  // personal provider for any account. Administrators can use it through the
  // system-managed source when LLM_BASE_URL points to Ollama.
  const hostedVendors = (Object.keys(VENDOR_DEFAULTS) as AiVendor[]).filter((vendor) => vendor !== "ollama");
  const personalSettings = settings;
  const hasUnsavedChanges = !personalSettings ||
    personalSettings.vendor !== ai.vendor ||
    personalSettings.model !== ai.model ||
    Boolean(ai.apiKey);
  const canSave = Boolean(ai.model.trim()) && Boolean(ai.apiKey.trim() || personalSettings?.hasApiKey);

  const selectMode = async (mode: "personal" | "system") => {
    if (mode === "system" && !capabilities.canUseSystemKey) return;
    setAiTest({ kind: "testing", message: mode === "system" ? "Activating the system AI provider…" : "Switching to your personal provider…" });
    try {
      const response = await fetch("/api/account/ai-settings/mode", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setAiTest({ kind: "error", message: data.error || "The AI source could not be changed." });
        return;
      }
      setActiveTab(mode);
      setAiTest({
        kind: "success",
        message: mode === "system"
          ? "System AI is now active for this administrator account."
          : "Your personal AI provider is now active.",
      });
      await onUserRefresh();
      await sync();
    } catch {
      setAiTest({ kind: "error", message: "The AI source could not reach the KinomeX server." });
    }
  };

  const save = async () => {
    setAiTest({ kind: "testing", message: `Saving ${providerLabel(ai.vendor)} and verifying model “${ai.model}”…` });
    const response = await fetch("/api/account/ai-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendor: ai.vendor, model: ai.model, apiKey: ai.apiKey }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) {
      setAiTest({ kind: "error", message: data.error || "AI settings could not be saved." });
      return;
    }
    sessionStorage.removeItem(AI_SESSION_KEY);
    window.dispatchEvent(new Event("kinomex-ai-settings"));
    const testResponse = await fetch("/api/account/ai-settings/test", { method: "POST" });
    const testData = await testResponse.json() as { message?: string; error?: string };
    setAiTest(testResponse.ok
      ? { kind: "success", message: `Settings saved. ${testData.message || "Connection verified."}` }
      : { kind: "error", message: `Settings saved, but verification failed: ${testData.error || "Unknown error."}` });
    await onUserRefresh();
    await sync();
  };

  const testAi = async () => {
    if (settings?.mode === "system" && activeTab === "system") {
      setAiTest({ kind: "testing", message: "Contacting the system AI provider…" });
    } else {
      setAiTest({ kind: "testing", message: `Contacting your saved ${providerLabel(ai.vendor)} configuration…` });
    }
    try {
      const response = await fetch("/api/account/ai-settings/test", { method: "POST" });
      const data = await response.json() as { message?: string; error?: string };
      setAiTest(response.ok
        ? { kind: "success", message: data.message || "Connection verified." }
        : { kind: "error", message: data.error || "The connection test failed." });
    } catch {
      setAiTest({ kind: "error", message: "The connection test could not reach the KinomeX server." });
    }
  };

  const chooseVendor = (vendor: AiVendor) => {
    setAiTest({ kind: "idle", message: "" });
    setCustom(false);
    setAi({
      vendor,
      apiKey: "",
      model: VENDOR_DEFAULTS[vendor].model,
      baseUrl: VENDOR_DEFAULTS[vendor].baseUrl,
    });
  };

  const system = capabilities.system;
  const systemActive = settings?.mode === "system" && capabilities.canUseSystemKey;
  const personalActive = !systemActive;

  return (
    <section aria-labelledby="ai-provider-heading">
      <div className="my-6 border-t border-white/10" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="ai-provider-heading" className="text-xs font-semibold uppercase tracking-widest text-kinome-violet">
          Synchronized AI provider
        </h3>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${systemActive ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-kinome-cyan/25 bg-kinome-cyan/10 text-kinome-cyan"}`}>
          Active: {systemActive ? "System API key" : "My API key"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-1 rounded-xl bg-slate-950/50 p-1 sm:grid-cols-2" role="tablist" aria-label="AI credential source">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "personal"}
          onClick={() => setActiveTab("personal")}
          className={`rounded-lg px-3 py-2 text-sm ${activeTab === "personal" ? "bg-kinome-cyan/15 text-white" : "text-slate-400 hover:text-white"}`}
        >
          My API key
        </button>
        {capabilities.canUseSystemKey && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "system"}
            onClick={() => setActiveTab("system")}
            className={`rounded-lg px-3 py-2 text-sm ${activeTab === "system" ? "bg-amber-400/15 text-amber-100" : "text-slate-400 hover:text-white"}`}
          >
            System API key
          </button>
        )}
      </div>

      {activeTab === "system" && capabilities.canUseSystemKey ? (
        <div role="tabpanel" className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/[.04] p-4">
          <h4 className="text-sm font-medium text-amber-100">System-managed AI</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            This uses the provider configured by Dokhlab. The system API key stays on the server and is never sent to this browser.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Info label="Provider" value={system?.vendor ? providerLabel(system.vendor) : "Not configured"} />
            <Info label="Model" value={system?.model || "Not configured"} />
          </div>
          <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${system?.available ? "border-emerald-400/20 bg-emerald-400/[.05] text-emerald-100" : "border-red-400/20 bg-red-400/[.05] text-red-200"}`}>
            {system?.available
              ? "System AI is available to Group administrators."
              : "System AI is not configured on the Dokhlab server."}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void selectMode("system")}
              disabled={!system?.available || systemActive || aiTest.kind === "testing"}
              className="rounded-xl bg-amber-300 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              {systemActive ? "System API key is active" : "Use system API key"}
            </button>
            <button
              type="button"
              onClick={() => void testAi()}
              disabled={!system?.available || !systemActive || aiTest.kind === "testing"}
              className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-white disabled:opacity-40"
            >
              Verify system provider
            </button>
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="mt-4">
          <p className="mb-3 text-xs leading-relaxed text-slate-400">
            Requests from this account use your own encrypted provider credential. The key is never stored in browser session storage.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {hostedVendors.map((vendor) => (
              <button
                type="button"
                key={vendor}
                onClick={() => chooseVendor(vendor)}
                className={`min-w-0 rounded-xl border px-2 py-2 text-xs ${ai.vendor === vendor ? "border-kinome-cyan text-white" : "border-white/10 text-slate-400"}`}
              >
                {VENDOR_DEFAULTS[vendor].label}
              </button>
            ))}
          </div>
          <ModelSelector ai={ai} custom={custom} setCustom={setCustom} setModel={(model) => {
            setAiTest({ kind: "idle", message: "" });
            setAi({ ...ai, model });
          }} />
          <label className="block text-xs text-slate-400">
            {personalSettings?.hasApiKey ? "New API key (leave blank to retain saved key)" : "API key"}
            <input
              type="password"
              value={ai.apiKey}
              onChange={(event) => {
                setAiTest({ kind: "idle", message: "" });
                setAi({ ...ai, apiKey: event.target.value });
              }}
              autoComplete="new-password"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-kinome-cyan/50"
            />
          </label>
          {hasUnsavedChanges && (
            <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[.05] px-3 py-2 text-xs text-amber-100">
              Unsaved selection. Verification applies to the last saved provider until these settings are saved.
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave || aiTest.kind === "testing"}
              className="w-full rounded-xl bg-kinome-cyan px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40 sm:w-auto"
            >
              Save encrypted settings
            </button>
            <button
              type="button"
              onClick={() => void testAi()}
              disabled={!settings || !personalActive || hasUnsavedChanges || aiTest.kind === "testing"}
              className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-white disabled:opacity-40"
            >
              {aiTest.kind === "testing" ? "Testing connection…" : "Verify provider & model"}
            </button>
            {user.isAdmin && settings?.mode === "system" && (
              <button
                type="button"
                onClick={() => void selectMode("personal")}
                disabled={aiTest.kind === "testing"}
                className="rounded-xl border border-amber-300/20 px-5 py-2.5 text-sm text-amber-100 disabled:opacity-40"
              >
                Use my API key
              </button>
            )}
          </div>
          {aiTest.kind !== "idle" && <AiConnectionStatus state={aiTest} />}
        </div>
      )}
      {aiTest.kind !== "idle" && activeTab === "system" && <AiConnectionStatus state={aiTest} />}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm text-white">{value}</div>
    </div>
  );
}

function ModelSelector({
  ai,
  custom,
  setCustom,
  setModel,
}: {
  ai: AiSettings;
  custom: boolean;
  setCustom: (value: boolean) => void;
  setModel: (value: string) => void;
}) {
  return (
    <div className="my-3 text-xs text-slate-400">
      Model
      <select
        value={custom ? "custom" : ai.model}
        onChange={(event) => {
          if (event.target.value === "custom") {
            setCustom(true);
            setModel("");
          } else {
            setCustom(false);
            setModel(event.target.value);
          }
        }}
        className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white"
      >
        {VENDOR_MODELS[ai.vendor].map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
        <option value="custom">Custom model ID…</option>
      </select>
      {custom && (
        <input
          autoFocus
          value={ai.model}
          onChange={(event) => setModel(event.target.value)}
          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white"
        />
      )}
    </div>
  );
}

function AiConnectionStatus({ state }: { state: { kind: "idle" | "testing" | "success" | "error"; message: string } }) {
  const style = state.kind === "success"
    ? "border-emerald-400/25 bg-emerald-400/[.06] text-emerald-200"
    : state.kind === "error"
      ? "border-red-400/25 bg-red-400/[.06] text-red-200"
      : "border-kinome-cyan/20 bg-kinome-cyan/[.05] text-slate-300";
  return (
    <div role="status" aria-live="polite" className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed ${style}`}>
      <span className="mr-1.5" aria-hidden="true">{state.kind === "success" ? "✓" : state.kind === "error" ? "⚠" : "◌"}</span>
      {state.message}
    </div>
  );
}
