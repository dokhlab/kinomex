import { NextRequest, NextResponse } from "next/server";
import { createRecoveryCode, ensureAuthIndexes, normalizeUsername, passwordDigest, recoveryCodeHash } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = normalizeUsername(String(body?.username || ""));
  const codeHash = recoveryCodeHash(String(body?.recoveryCode || ""));
  const newPassword = String(body?.newPassword || "");
  if (newPassword.length < 12) return NextResponse.json({ error: "The new password must contain at least 12 characters." }, { status: 400 });
  const db = await ensureAuthIndexes();
  const user = await db.collection("users").findOne({ usernameNormalized: username, recoveryCodeHash: codeHash });
  if (!user) return NextResponse.json({ error: "The username or recovery code is invalid." }, { status: 403 });
  const password = await passwordDigest(newPassword);
  const recoveryCode = createRecoveryCode();
  await Promise.all([
    db.collection("users").updateOne({ _id: user._id }, { $set: { passwordHash: password.hash, passwordSalt: password.salt, recoveryCodeHash: recoveryCodeHash(recoveryCode), updatedAt: new Date() } }),
    db.collection("user_sessions").deleteMany({ userId: user._id }),
  ]);
  return NextResponse.json({ ok: true, recoveryCode });
}
