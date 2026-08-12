import { NextResponse } from "next/server";
import { createRecoveryCode, currentUser, ensureAuthIndexes, recoveryCodeHash } from "@/lib/auth";
export async function POST() { const user = await currentUser(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); const recoveryCode = createRecoveryCode(); const db = await ensureAuthIndexes(); await db.collection("users").updateOne({ _id: user._id }, { $set: { recoveryCodeHash: recoveryCodeHash(recoveryCode), updatedAt: new Date() } }); return NextResponse.json({ recoveryCode }); }
