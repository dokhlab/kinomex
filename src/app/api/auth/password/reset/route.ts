import { NextResponse } from "next/server";
import {
  consumePasswordRecoveryCode,
  createRecoveryCode,
  getGroupUserByUsername,
  replacePasswordRecoveryCode,
  updateGroupUserPassword,
} from "@/lib/group-auth-db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim().toLowerCase();
  const recoveryCode = String(body?.recoveryCode || "");
  const newPassword = String(body?.newPassword || "");
  if (newPassword.length < 12) {
    return NextResponse.json({ error: "The new password must contain at least 12 characters." }, { status: 400 });
  }
  const user = await getGroupUserByUsername(username);
  if (!user || !(await consumePasswordRecoveryCode(user.id, recoveryCode))) {
    return NextResponse.json({ error: "The username or recovery code is invalid." }, { status: 403 });
  }
  await updateGroupUserPassword(user.id, newPassword);
  const nextRecoveryCode = createRecoveryCode();
  await replacePasswordRecoveryCode(user.id, nextRecoveryCode);
  return NextResponse.json({ ok: true, recoveryCode: nextRecoveryCode });
}
