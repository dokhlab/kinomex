import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createAuthChallenge } from "@/lib/group-auth-db";
import { getGroupPasskeys, getGroupUserByUsername } from "@/lib/group-auth-db";

const RP_ID = "dokhlab.org";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const user = await getGroupUserByUsername(username);
  if (!user) return NextResponse.json({ error: "No Group account was found for that username." }, { status: 404 });
  const passkeys = await getGroupPasskeys(user.id);
  if (!passkeys.length) return NextResponse.json({ error: "No passkey is registered for that account" }, { status: 404 });
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    allowCredentials: passkeys.map((passkey) => ({ id: passkey.credential_id })),
  });
  await createAuthChallenge(user.id, "login", options.challenge);
  return NextResponse.json(options);
}
