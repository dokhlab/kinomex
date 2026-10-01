jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth", () => ({
  decryptSecret: (value: string) => value === "encrypted-personal-key" ? "personal-key" : "",
}));

import {
  AiConfigurationError,
  getSystemAiSummary,
  resolveAiSettings,
} from "@/lib/ai-config";

function account(overrides: Record<string, unknown> = {}) {
  return {
    groupUserId: 1,
    name: "Test User",
    username: "test-user",
    isAdmin: false,
    aiSettings: undefined,
    ...overrides,
  } as never;
}

describe("server-side AI source resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_VENDOR;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("allows an administrator to use the configured system provider", () => {
    process.env.LLM_API_KEY = "system-secret";
    process.env.LLM_MODEL = "meta/llama-3.1-8b-instruct";
    process.env.LLM_BASE_URL = "https://integrate.api.nvidia.com/v1";

    const result = resolveAiSettings(account({ isAdmin: true, aiSettings: { mode: "system" } }));
    expect(result.source).toBe("system");
    expect(result.vendor).toBe("nvidia");
    expect(result.apiKey).toBe("system-secret");
    expect(getSystemAiSummary()).toEqual({
      available: true,
      vendor: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
    });
  });

  it("rejects a system mode selected by a non-administrator", () => {
    process.env.LLM_API_KEY = "system-secret";
    process.env.LLM_MODEL = "model";

    expect(() => resolveAiSettings(account({ aiSettings: { mode: "system" } }))).toThrow(
      new AiConfigurationError("System AI is available to Group administrators only.", 403),
    );
  });

  it("uses the encrypted personal key and never falls back to the system key", () => {
    process.env.LLM_API_KEY = "system-secret";
    process.env.LLM_MODEL = "system-model";

    const result = resolveAiSettings(account({
      aiSettings: {
        mode: "personal",
        vendor: "openai",
        model: "gpt-5-mini",
        baseUrl: "https://example.invalid/attacker-controlled",
        encryptedApiKey: "encrypted-personal-key",
      },
    }));
    expect(result.source).toBe("personal");
    expect(result.apiKey).toBe("personal-key");
    expect(result.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("fails closed for anonymous users and missing personal settings", () => {
    expect(() => resolveAiSettings(null)).toThrow(
      new AiConfigurationError("Sign in and configure an AI provider before using KinomeX AI.", 401),
    );
    expect(() => resolveAiSettings(account())).toThrow(
      new AiConfigurationError("Configure an AI provider and your own API key in User & AI settings.", 409),
    );
  });
});
