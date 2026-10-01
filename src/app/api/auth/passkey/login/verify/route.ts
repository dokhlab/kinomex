import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createSession, currentUser, publicUser } from "@/lib/auth";
import {
  consumeAuthChallengeByValue,
  getGroupPasskey,
  getGroupUserByUsername,
  updateGroupPasskeyCounter,
} from "@/lib/group-auth-db";

const RP_ID = "dokhlab.org";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    username?: string;
    response?: AuthenticationResponseJSON;
  } | null;
  const user = await getGroupUserByUsername(String(body?.username || "").trim());
  const credential = body?.response;
  if (!user || !credential) {
    return NextResponse.json({ error: "Invalid passkey request" }, { status: 400 });
  }
  const passkey = await getGroupPasskey(user.id, credential.id);
  if (!passkey) return NextResponse.json({ error: "Passkey account was not found" }, { status: 400 });
  let clientChallenge = "";
  try {
    clientChallenge = String(JSON.parse(Buffer.from(credential.response.clientDataJSON, "base64url").toString("utf8")).challenge || "");
  } catch {
    clientChallenge = "";
  }
  const challenge = clientChallenge
    ? await consumeAuthChallengeByValue(user.id, "login", clientChallenge)
    : null;
  if (!challenge) {
    return NextResponse.json({ error: "Invalid or expired passkey request" }, { status: 400 });
  }
  try {
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: new URL(request.url).origin,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, "base64url")),
        counter: Number(passkey.sign_count || 0),
      },
      requireUserVerification: true,
    });
    if (!verification.verified) {
      return NextResponse.json({ error: "Passkey verification failed" }, { status: 401 });
    }
    await updateGroupPasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);
    await createSession(user.id);
    const account = await currentUser();
    return NextResponse.json({ user: account ? publicUser(account) : null });
  } catch {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 401 });
  }
}
