"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "1";

export default function LoginPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in → leave the login page.
  useEffect(() => {
    if (!sessionPending && session) router.replace("/");
  }, [session, sessionPending, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({ email, password, name })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Authentication failed");
        return;
      }
      router.push("/");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    await authClient.signIn.social({ provider: "google", callbackURL: "/" });
  }

  const isSignup = mode === "signup";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        study_hack
      </h1>
      <section className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 dark:border-white/15 dark:bg-zinc-900">
        <h2 className="mb-1 text-lg font-semibold text-black dark:text-zinc-50">
          {isSignup ? "Create account" : "Sign in"}
        </h2>
        <p className="mb-5 text-sm text-zinc-500">
          {isSignup
            ? "Set up an account to keep your documents in sync."
            : "Welcome back. Sign in to continue."}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {isSignup ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black placeholder:text-zinc-400 focus:border-[#f54e00] focus:outline-none dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-50"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black placeholder:text-zinc-400 focus:border-[#f54e00] focus:outline-none dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isSignup ? "new-password" : "current-password"}
              className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black placeholder:text-zinc-400 focus:border-[#f54e00] focus:outline-none dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </label>

          {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full rounded-md bg-[#f54e00] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? isSignup
                ? "Creating account…"
                : "Signing in…"
              : isSignup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        {GOOGLE_ENABLED ? (
          <button
            type="button"
            onClick={() => void handleGoogle()}
            className="mt-3 w-full rounded-md border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            Continue with Google
          </button>
        ) : null}

        <p className="mt-5 text-center text-sm text-zinc-500">
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(isSignup ? "signin" : "signup");
              setError(null);
            }}
            className="font-medium text-[#f54e00] hover:underline"
          >
            {isSignup ? "Sign in" : "Create account"}
          </button>
        </p>
      </section>
    </main>
  );
}
