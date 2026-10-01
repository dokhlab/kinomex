import { NextResponse } from "next/server";
import { createSession, currentUser, publicUser } from "@/lib/auth";
import {
  getAuthState,
  getGroupUserByUsername,
  isGroupTotpEnabled,
  verifyGroupPassword,
} from "@/lib/group-auth-db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const user = await getGroupUserByUsername(username);
  if (!user || !(await verifyGroupPassword(password, user.password))) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  const state = await getAuthState(user.id);
  if (state.disabled) return NextResponse.json({ error: "This KinomeX account is disabled." }, { status: 403 });
  if (await isGroupTotpEnabled(user.id)) {
    return NextResponse.json(
      { error: "This Group account requires MFA. Sign in with its passkey or sign in at dokhlab.org." },
      { status: 401 },
    );
  }
  await createSession(user.id);
  const account = await currentUser();
  return NextResponse.json({ user: account ? publicUser(account) : null });
}
