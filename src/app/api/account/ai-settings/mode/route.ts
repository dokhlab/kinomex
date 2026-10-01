import { NextRequest, NextResponse } from "next/server";
import { getSystemAiSummary } from "@/lib/ai-config";
import { currentUser, saveStoredAiSettings, type AiMode } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  const mode = body?.mode;
  if (mode !== "personal" && mode !== "system") {
    return NextResponse.json({ error: "Invalid AI source" }, { status: 400 });
  }

  if (mode === "system") {
    // This authorization check is deliberately server-side and runs again on
    // every mode change. publicUser().isAdmin is never trusted here.
    if (!user.isAdmin) {
      return NextResponse.json(
        { error: "System AI is available to Group administrators only." },
        { status: 403 },
      );
    }
    const system = getSystemAiSummary();
    if (!system.available || !system.vendor || !system.model) {
      return NextResponse.json(
        { error: "The Dokhlab system AI provider is not configured." },
        { status: 503 },
      );
    }
  }

  const saved = user.aiSettings;
  if (saved) {
    await saveStoredAiSettings(user.groupUserId, { ...saved, mode: mode as AiMode });
  } else if (mode === "system") {
    const system = getSystemAiSummary();
    if (!system.vendor || !system.model) {
      return NextResponse.json(
        { error: "The Dokhlab system AI provider is not configured." },
        { status: 503 },
      );
    }
    await saveStoredAiSettings(user.groupUserId, {
      mode: "system",
      // These fields are placeholders for the personal configuration. The
      // resolver ignores them while system mode is active.
      vendor: "openai",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1",
      encryptedApiKey: "",
    });
  }

  return NextResponse.json({ ok: true, mode });
}
