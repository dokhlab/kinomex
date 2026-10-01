import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { currentUser } from "@/lib/auth";
import { createAuthChallenge, getGroupPasskeys } from "@/lib/group-auth-db";

const RP_ID = "dokhlab.org";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const passkeys = await getGroupPasskeys(user.groupUserId);
  const options = await generateRegistrationOptions({
    rpName: "Dokhlab",
    rpID: RP_ID,
    userName: user.username,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(String(user.groupUserId)),
    attestationType: "none",
    excludeCredentials: passkeys.map((passkey) => ({ id: passkey.credential_id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  await createAuthChallenge(user.groupUserId, "register", options.challenge);
  return NextResponse.json(options);
}
