import "server-only";
import { cookies } from "next/headers";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { connectToDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "kinomex_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type AccountDocument = {
  _id: ObjectId; name: string; username: string; usernameNormalized: string;
  passwordHash: string; passwordSalt: string; createdAt: Date; updatedAt: Date;
  passkeys?: Array<{ id: string; publicKey: string; counter: number; transports?: string[] }>;
  aiSettings?: { vendor: string; model: string; baseUrl: string; encryptedApiKey: string };
};

export async function ensureAuthIndexes() {
  const db = (await connectToDatabase()).connection.db!;
  await Promise.all([
    db.collection("users").createIndex({ usernameNormalized: 1 }, { unique: true }),
    db.collection("user_sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("user_sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("auth_challenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  return db;
}

export function normalizeUsername(value: string) { return value.trim().toLowerCase(); }
export function validUsername(value: string) { return /^[a-z0-9][a-z0-9_.-]{2,39}$/.test(value); }

export async function passwordDigest(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return { hash: derived.toString("hex"), salt };
}
export async function verifyPassword(password: string, hash: string, salt: string) {
  const actual = Buffer.from((await passwordDigest(password, salt)).hash, "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createRecoveryCode() {
  return Array.from({ length: 4 }, () => randomBytes(3).toString("hex").toUpperCase()).join("-");
}
export function recoveryCodeHash(code: string) {
  return createHash("sha256").update(code.replace(/\s+/g, "").toUpperCase()).digest("hex");
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createSession(userId: ObjectId) {
  const db = await ensureAuthIndexes();
  const token = randomBytes(32).toString("base64url");
  await db.collection("user_sessions").insertOne({ userId, tokenHash: tokenHash(token), createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) });
  cookies().set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MS / 1000 });
}
export async function clearSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) { const db = await ensureAuthIndexes(); await db.collection("user_sessions").deleteOne({ tokenHash: tokenHash(token) }); }
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}
export async function currentUser(): Promise<AccountDocument | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await ensureAuthIndexes();
  const session = await db.collection("user_sessions").findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return db.collection<AccountDocument>("users").findOne({ _id: session.userId });
}

function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}
export function encryptSecret(value: string) {
  if (!value) return "";
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
export function decryptSecret(value: string) {
  if (!value) return "";
  const [iv, tag, data] = value.split("."); const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function publicUser(user: AccountDocument) {
  return { id: user._id.toString(), name: user.name, username: user.username, hasPasskey: Boolean(user.passkeys?.length), aiSettings: user.aiSettings ? { vendor: user.aiSettings.vendor, model: user.aiSettings.model, baseUrl: user.aiSettings.baseUrl, hasApiKey: Boolean(user.aiSettings.encryptedApiKey) } : null };
}
