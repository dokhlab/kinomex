import { NextRequest, NextResponse } from "next/server";
import { currentUser, ensureAuthIndexes, passwordDigest, verifyPassword } from "@/lib/auth";

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");
  if (newPassword.length < 12) return NextResponse.json({ error: "The new password must contain at least 12 characters." }, { status: 400 });
  if (!await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  const next = await passwordDigest(newPassword);
  const db = await ensureAuthIndexes();
  await db.collection("users").updateOne({ _id: user._id }, { $set: { passwordHash: next.hash, passwordSalt: next.salt, updatedAt: new Date() } });
  await db.collection("user_sessions").deleteMany({ userId: user._id, tokenHash: { $ne: "" } });
  return NextResponse.json({ ok: true, signedOut: true });
}
