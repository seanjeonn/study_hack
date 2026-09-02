import http from "node:http";
import { AccountStore } from "./accounts";
import { fetchTokenInfo, parseAllowedEmails, verifyClaims } from "./googleToken";
import { QuotaStore } from "./quota";
import { errorBody, MAX_BODY_BYTES, relay } from "./relay";
import { MAX_EVENT_BYTES, TelemetryStore } from "./telemetryStore";
import { TokenStore } from "./tokens";

/**
 * The whole proxy: four endpoints on `node:http`.
 *
 * No framework. There are four routes, no middleware stack, no streaming and
 * no sessions — a router would be more code than the routes.
 */

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const TOKENS_FILE = process.env.TOKENS_FILE ?? "./tokens.json";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/**
 * The kill switch.
 *
 * It stops the relay — the part that spends money — and nothing else. The
 * telemetry endpoints keep answering, because the point of a beta is the
 * measurement, and the moment you most want to shut off spend is the moment
 * you most want to know what users are doing.
 */
const RELAY_DISABLED = process.env.RELAY_DISABLED === "1";

/** The app's Google OAuth client id. Empty turns `/auth/exchange` off entirely. */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";

/**
 * Who may be issued a managed token.
 *
 * An allowlist rather than "anyone with a Google account", because the relay
 * spends real money on one prepaid key and this is a beta for a known handful
 * of people. Empty refuses everyone, which is the right default for a list
 * whose whole purpose is to be short.
 */
const ALLOWED_EMAILS = parseAllowedEmails(process.env.ALLOWED_EMAILS);

/** A second bound, on the count rather than the names. */
const MAX_ACCOUNTS = Number(process.env.MAX_ACCOUNTS ?? 30);

const tokens = new TokenStore(TOKENS_FILE);
const accounts = new AccountStore(DATA_DIR);
const quota = new QuotaStore(DATA_DIR);
const telemetry = new TelemetryStore(DATA_DIR);

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Read a JSON body, refusing anything over `limit` before it is buffered. */
async function readJson(req: http.IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new Error("body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Forward a chat completion to OpenAI with the server's own key. */
async function forwardToOpenAI(body: Record<string, unknown>) {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = errorBody("upstream returned a non-JSON response", "api_error");
  }
  return { status: res.status, body: parsed };
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((err) => {
    console.error("[proxy] unhandled:", err);
    if (!res.headersSent) send(res, 500, errorBody("internal error", "api_error"));
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /health") {
    return send(res, 200, {
      ok: true,
      relayDisabled: RELAY_DISABLED,
      tokens: tokens.size,
      accounts: accounts.size,
    });
  }

  // Sign-in's server half: a Google identity in, this account's beta token
  // out. Idempotent per Google account — the app calls it on every sign-in,
  // including the ones that follow a proxy outage.
  if (route === "POST /auth/exchange") {
    if (!GOOGLE_CLIENT_ID) {
      return send(res, 503, { error: "this proxy has no Google client configured" });
    }
    let body: unknown;
    try {
      body = await readJson(req, MAX_EVENT_BYTES);
    } catch {
      return send(res, 400, { error: "could not read the request body" });
    }
    const idToken = (body as { idToken?: unknown } | undefined)?.idToken;
    if (typeof idToken !== "string" || idToken === "") {
      return send(res, 400, { error: "expected an idToken" });
    }

    // Google checks the signature; we check the claims and the policy.
    const payload = await fetchTokenInfo(idToken);
    const claims = verifyClaims(payload, {
      clientId: GOOGLE_CLIENT_ID,
      allowedEmails: ALLOWED_EMAILS,
      maxAccounts: MAX_ACCOUNTS,
      accountCount: accounts.size,
      isKnownAccount:
        typeof payload === "object" && payload !== null && "sub" in payload
          ? accounts.has(String((payload as { sub: unknown }).sub))
          : false,
      now: Math.floor(Date.now() / 1000),
    });
    if (!claims.ok) {
      return send(res, claims.status, { error: claims.message });
    }

    const account = await accounts.getOrCreate(claims.sub, claims.email);
    console.info(`[auth] issued to ${account.email}`);
    return send(res, 200, { token: account.token });
  }

  if (route === "POST /v1/chat/completions") {
    let body: unknown;
    try {
      body = await readJson(req, MAX_BODY_BYTES);
    } catch {
      return send(res, 400, errorBody("could not read the request body", "invalid_request_error"));
    }
    const result = await relay(
      { authorization: req.headers.authorization, body },
      {
        disabled: RELAY_DISABLED,
        // The operator's hand-issued tokens win, so a row in tokens.json can
        // still raise one account's limit above the default.
        getToken: (token) => tokens.get(token) ?? accounts.get(token),
        checkQuota: (token, limit) => quota.checkAndIncrement(token, limit),
        forward: forwardToOpenAI,
      },
    );
    return send(res, result.status, result.body);
  }

  // Collection survives every scenario the relay does not: no auth, no quota,
  // unaffected by the kill switch.
  if (route === "POST /t/event") {
    let body: unknown;
    try {
      body = await readJson(req, MAX_EVENT_BYTES);
    } catch {
      return send(res, 400, { error: "bad event" });
    }
    const { ok } = await telemetry.recordEvent(body);
    res.writeHead(ok ? 204 : 400).end();
    return;
  }

  if (route === "POST /t/fakedoor") {
    let body: unknown;
    try {
      body = await readJson(req, MAX_EVENT_BYTES);
    } catch {
      body = { unreadable: true };
    }
    // Always 204. This answer arrives once per user and is the one number the
    // release exists to measure — never refuse it over a schema.
    await telemetry.recordFakeDoor(body);
    res.writeHead(204).end();
    return;
  }

  send(res, 404, errorBody("not found", "invalid_request_error"));
}

tokens.loadOrThrow();
process.on("SIGHUP", () => tokens.reload());

// Listening waits on the accounts file: a request that arrived first would see
// an empty store and mint a second token for an account that already has one.
void accounts.load().then(() => {
  server.listen(PORT, () => {
    console.info(
      `[proxy] listening on :${PORT} · data=${DATA_DIR} · relay=${RELAY_DISABLED ? "DISABLED" : "on"}`,
    );
    if (!OPENAI_API_KEY) console.warn("[proxy] OPENAI_API_KEY is empty — every relay will fail");
    if (!GOOGLE_CLIENT_ID) console.warn("[proxy] GOOGLE_CLIENT_ID is empty — sign-in cannot issue");
    else if (ALLOWED_EMAILS.length === 0) {
      console.warn("[proxy] ALLOWED_EMAILS is empty — every sign-in will be refused");
    }
  });
});
