import { HealthResponseSchema, type HealthResponse } from "@study-hack/shared";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function getApiHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    // Validate the inbound payload at the boundary before trusting it.
    return HealthResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getApiHealth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        study_hack
      </h1>
      <section className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 dark:border-white/15 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          API health
        </h2>
        {health ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-zinc-500">status</dt>
            <dd className="font-mono text-emerald-600 dark:text-emerald-400">{health.status}</dd>
            <dt className="text-zinc-500">service</dt>
            <dd className="font-mono">{health.service}</dd>
            <dt className="text-zinc-500">time</dt>
            <dd className="font-mono">{health.time}</dd>
          </dl>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            API unreachable — start it with <code className="font-mono">pnpm dev:api</code>.
          </p>
        )}
      </section>
    </main>
  );
}
