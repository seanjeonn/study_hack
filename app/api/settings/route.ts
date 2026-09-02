import { classifyKey } from "@/lib/apiKey";
import {
  SettingsResponseSchema,
  SettingsUpdateRequestSchema,
  type SettingsResponse,
} from "@/lib/schemas";
import { readConfig, updateConfig } from "@/lib/server/config";
import { resetClient } from "@/lib/server/llm";
import { denyIfSignedOut } from "@/lib/server/session";

/**
 * The masked view of the config. The key itself is never in this payload —
 * the form only needs to know that one is saved and what kind it is, and a key
 * that cannot be read back cannot be leaked by a screenshot or a stray log.
 */
function maskedView(): SettingsResponse {
  const config = readConfig();
  return {
    hasKey: !!config.apiKey,
    keyKind: config.apiKey ? classifyKey(config.apiKey) : null,
    telemetryOptIn: config.telemetryOptIn,
  };
}

export async function GET() {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  return Response.json(SettingsResponseSchema.parse(maskedView()));
}

/** Save the settings. Fields left out of the body keep their stored value. */
export async function PUT(request: Request) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const parsed = SettingsUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid settings" }, { status: 400 });
  }

  try {
    await updateConfig(parsed.data);
  } catch (err) {
    console.error("[settings] could not write the config:", err);
    return Response.json({ error: "could not save the settings" }, { status: 500 });
  }
  // The OpenAI client is memoized per key+endpoint, so a saved key takes
  // effect on the very next request rather than after a restart.
  resetClient();
  return Response.json(SettingsResponseSchema.parse(maskedView()));
}
