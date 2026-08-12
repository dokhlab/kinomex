export type AiVendor = "openai" | "gemini" | "anthropic" | "nvidia" | "ollama";

export interface UserProfile {
  name: string;
  username: string;
  passwordEnabled: boolean;
  passkeyCredentialId?: string;
}

export interface AiSettings {
  vendor: AiVendor;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export const PROFILE_STORAGE_KEY = "kinomex.user-profile.v1";
export const AI_SESSION_KEY = "kinomex.ai-settings.v1";
export const PASSWORD_HASH_KEY = "kinomex.profile-password.v1";

export const VENDOR_DEFAULTS: Record<AiVendor, { label: string; model: string; baseUrl: string; needsKey: boolean }> = {
  openai: { label: "ChatGPT / OpenAI", model: "gpt-5-mini", baseUrl: "https://api.openai.com/v1", needsKey: true },
  gemini: { label: "Gemini", model: "gemini-3.6-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true },
  anthropic: { label: "Claude", model: "claude-sonnet-5", baseUrl: "https://api.anthropic.com/v1/", needsKey: true },
  nvidia: { label: "NVIDIA NIM", model: "nvidia/nemotron-3-ultra-550b-a55b", baseUrl: "https://integrate.api.nvidia.com/v1", needsKey: true },
  ollama: { label: "Ollama", model: "qwen3:14b", baseUrl: "http://localhost:11434/v1", needsKey: false },
};

export const VENDOR_MODELS: Record<AiVendor, Array<{ id: string; label: string }>> = {
  openai: [
    { id: "gpt-5.1", label: "GPT-5.1 — highest capability" },
    { id: "gpt-5-mini", label: "GPT-5 mini — balanced (recommended)" },
    { id: "gpt-5-nano", label: "GPT-5 nano — fastest / lowest cost" },
    { id: "gpt-4.1", label: "GPT-4.1 — strong non-reasoning model" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini — economical" },
  ],
  gemini: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash — balanced (recommended)" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash — higher capability" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — fastest / lowest cost" },
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced (recommended)" },
    { id: "claude-opus-5", label: "Claude Opus 5 — complex research" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest / lowest cost" },
  ],
  nvidia: [
    { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra — highest capability" },
    { id: "moonshotai/kimi-k2-thinking", label: "Kimi K2 Thinking — reasoning" },
    { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2 Instruct — general assistant" },
    { id: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct — fast" },
  ],
  ollama: [
    { id: "qwen3:14b", label: "Qwen 3 14B — balanced (recommended)" },
    { id: "qwen3:32b", label: "Qwen 3 32B — higher capability" },
    { id: "qwen3.5:latest", label: "Qwen 3.5 — newer general model" },
    { id: "mistral:latest", label: "Mistral 7B — faster" },
    { id: "deepseek-r1:14B", label: "DeepSeek R1 14B — reasoning" },
    { id: "glm-4.7-flash:latest", label: "GLM 4.7 Flash — general assistant" },
  ],
};

export function loadProfile(): UserProfile | null {
  try { return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null"); } catch { return null; }
}

export function loadAiSettings(): AiSettings | null {
  try { return JSON.parse(sessionStorage.getItem(AI_SESSION_KEY) || "null"); } catch { return null; }
}

export async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
