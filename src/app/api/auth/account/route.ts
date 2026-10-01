import { NextRequest, NextResponse } from "next/server";
import { clearSession, currentUser, deleteStoredAiSettings } from "@/lib/auth";
import { setKinomeXDisabled, verifyGroupPassword } from "@/lib/group-auth-db";

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!(await verifyGroupPassword(String(body?.password || ""), user.passwordHash))) {
    return NextResponse.json({ error: "Password confirmation failed" }, { status: 403 });
  }
  // The Group account is shared with other Dokhlab services, so deleting it here
  // would be unsafe. Disable only the KinomeX profile and remove its AI secret.
  await deleteStoredAiSettings(user.groupUserId);
  await setKinomeXDisabled(user.groupUserId, true);
  await clearSession();
  return NextResponse.json({ ok: true });
}
