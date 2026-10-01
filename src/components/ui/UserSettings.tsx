"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { AI_SESSION_KEY } from "@/lib/user-ai-settings";
import AiProviderSettings, { type PublicUser } from "@/components/ui/AiProviderSettings";

type AuthMode = "login" | "register" | "forgot" | "recovery-issued";

export default function UserSettings() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState("");
  const [status, setStatus] = useState("");
  const [mounted, setMounted] = useState(false);

  const sync = async () => {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    const data = await response.json() as { user: PublicUser | null };
    setUser(data.user);
    if (data.user) {
      setName(data.user.name);
      setUsername(data.user.username);
    }
  };

  useEffect(() => {
    setMounted(true);
    void sync();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const submit = async () => {
    setStatus("");
    const authMode = mode === "register" ? "register" : "login";
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, username, password }),
    });
    const data = await response.json() as { user?: PublicUser; recoveryCode?: string; error?: string };
    if (!response.ok) {
      setStatus(data.error || "Authentication failed.");
      return;
    }
    setPassword("");
    setUser(data.user || null);
    if (data.recoveryCode) setIssuedRecoveryCode(data.recoveryCode);
    setStatus(mode === "register" ? "Account created. Save the recovery code shown below." : "Signed in.");
    await sync();
  };

  const resetPassword = async () => {
    const response = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, recoveryCode, newPassword }),
    });
    const data = await response.json() as { recoveryCode?: string; error?: string };
    if (!response.ok) {
      setStatus(data.error || "Password reset failed.");
      return;
    }
    setIssuedRecoveryCode(data.recoveryCode || "");
    setRecoveryCode("");
    setNewPassword("");
    setStatus("Password reset. All existing sessions were revoked.");
    setMode("recovery-issued");
  };

  const changePassword = async () => {
    const response = await fetch("/api/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) {
      setStatus(data.error || "Password change failed.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    sessionStorage.removeItem(AI_SESSION_KEY);
    setUser(null);
    setMode("login");
    setStatus("Password changed. For security, all sessions were revoked; sign in again.");
  };

  const rotateRecovery = async () => {
    const response = await fetch("/api/auth/recovery-code", { method: "POST" });
    const data = await response.json() as { recoveryCode?: string; error?: string };
    if (!response.ok) {
      setStatus(data.error || "Recovery code rotation failed.");
      return;
    }
    setIssuedRecoveryCode(data.recoveryCode || "");
    setStatus("A new recovery code was issued. The previous code no longer works.");
  };

  const passkeyLogin = async () => {
    try {
      const optionsResponse = await fetch("/api/auth/passkey/login/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const options = await optionsResponse.json() as { error?: string };
      if (!optionsResponse.ok) throw new Error(options.error || "Passkey options failed.");
      const assertion = await startAuthentication({ optionsJSON: options as never });
      const verify = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, response: assertion }),
      });
      const data = await verify.json() as { user?: PublicUser; error?: string };
      if (!verify.ok) throw new Error(data.error || "Passkey sign-in failed.");
      setUser(data.user || null);
      setStatus("Signed in with passkey.");
      await sync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Passkey sign-in failed.");
    }
  };

  const addPasskey = async () => {
    try {
      const optionsResponse = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const options = await optionsResponse.json() as { error?: string };
      if (!optionsResponse.ok) throw new Error(options.error || "Passkey options failed.");
      const registration = await startRegistration({ optionsJSON: options as never });
      const verify = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(registration),
      });
      const data = await verify.json() as { error?: string };
      if (!verify.ok) throw new Error(data.error || "Passkey setup failed.");
      setStatus("Passkey and biometric access enabled.");
      await sync();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Passkey setup failed.");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    sessionStorage.removeItem(AI_SESSION_KEY);
    setIssuedRecoveryCode("");
    setUser(null);
    setMode("login");
    setStatus("Signed out.");
  };

  const remove = async () => {
    if (!confirm("Permanently delete this KinomeX account and its saved settings?")) return;
    const response = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) {
      setStatus(data.error || "Account deletion failed.");
      return;
    }
    sessionStorage.removeItem(AI_SESSION_KEY);
    setUser(null);
    setPassword("");
    setStatus("Account deleted.");
  };

  const recoveryPanel = issuedRecoveryCode ? <RecoveryCode code={issuedRecoveryCode} /> : null;
  const finishRecovery = () => {
    setIssuedRecoveryCode("");
    setMode("login");
    setStatus("");
  };

  const signedOutPanel = mode === "recovery-issued" ? (
    <div>
      <h3 className="text-lg font-semibold text-white">Password reset complete</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">Save the replacement recovery code before continuing. It replaces the code you just used.</p>
      {recoveryPanel}
      <button type="button" onClick={finishRecovery} className="mt-4 w-full rounded-xl bg-kinome-cyan px-4 py-2.5 font-semibold text-slate-950">I saved the code — continue to sign in</button>
    </div>
  ) : mode === "forgot" ? (
    <div className="grid gap-3">
      <div>
        <h3 className="text-lg font-semibold text-white">Reset password</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Enter the recovery code you saved when creating the account or last rotating the code. It is used here only when you forget your password. A successful reset consumes it and issues a replacement.</p>
      </div>
      <Field label="Username" value={username} onChange={setUsername} />
      <Field label="Recovery code" value={recoveryCode} onChange={setRecoveryCode} />
      <Field label="New password (12+ characters)" type="password" value={newPassword} onChange={setNewPassword} />
      <button type="button" onClick={() => void resetPassword()} className="rounded-xl bg-kinome-cyan px-4 py-2.5 font-semibold text-slate-950">Reset password</button>
      <button type="button" onClick={() => setMode("login")} className="text-sm text-slate-400">Back to sign in</button>
    </div>
  ) : (
    <>
      <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-950/40 p-1">
        {(["login", "register"] as const).map((value) => (
          <button type="button" key={value} onClick={() => setMode(value)} className={`rounded-lg py-2 text-sm ${mode === value ? "bg-kinome-cyan/15 text-white" : "text-slate-400"}`}>
            {value === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <div className="grid gap-3">
        {mode === "register" && <Field label="Name" value={name} onChange={setName} />}
        <Field label="Username" value={username} onChange={setUsername} />
        <Field label="Password (12+ characters)" type="password" value={password} onChange={setPassword} />
        <button type="button" onClick={() => void submit()} className="rounded-xl bg-kinome-cyan px-4 py-2.5 font-semibold text-slate-950">{mode === "login" ? "Sign in" : "Create account"}</button>
        {mode === "login" && (
          <>
            <button type="button" onClick={() => void passkeyLogin()} disabled={!username} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white disabled:opacity-40">Sign in with passkey / biometric</button>
            <button type="button" onClick={() => setMode("forgot")} className="text-sm text-kinome-cyan hover:underline">Forgot password?</button>
          </>
        )}
      </div>
      {mode === "register" && recoveryPanel}
    </>
  );

  const signedInPanel = user ? (
    <>
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-white">@{user.username}</div>
          <div className="text-xs text-slate-500">Server-managed session · Cookie inaccessible to browser scripts</div>
        </div>
        <button type="button" onClick={() => void logout()} className="self-start text-sm text-slate-300 hover:text-white">Sign out</button>
      </div>
      <Field label="Display name" value={name} onChange={setName} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={async () => {
            const response = await fetch("/api/auth/session", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name }),
            });
            const data = await response.json() as { user?: PublicUser; error?: string };
            if (response.ok) {
              setUser(data.user || null);
              setStatus("Profile updated.");
            } else setStatus(data.error || "Profile update failed.");
          }}
          className="mt-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white"
        >
          Update profile
        </button>
        <button type="button" onClick={() => void addPasskey()} className="mt-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white">{user.hasPasskey ? "Add another passkey" : "Add passkey / biometric"}</button>
      </div>
      <div className="my-6 border-t border-white/10" />
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-kinome-cyan">Password & recovery</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Current password" type="password" value={currentPassword} onChange={setCurrentPassword} />
        <Field label="New password (12+ characters)" type="password" value={newPassword} onChange={setNewPassword} />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => void changePassword()} disabled={!currentPassword || newPassword.length < 12} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white disabled:opacity-40">Change password</button>
        <button type="button" onClick={() => void rotateRecovery()} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white">Generate new recovery code</button>
      </div>
      {recoveryPanel}
      <AiProviderSettings user={user} onUserRefresh={sync} />
      <div className="mt-6 rounded-2xl border border-red-400/15 bg-red-400/[.03] p-4">
        <h3 className="text-sm font-medium text-red-200">Delete account</h3>
        <p className="my-2 text-xs text-slate-500">Deletes the profile, encrypted API key, passkeys, and active sessions.</p>
        <Field label="Confirm with password" type="password" value={password} onChange={setPassword} />
        <button type="button" onClick={() => void remove()} className="mt-3 text-sm text-red-300">Permanently delete account</button>
      </div>
    </>
  ) : null;

  const dialog = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-3 py-4 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <motion.section role="dialog" aria-modal="true" aria-label="KinomeX account settings" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#0b1222] p-4 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl sm:p-6">
            <header className="sticky -top-4 z-10 mb-5 flex justify-between border-b border-white/10 bg-[#0b1222] pb-4 pt-1 sm:-top-6 sm:pt-0">
              <div className="min-w-0 pr-4">
                <h2 className="truncate text-lg font-semibold text-white sm:text-xl">{user ? `Welcome, ${user.name}` : "KinomeX account"}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">Browsing remains anonymous. Sign in only to synchronize AI settings across devices.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="h-9 w-9 shrink-0 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close account settings">✕</button>
            </header>
            {user ? signedInPanel : signedOutPanel}
            {status && <p className="mt-4 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300">{status}</p>}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ml-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-slate-800/50 text-slate-300 hover:border-kinome-cyan/40 hover:text-white" aria-label="User account and AI settings">
        <UserIcon active={Boolean(user)} />
      </button>
      {mounted && createPortal(dialog, document.body)}
    </>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-kinome-cyan/50" />
    </label>
  );
}

