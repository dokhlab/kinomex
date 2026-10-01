import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createRecoveryCode, replacePasswordRecoveryCode } from "@/lib/group-auth-db";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const recoveryCode = createRecoveryCode();
  await replacePasswordRecoveryCode(user.groupUserId, recoveryCode);
  return NextResponse.json({ recoveryCode });
}
