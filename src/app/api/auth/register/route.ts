import { NextRequest, NextResponse } from "next/server";
import { createRecoveryCode, createSession, ensureAuthIndexes, normalizeUsername, passwordDigest, publicUser, recoveryCodeHash, validUsername } from "@/lib/auth";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null); const name = String(body?.name || "").trim().slice(0, 100); const username = normalizeUsername(String(body?.username || "")); const password = String(body?.password || "");
  if (!name || !validUsername(username) || password.length < 12) return NextResponse.json({ error: "Provide a name, a valid username, and a password of at least 12 characters." }, { status: 400 });
  const db = await ensureAuthIndexes(); const { hash, salt } = await passwordDigest(password);
  const recoveryCode = createRecoveryCode();
  try { const result = await db.collection("users").insertOne({ name, username, usernameNormalized: username, passwordHash: hash, passwordSalt: salt, recoveryCodeHash: recoveryCodeHash(recoveryCode), passkeys: [], createdAt: new Date(), updatedAt: new Date() }); const user = await db.collection("users").findOne({ _id: result.insertedId }); await createSession(result.insertedId); return NextResponse.json({ user: publicUser(user as never), recoveryCode }, { status: 201 }); }
  catch (error: unknown) { if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: "That username is already registered." }, { status: 409 }); throw error; }
}
