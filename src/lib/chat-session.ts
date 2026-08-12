// v2 invalidates conversations containing responses produced by the retired
// pre-source-routing assistant. Account and provider settings use other keys.
export const CHAT_SESSION_KEY = "kinomex:research-conversation:v2";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export function parseChatSession(raw: string | null): ChatMessage[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ChatMessage =>
      typeof item === "object" && item !== null &&
      ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant") &&
      typeof (item as ChatMessage).content === "string" &&
      (item as ChatMessage).content.length > 0 && (item as ChatMessage).content.length <= 8_000 &&
      ((item as ChatMessage).timestamp === undefined ||
        (typeof (item as ChatMessage).timestamp === "string" &&
          Number.isFinite(Date.parse((item as ChatMessage).timestamp!))))
    ).slice(-40);
  } catch {
    return [];
  }
}

export function saveChatSession(storage: Pick<Storage, "setItem">, messages: ChatMessage[]) {
  storage.setItem(CHAT_SESSION_KEY, JSON.stringify(messages.slice(-40)));
}
