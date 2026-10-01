import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { currentUser } from "@/lib/auth";
import { addGroupPasskey, consumeAuthChallengeByValue } from "@/lib/group-auth-db";

const RP_ID = "dokhlab.org";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const response = await request.json() as RegistrationResponseJSON;
  let clientChallenge = "";
  try {
    clientChallenge = String(JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8")).challenge || "");
  } catch {
    clientChallenge = "";
  }
  const challenge = clientChallenge
    ? await consumeAuthChallengeByValue(user.groupUserId, "register", clientChallenge)
    : null;
  if (!challenge) return NextResponse.json({ error: "Passkey challenge expired" }, { status: 400 });
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: new URL(request.url).origin,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
    }
    const credential = verification.registrationInfo.credential;
    await addGroupPasskey({
      userId: user.groupUserId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      signCount: credential.counter,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("Duplicate")
      ? "This passkey is already registered."
      : "Passkey registration failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
