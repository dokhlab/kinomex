import { CHAT_SESSION_KEY, parseChatSession, saveChatSession } from "@/lib/chat-session";

describe("research conversation session persistence", () => {
  it("restores valid user and assistant messages", () => {
    const raw = JSON.stringify([
      { role: "user", content: "Which kinases phosphorylate GPCRs?" },
      { role: "assistant", content: "| Kinase | Evidence | References |" },
    ]);
    expect(parseChatSession(raw)).toHaveLength(2);
  });

  it("ignores malformed, empty, and unsupported messages", () => {
    expect(parseChatSession("not-json")).toEqual([]);
    expect(parseChatSession(JSON.stringify([
      { role: "system", content: "hidden" },
      { role: "user", content: "" },
      { role: "assistant", content: "valid" },
    ]))).toEqual([{ role: "assistant", content: "valid" }]);
  });

  it("stores the conversation under the session-scoped key", () => {
    const storage = { setItem: jest.fn() };
    saveChatSession(storage, [{ role: "user", content: "Question" }]);
    expect(storage.setItem).toHaveBeenCalledWith(
      CHAT_SESSION_KEY,
      JSON.stringify([{ role: "user", content: "Question" }]),
    );
  });

  it("preserves valid timestamps while accepting legacy messages", () => {
    const timestamp = "2026-08-12T15:50:00.000Z";
    expect(parseChatSession(JSON.stringify([
      { role: "user", content: "Current", timestamp },
      { role: "assistant", content: "Legacy" },
      { role: "assistant", content: "Invalid", timestamp: "not-a-date" },
    ]))).toEqual([
      { role: "user", content: "Current", timestamp },
      { role: "assistant", content: "Legacy" },
    ]);
  });
});
