import { NextResponse } from "next/server";
import {
  AiConfigurationError,
  normalizeLegacyOllamaModel,
  resolveAiSettings,
} from "@/lib/ai-config";
import { currentUser } from "@/lib/auth";

export async function POST() {
  const user = await currentUser();
  try {
    const settings = normalizeLegacyOllamaModel(resolveAiSettings(user));
    const base = settings.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = settings.vendor === "anthropic"
      ? { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${settings.apiKey}` };
    const response = await fetch(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          { error: "The active provider rejected its API key." },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: `The active provider returned HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const data = await response.json().catch(() => ({})) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ name?: string; model?: string }>;
    };
    const ids = [
      ...(data.data || []).map((item) => item.id),
      ...(data.models || []).map((item) => item.model || item.name),
    ].filter((id): id is string => Boolean(id));
    const selected = settings.model.toLowerCase();
    const modelAvailable = ids.some((id) => id.toLowerCase() === selected);
    if (ids.length && !modelAvailable) {
      return NextResponse.json(
        {
          error: `Connection succeeded, but model “${settings.model}” is not available.`,
          models: ids.slice(0, 30),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      message: `Connected to ${settings.vendor}; model “${settings.model}” is available.`,
    });
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const details = error instanceof Error ? error.message : String(error);
    const vendor = user?.aiSettings?.vendor || "AI";
    const message = vendor === "ollama"
      ? "Ollama is not available as a personal provider."
      : `Could not connect to ${vendor}: ${details}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
