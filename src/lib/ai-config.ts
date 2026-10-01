import "server-only";

import { decryptSecret, type AccountDocument, type AiMode } from "@/lib/auth";

export type AiVendor = "openai" | "gemini" | "anthropic" | "nvidia" | "ollama";

export type EffectiveAiSettings = {
  source: AiMode;
  vendor: AiVendor;
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type SystemAiSummary = {
  available: boolean;
  vendor: AiVendor | null;
  model: string | null;
};

export const VENDOR_BASE_URLS: Record<AiVendor, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  anthropic: "https://api.anthropic.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  ollama: "http://localhost:11434/v1",
};

export const PERSONAL_VENDORS: AiVendor[] = ["openai", "gemini", "anthropic", "nvidia"];

export class AiConfigurationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 409 | 422 | 503,
  ) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

function isAiVendor(value: string): value is AiVendor {
  return Object.prototype.hasOwnProperty.call(VENDOR_BASE_URLS, value);
}

function inferSystemVendor(baseUrl: string): AiVendor {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("nvidia")) return "nvidia";
  if (lower.includes("generativelanguage.googleapis.com")) return "gemini";
  if (lower.includes("anthropic.com")) return "anthropic";
  if (lower.includes("localhost:11434")) return "ollama";
  return "openai";
}

function systemAiSettings(): EffectiveAiSettings | null {
  const apiKey = process.env.LLM_API_KEY?.trim() || "";
  const model = process.env.LLM_MODEL?.trim() || "";
  const baseUrl = process.env.LLM_BASE_URL?.trim() || VENDOR_BASE_URLS.openai;
  const configuredVendor = process.env.LLM_VENDOR?.trim().toLowerCase() || "";
  const vendor = configuredVendor && isAiVendor(configuredVendor)
    ? configuredVendor
    : inferSystemVendor(baseUrl);

  if (!apiKey || !model || !baseUrl) return null;
  return { source: "system", vendor, apiKey, model, baseUrl };
}

export function getSystemAiSummary(): SystemAiSummary {
  const settings = systemAiSettings();
  return settings
    ? { available: true, vendor: settings.vendor, model: settings.model }
    : { available: false, vendor: null, model: null };
}

export function resolveAiSettings(user: AccountDocument | null): EffectiveAiSettings {
  if (!user) {
    throw new AiConfigurationError("Sign in and configure an AI provider before using KinomeX AI.", 401);
  }

  const mode = user.aiSettings?.mode || "personal";
  if (mode === "system") {
    if (!user.isAdmin) {
      throw new AiConfigurationError(
        "System AI is available to Group administrators only.",
        403,
      );
    }
    const settings = systemAiSettings();
    if (!settings) {
      throw new AiConfigurationError(
        "The Dokhlab system AI provider is not configured.",
        503,
      );
    }
    return settings;
  }

  const saved = user.aiSettings;
  if (!saved || !isAiVendor(saved.vendor) || !saved.model.trim()) {
    throw new AiConfigurationError(
      "Configure an AI provider and your own API key in User & AI settings.",
      409,
    );
  }
  if (saved.vendor === "ollama") {
    throw new AiConfigurationError(
      "Ollama is a server-local provider and is available only through the administrator-managed AI configuration.",
      403,
    );
  }

  let apiKey = "";
  try {
    apiKey = decryptSecret(saved.encryptedApiKey);
  } catch {
    apiKey = "";
  }
  if (!apiKey) {
    throw new AiConfigurationError(
      "Configure an AI provider and your own API key in User & AI settings.",
      409,
    );
  }

  return {
    source: "personal",
    vendor: saved.vendor,
    apiKey,
    model: saved.model.trim(),
    // Ignore the persisted URL. The provider allow-list owns this value and
    // prevents a legacy document from turning chat into an SSRF primitive.
    baseUrl: VENDOR_BASE_URLS[saved.vendor],
  };
}

export function normalizeLegacyOllamaModel(settings: EffectiveAiSettings) {
  if (settings.vendor !== "ollama") return settings;
  const legacyModels: Record<string, string> = { qwen3: "qwen3:14b", mistral: "mistral:latest" };
  return {
    ...settings,
    model: legacyModels[settings.model.toLowerCase()] || settings.model,
  };
}

