# study-hack beta proxy

A small `node:http` server that lets free-beta users run the AI features
without an OpenAI key of their own. It holds one OpenAI key, hands out
per-token monthly allowances, and collects the opt-in usage events and the
fake-door answers.

It is **not published** and is **not deployed by CI**. It is a separate package
inside this repo, deployed to one small VPS by hand, following the runbook
below.

## What it does, and does not

- **Four endpoints.** A chat-completions relay, a sign-in exchange, and two
  collection endpoints. No streaming, no sessions.
- **No database.** Quota is one flat JSON file per calendar month; telemetry is
  append-only JSONL. Expiring a month is `rm`; the analytics stack is `jq`.
- **The model is pinned.** Every relayed request is rewritten to `gpt-5-mini`
  whatever the client asked for. The token is in the user's hands, and `curl`
  with `"model": "gpt-5"` against a free beta would be someone else's bill.
- **The kill switch stops spending, not measuring.** `RELAY_DISABLED=1` makes
  the relay return 503 and leaves `/t/*` answering. The moment you most want to
  shut off spend is the moment you most want to know what users are doing.

CommonJS, unlike the rest of the repo: these sources are typechecked both by
the root `pnpm typecheck` (moduleResolution `bundler`) and by `tsc` here on the
way to runnable JS, and CJS is the one target where extensionless relative
imports are correct under both.

## Endpoints

### `POST /v1/chat/completions`

The OpenAI SDK's base URL points here, so it is the same request the SDK would
send to OpenAI. Requires `Authorization: Bearer sb-beta-<24 hex>`.

| Status | When                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| 401    | No token, a malformed one, or one that is unknown or revoked. Quota is untouched. |
| 503    | `RELAY_DISABLED=1`. Checked before the quota read.                                |
| 400    | `stream: true`, or a body that is not a JSON object.                              |
| 429    | Monthly allowance used up. Body carries `error.code = "beta_quota_exhausted"`.    |
| \*     | Otherwise OpenAI's own status and body, verbatim.                                 |

Every refusal is OpenAI-shaped (`{"error": {message, type, code, param}}`)
because the client is the OpenAI SDK. **`error.code` on the 429 is a
contract** — the app keys its localized "your free allowance is gone" message
off that exact string (`QUOTA_EXHAUSTED_CODE` in `lib/server/llm.ts`).

### `POST /t/event` — opt-in usage counts

Validated against `UsageEventSchema`; appended to `data/events/<YYYY-MM>.jsonl`.
Returns 204 when accepted, 400 when it does not validate. Unknown fields are
dropped rather than stored.

```json
{
  "installId": "8f1c…",
  "event": "install | session | aiUse",
  "version": "0.2.0",
  "platform": "darwin",
  "locale": "ko",
  "noteCount": 42,
  "pdfCount": 6
}
```

Counts only. Never a note, a filename, a PDF, or a key.

### `POST /t/fakedoor` — the pricing answer

Appended to `data/fakedoor.jsonl`. **Always 204**, even when the payload does
not validate: this answer arrives once per user and is the one number the
release exists to measure, so an unrecognised shape is stored raw rather than
refused.

```json
{
  "installId": "8f1c…",
  "answer": "yes | no | not_sure | dismissed",
  "price": "KRW7900",
  "locale": "ko"
}
```

### `POST /auth/exchange` — a Google identity for a beta token

`{"idToken": "…"}` in, `{"token": "sb-beta-…"}` out. This is how the app gets a
managed token without anyone typing one: it signs the user in with Google and
posts the resulting id_token here.

The signature is checked by asking Google
(`GET https://oauth2.googleapis.com/tokeninfo`) rather than by verifying a JWKS
locally — one round trip on a path used a handful of times a week, against a
key cache and a rotation policy. The **claims** are checked here, in
`verifyClaims`, which is a pure function with unit tests.

| Status | When                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 503    | `GOOGLE_CLIENT_ID` is unset. The proxy cannot tell whose tokens are whose.  |
| 400    | No `idToken` in the body.                                                   |
| 401    | Not a Google id token, expired, or minted for a different `aud`.            |
| 403    | Unverified email, an address outside `ALLOWED_EMAILS`, or the beta is full. |
| 200    | `{ token }` — the same token every time for the same Google account.        |

Issuance is keyed on Google's `sub`, not the email: an address can be renamed
and reassigned, a `sub` cannot. Rows live in `data/accounts.json`, which the
proxy writes and the operator only reads (or edits to set `"disabled": true`).

A 401 is worth retrying after signing in again; a 403 never is. The app treats
both the same way — it swallows the failure and signs the user in regardless,
because reading PDFs needs no key at all.

### `GET /health`

`{ ok, relayDisabled, tokens, accounts }`. No auth; nothing sensitive in it.

## Configuration

