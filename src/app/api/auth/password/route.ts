import { NextRequest, NextResponse } from "next/server";
import { clearSession, currentUser } from "@/lib/auth";
import { updateGroupUserPassword, verifyGroupPassword } from "@/lib/group-auth-db";

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");
  if (newPassword.length < 12) {
    return NextResponse.json({ error: "The new password must contain at least 12 characters." }, { status: 400 });
  }
  if (!(await verifyGroupPassword(currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }
  await updateGroupUserPassword(user.groupUserId, newPassword);
  await clearSession();
  return NextResponse.json({ ok: true, signedOut: true });
}
