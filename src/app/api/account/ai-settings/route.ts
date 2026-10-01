import { NextRequest, NextResponse } from "next/server";
import {
  getSystemAiSummary,
  PERSONAL_VENDORS,
  VENDOR_BASE_URLS,
  type AiVendor,
} from "@/lib/ai-config";
import {
  currentUser,
  encryptSecret,
  saveStoredAiSettings,
  type AiMode,
} from "@/lib/auth";

function isVendor(value: string): value is AiVendor {
  return Object.prototype.hasOwnProperty.call(VENDOR_BASE_URLS, value);
}

function publicSettings(user: Awaited<ReturnType<typeof currentUser>>) {
  const saved = user?.aiSettings;
  if (!saved) return null;
  const mode: AiMode = saved.mode === "system" && user.isAdmin ? "system" : "personal";
  const model = saved.vendor === "ollama" && saved.model.toLowerCase() === "qwen3"
    ? "qwen3:14b"
    : saved.model;
  return {
    mode,
    vendor: saved.vendor,
    model,
    baseUrl: saved.baseUrl,
    apiKey: "",
    hasApiKey: Boolean(saved.encryptedApiKey),
  };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const canUseSystemKey = user.isAdmin;
  return NextResponse.json({
    settings: publicSettings(user),
    capabilities: {
      isAdmin: user.isAdmin,
      canUseSystemKey,
      ...(canUseSystemKey ? { system: getSystemAiSummary() } : {}),
    },
  });
}

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const vendor = String(body?.vendor || "").trim();
  const model = String(body?.model || "").trim().slice(0, 120);
  const apiKey = String(body?.apiKey || "").trim();
  const retainedKey = user.aiSettings?.vendor === vendor ? user.aiSettings.encryptedApiKey : "";

  if (!isVendor(vendor) || !model || !PERSONAL_VENDORS.includes(vendor as (typeof PERSONAL_VENDORS)[number])) {
    return NextResponse.json(
      { error: "Select a hosted provider for your personal AI configuration." },
      { status: 400 },
    );
  }
  if (!apiKey && !retainedKey) {
    return NextResponse.json({ error: "Your personal API key is required." }, { status: 400 });
  }

  await saveStoredAiSettings(user.groupUserId, {
    mode: "personal",
    vendor,
    model,
    baseUrl: VENDOR_BASE_URLS[vendor],
    encryptedApiKey: apiKey ? encryptSecret(apiKey) : retainedKey,
  });
  return NextResponse.json({ ok: true, mode: "personal" });
}
