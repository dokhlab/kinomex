import { NextResponse } from "next/server";
import { currentUser, decryptSecret } from "@/lib/auth";

export async function POST() {
  const user = await currentUser();
  if (!user?.aiSettings) return NextResponse.json({ error: "Save AI settings before testing the connection." }, { status: 400 });
  const settings = user.aiSettings;
  const selectedModel = settings.vendor === "ollama" && settings.model.toLowerCase() === "qwen3"
    ? "qwen3:14b"
    : settings.model;
  const apiKey = decryptSecret(settings.encryptedApiKey);
  const base = settings.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = settings.vendor === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  try {
    const response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return NextResponse.json({ error: "The provider rejected the saved API key." }, { status: 401 });
      return NextResponse.json({ error: `The provider returned HTTP ${response.status}.` }, { status: 502 });
    }
    const data = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string; model?: string }> };
    const ids = [...(data.data || []).map(item => item.id), ...(data.models || []).map(item => item.model || item.name)].filter((id): id is string => Boolean(id));
    const selected = selectedModel.toLowerCase();
    // Ollama can have several sizes of the same family (for example qwen3:14b
    // and qwen3:32b). A family-only value is therefore not a safe alias.
    const modelAvailable = ids.some((id) => id.toLowerCase() === selected);
    if (ids.length && !modelAvailable) return NextResponse.json({ error: `Connection succeeded, but model “${selectedModel}” is not available.`, models: ids.slice(0, 30) }, { status: 409 });
    return NextResponse.json({ ok: true, message: `Connected to ${settings.vendor}; model “${selectedModel}” is available.` });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const message = settings.vendor === "ollama"
      ? "Ollama is not running at localhost:11434. Start the Ollama application or service, then test again."
      : `Could not connect to ${settings.vendor}: ${details}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