function RecoveryCode({ code }: { code: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const area = document.createElement("textarea");
        area.value = code;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        if (!document.execCommand("copy")) throw new Error("copy failed");
        area.remove();
      }
      setCopied("copied");
      window.setTimeout(() => setCopied("idle"), 2500);
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/[.06] p-4">
      <h4 className="text-sm font-semibold text-amber-200">Save this one-time recovery code</h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">Store it in a password manager. Each code works once; resetting the password or generating another code invalidates it.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-950/60 px-3 py-2.5 text-center text-sm tracking-wider text-white">{code}</code>
        <button type="button" onClick={() => void copy()} className={`flex min-w-24 items-center justify-center gap-1.5 rounded-xl border px-4 py-2 text-xs ${copied === "copied" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "border-amber-300/20 text-amber-100"}`}>{copied === "copied" ? "✓ Copied" : "Copy"}</button>
      </div>
      {copied === "failed" && <p role="alert" className="mt-2 text-xs text-red-300">Copy was blocked by the browser. Select the code manually and copy it.</p>}
    </div>
  );
}

function UserIcon({ active }: { active: boolean }) {
  return (
    <span className="relative">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.1a7.5 7.5 0 0 1 15 0A17.9 17.9 0 0 1 12 21.75 17.9 17.9 0 0 1 4.5 20.1Z" /></svg>
      <span className={`absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${active ? "bg-emerald-400" : "bg-slate-500"}`} />
    </span>
  );
}