| Variable           | Default                     | Purpose                                                      |
| ------------------ | --------------------------- | ------------------------------------------------------------ |
| `PORT`             | `8787`                      | Listen port (behind Caddy).                                  |
| `OPENAI_API_KEY`   | —                           | The one real key. Required.                                  |
| `OPENAI_BASE_URL`  | `https://api.openai.com/v1` | Upstream. Point elsewhere to test.                           |
| `TOKENS_FILE`      | `./tokens.json`             | Beta tokens.                                                 |
| `DATA_DIR`         | `./data`                    | Quota files and JSONL sinks.                                 |
| `RELAY_DISABLED`   | unset                       | `1` turns the relay off; `/t/*` unaffected.                  |
| `GOOGLE_CLIENT_ID` | —                           | The app's OAuth client id. Unset ⇒ `/auth/exchange` is 503.  |
| `ALLOWED_EMAILS`   | —                           | Comma-separated Gmail addresses. **Empty refuses everyone.** |
| `MAX_ACCOUNTS`     | `30`                        | Cap on issued accounts. Never refuses an existing one.       |

`GOOGLE_CLIENT_ID` must be the **same** client id the app was built with
(`lib/server/googleClient.ts`), or every exchange fails the `aud` check.

## Runbook — admitting someone to the beta

Add their Gmail address to `ALLOWED_EMAILS` and restart. Nothing else: they
sign in with Google in the app and a token is minted on first sight.

```bash
sudoedit /etc/study-hack-proxy.env    # ALLOWED_EMAILS=a@gmail.com,b@gmail.com
sudo systemctl restart study-hack-proxy
curl -s localhost:8787/health          # confirm the account count
```

Removing an address stops _new_ accounts, not existing ones — their token is
already in `data/accounts.json`. Revoke that instead:

```bash
jq '.accounts |= map(if .email == "a@gmail.com" then .disabled = true else . end)' \
  data/accounts.json > data/accounts.json.new && mv data/accounts.json.new data/accounts.json
sudo systemctl restart study-hack-proxy
```

Unlike `tokens.json`, `accounts.json` is not reloaded on SIGHUP — the proxy
writes it, so it is read once at boot.

## Runbook — issuing a token by hand

Still the way in for someone without a Google account. Tokens are `sb-beta-`
plus 24 hex characters; the prefix is what tells them apart from an OpenAI key,
in the app and here. `tokens.json` is checked **before** `accounts.json`, so a
row here can raise one person's monthly limit above the default.

```bash
node -e 'console.log("sb-beta-" + require("crypto").randomBytes(12).toString("hex"))'
```

Add a row to `tokens.json` and reload without dropping a request:

```jsonc
{
  "tokens": [
    {
      "token": "sb-beta-0123456789abcdef01234567",
      "label": "jiwon, 2026-10 beta",
      "monthlyLimit": 60,
    },
    {
      "token": "sb-beta-fedcba9876543210fedcba98",
      "label": "revoked 2026-10-14",
      "disabled": true,
    },
  ],
}
```

```bash
sudo systemctl reload study-hack-proxy   # sends SIGHUP
curl -s localhost:8787/health            # confirm the new count
```

A **broken** `tokens.json` on reload is logged and ignored — the previous set
stays live, so a typo at 2am does not revoke everyone. A broken one at _boot_
refuses to start.

Revoke by setting `"disabled": true` rather than deleting the row; the label is
the only record of who had it.

## Runbook — deploying

Manual, by design: one box, one service, and no secret handed to CI.

```bash
# once, on the VPS (Ubuntu, Node 22 installed)
sudo useradd --system --home /srv/study-hack-proxy --create-home studyproxy
sudo -u studyproxy mkdir -p /srv/study-hack-proxy/data

# every deploy, from a checkout of this repo
rsync -a --delete proxy/ vps:/srv/study-hack-proxy/app/
ssh vps 'cd /srv/study-hack-proxy/app && npm install --omit=dev && npm run build'
ssh vps 'sudo systemctl restart study-hack-proxy'
ssh vps 'curl -sf localhost:8787/health'
```

Secrets live in `/etc/study-hack-proxy.env` (mode 600, owned by root), read by
the unit's `EnvironmentFile=`:

```
OPENAI_API_KEY=sk-…
```

`deploy/study-hack-proxy.service` and `deploy/Caddyfile` are the unit and the
TLS front end. Install them with:

```bash
sudo cp deploy/study-hack-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now study-hack-proxy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Once the host is real, set `PROXY_BASE_URL` in `lib/server/llm.ts` to
`https://<host>/v1` — it is a compiled-in placeholder until then.

## Runbook — turning it off

```bash
sudo systemctl set-environment RELAY_DISABLED=1   # or edit the env file
sudo systemctl restart study-hack-proxy
```

Relaying stops; `/t/event` and `/t/fakedoor` keep collecting.

## Reading the results

```bash
# the pricing answer, which is the point
jq -r '.answer.answer // "unparsed"' data/fakedoor.jsonl | sort | uniq -c

# this month's spend by token
jq . data/quota/$(date -u +%Y-%m).json

# AI generations this month
grep -c '"event":"aiUse"' data/events/$(date -u +%Y-%m).jsonl
```
