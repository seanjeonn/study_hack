/**
 * Slice 8 verification: two-account isolation + persistence.
 * Usage: pnpm --filter @study-hack/api exec tsx scripts/verify-auth.ts <sample.pdf>
 * Requires the api running on localhost:4000 (LLM endpoints are not exercised).
 */
import { readFileSync } from "node:fs";

const API = process.env.API_URL ?? "http://localhost:4000";
// better-auth enforces an Origin header on its endpoints (as a real browser
// always sends); mirror the trusted web origin so sign-up/sign-in aren't 403'd.
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const run = Date.now();

interface Ctx {
  cookie: string;
}

async function signUp(email: string): Promise<Ctx> {
  const res = await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password: "password123", name: email.split("@")[0] }),
  });
  assert(res.ok, `sign-up ${email} -> ${res.status}`);
  return { cookie: extractCookies(res) };
}

async function signIn(email: string): Promise<Ctx> {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert(res.ok, `sign-in ${email} -> ${res.status}`);
  return { cookie: extractCookies(res) };
}

function extractCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

const pdfPath = process.argv[2];
if (!pdfPath) throw new Error("usage: verify-auth.ts <sample.pdf>");
const pdfBytes = readFileSync(pdfPath);

// 1) unauthenticated -> 401
const unauth = await fetch(`${API}/pdf`);
assert(unauth.status === 401, "unauthenticated GET /pdf -> 401");

// 2) two accounts
const a = await signUp(`a-${run}@test.dev`);
const b = await signUp(`b-${run}@test.dev`);

// 3) A uploads
const form = new FormData();
form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "sample.pdf");
const up = await fetch(`${API}/pdf`, { method: "POST", body: form, headers: { cookie: a.cookie } });
assert(up.status === 201, "A upload -> 201");
const { id: pdfA } = (await up.json()) as { id: string };

// 4) isolation
const listA = (await (await fetch(`${API}/pdf`, { headers: { cookie: a.cookie } })).json()) as {
  pdfs: unknown[];
};
assert(listA.pdfs.length === 1, "A sees own document");
const listB = (await (await fetch(`${API}/pdf`, { headers: { cookie: b.cookie } })).json()) as {
  pdfs: unknown[];
};
assert(listB.pdfs.length === 0, "B sees no documents");
const bReads = await fetch(`${API}/pdf/${pdfA}`, { headers: { cookie: b.cookie } });
assert(bReads.status === 404, "B GET A's pdf -> 404 (existence hidden)");
const bMemo = await fetch(`${API}/pdf/${pdfA}/memos`, {
  method: "POST",
  headers: { cookie: b.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ content: "intrusion" }),
});
assert(bMemo.status === 404, "B POST memo on A's pdf -> 404");

// 5) memo + relogin persistence (learning record survives)
const aMemo = await fetch(`${API}/pdf/${pdfA}/memos`, {
  method: "POST",
  headers: { cookie: a.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ content: "my note", pageNumber: 1 }),
});
assert(aMemo.status === 201, "A creates memo -> 201");
const a2 = await signIn(`a-${run}@test.dev`);
const relist = (await (await fetch(`${API}/pdf`, { headers: { cookie: a2.cookie } })).json()) as {
  pdfs: unknown[];
};
assert(relist.pdfs.length === 1, "A relogin: documents persist");
const rememo = (await (
  await fetch(`${API}/pdf/${pdfA}/memos`, { headers: { cookie: a2.cookie } })
).json()) as { memos: unknown[] };
assert(rememo.memos.length === 1, "A relogin: memos persist");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall auth checks passed");
