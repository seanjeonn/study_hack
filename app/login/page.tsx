import { redirect } from "next/navigation";
import SignInPanel from "@/app/components/SignInPanel";
import { isGoogleClientConfigured } from "@/lib/server/googleClient";
import { readSession } from "@/lib/server/session";

/**
 * The only page outside the gate. Already signed in, it gets out of the way —
 * otherwise a stale bookmark would strand someone on a login screen they have
 * already passed.
 */
export default async function LoginPage() {
  if (await readSession()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <SignInPanel configured={isGoogleClientConfigured()} />
      </div>
    </main>
  );
}
