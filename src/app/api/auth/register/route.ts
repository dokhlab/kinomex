import { NextResponse } from "next/server";
import { createSession, currentUser, publicUser } from "@/lib/auth";
import { createGroupUser, createRecoveryCode, replacePasswordRecoveryCode } from "@/lib/group-auth-db";

function validUsername(value: string) {
  return /^[a-z0-9][a-z0-9_.-]{2,19}$/.test(value);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = String(body?.name || "").trim().slice(0, 100);
  const username = String(body?.username || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!name || !validUsername(username) || password.length < 12) {
    return NextResponse.json(
      { error: "Provide a name, a valid username, and a password of at least 12 characters." },
      { status: 400 },
    );
  }
  const user = await createGroupUser({ name, username, password });
  if (!user) return NextResponse.json({ error: "That username is already registered." }, { status: 409 });
  const recoveryCode = createRecoveryCode();
  await replacePasswordRecoveryCode(user.id, recoveryCode);
  await createSession(user.id);
  const account = await currentUser();
  return NextResponse.json({ user: account ? publicUser(account) : null, recoveryCode }, { status: 201 });
}
