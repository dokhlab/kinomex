import "server-only";

import { cookies } from "next/headers";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { connectToDatabase } from "@/lib/mongodb";
import {
  getAuthState,
  getGroupPasskeys,
  getGroupUserById,
  isGroupAdmin,
  type GroupPasskeyRow,
} from "@/lib/group-auth-db";

export const SESSION_COOKIE = "kinomex_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type AiMode = "personal" | "system";

export type AiSettingsDocument = {
  mode?: AiMode;
  vendor: string;
  model: string;
  baseUrl: string;
  encryptedApiKey: string;
};

export type AccountDocument = {
  _id: string;
  groupUserId: number;
  name: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: Date;
  updatedAt: Date;
  passkeys: GroupPasskeyRow[];
  isAdmin: boolean;
  aiSettings?: AiSettingsDocument;
};

type SessionPayload = {
  version: 1;
  userId: number;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return createHash("sha256").update(secret).digest();
}

function sessionSecret() {
  return encryptionKey();
}

function encodeSession(payload: SessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeSession(value: string): SessionPayload | null {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (
      payload.version !== 1 ||
      !Number.isInteger(payload.userId) ||
      !Number.isInteger(payload.epoch) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function getAiSettingsCollection() {
  const connection = await connectToDatabase();
  const db = connection.connection.db;
  if (!db) throw new Error("KinomeX MongoDB is not available");
  const collection = db.collection<AiSettingsDocument & { groupUserId: number }>("user_ai_settings");
  await collection.createIndex({ groupUserId: 1 }, { unique: true });
  return collection;
}

export async function getStoredAiSettings(groupUserId: number) {
  const collection = await getAiSettingsCollection();
  return collection.findOne({ groupUserId });
}

export async function saveStoredAiSettings(groupUserId: number, settings: AiSettingsDocument) {
  const collection = await getAiSettingsCollection();
  await collection.updateOne(
    { groupUserId },
    { $set: { ...settings, groupUserId, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function deleteStoredAiSettings(groupUserId: number) {
  const collection = await getAiSettingsCollection();
  await collection.deleteOne({ groupUserId });
}

async function accountFromGroupUser(userId: number): Promise<AccountDocument | null> {
  const row = await getGroupUserById(userId);
  if (!row) return null;
  const passkeys = await getGroupPasskeys(userId);
  const aiSettings = await getStoredAiSettings(userId);
  const admin = await isGroupAdmin(row);
  const displayName =
    row.name?.trim() ||
    [row.firstname, row.lastname].filter((part): part is string => Boolean(part?.trim())).join(" ") ||
    row.username;
  return {
    _id: `group:${row.id}`,
    groupUserId: row.id,
    name: displayName,
    username: row.username,
    usernameNormalized: row.username.trim().toLowerCase(),
    passwordHash: row.password,
    passwordSalt: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    passkeys,
    isAdmin: admin,
    aiSettings: aiSettings
      ? {
          mode: aiSettings.mode,
          vendor: aiSettings.vendor,
          model: aiSettings.model,
          baseUrl: aiSettings.baseUrl,
          encryptedApiKey: aiSettings.encryptedApiKey,
        }
      : undefined,
  };
}

export async function createSession(userId: number) {
  const state = await getAuthState(userId);
  if (state.disabled) throw new Error("This KinomeX account is disabled.");
  const now = Date.now();
  const token = encodeSession({
    version: 1,
    userId,
    epoch: Number(state.session_epoch || 0),
    issuedAt: now,
    expiresAt: now + SESSION_MS,
    nonce: randomBytes(16).toString("base64url"),
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function currentUser(): Promise<AccountDocument | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = decodeSession(token);
  if (!payload) return null;
  const state = await getAuthState(payload.userId);
  if (state.disabled || Number(state.session_epoch || 0) !== payload.epoch) return null;
  return accountFromGroupUser(payload.userId);
}

export function encryptSecret(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  if (!value) return "";
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) return "";
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function publicUser(user: AccountDocument) {
  return {
    id: String(user.groupUserId),
    name: user.name,
    username: user.username,
    hasPasskey: user.passkeys.length > 0,
    isAdmin: user.isAdmin,
    aiSettings: user.aiSettings
      ? {
          mode: user.aiSettings.mode || "personal",
          vendor: user.aiSettings.vendor,
          model: user.aiSettings.model,
          baseUrl: user.aiSettings.baseUrl,
          hasApiKey: Boolean(user.aiSettings.encryptedApiKey),
        }
      : null,
  };
}
