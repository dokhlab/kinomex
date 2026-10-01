import { NextRequest, NextResponse } from "next/server";
import { clearSession, currentUser, publicUser } from "@/lib/auth";
import { updateGroupUserName } from "@/lib/group-auth-db";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = String(body?.name || "").trim().slice(0, 100);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  await updateGroupUserName(user.groupUserId, name);
  const updated = await currentUser();
  return NextResponse.json({ user: updated ? publicUser(updated) : null });
}
