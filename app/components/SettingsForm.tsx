"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/app/components/useLocale";
import { t } from "@/lib/i18n";
import { SettingsResponseSchema, type SettingsResponse } from "@/lib/schemas";

/**
 * The settings form: an API key and the telemetry opt-in.
 *
 * The key is write-only from the browser's side — `GET /api/settings` returns
 * whether one is saved and what kind it is, never the key itself — so the
 * input starts empty every time and an empty submit means "leave it alone",
 * not "clear it". Clearing is its own button.
 */
export default function SettingsForm() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const strings = t(useLocale());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        // Validate the inbound payload at the boundary before trusting it.
        const parsed = SettingsResponseSchema.parse(await res.json());
        if (active) setSettings(parsed);
      } catch {
        // Leave the form blank; saving still works.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save(patch: { apiKey?: string; telemetryOptIn?: boolean }) {
    setPending(true);
    setSaved(false);
    setError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setSettings(SettingsResponseSchema.parse(await res.json()));
      setKeyInput("");
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  const keyKindLabel =
    settings?.keyKind === "beta"
      ? strings.keyKindBeta
      : settings?.keyKind === "openai"
        ? strings.keyKindOpenai
        : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-normal tracking-tight">{strings.settingsTitle}</h1>
        <p className="text-sm text-[#5a5852]">{strings.settingsIntro}</p>
      </header>

      <form
        className="flex flex-col gap-5 rounded-xl border border-[#e6e5e0] bg-white p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (keyInput.trim()) void save({ apiKey: keyInput.trim() });
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="apiKey" className="text-sm font-medium text-[#26251e]">
            {strings.apiKeyLabel}
          </label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder={strings.apiKeyPlaceholder}
            className="h-11 rounded-md border border-[#cfcdc4] bg-white px-4 font-mono text-sm text-[#26251e] placeholder:text-[#a09c92]"
          />
          <p className="text-xs text-[#807d72]">{strings.apiKeyHint}</p>
          <p className="text-xs text-[#5a5852]">
            {settings?.hasKey ? (
              <>
                {strings.apiKeySet}
                {keyKindLabel ? (
                  <span className="ml-2 rounded-full bg-[#e6e5e0] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#26251e]">
                    {keyKindLabel}
                  </span>
                ) : null}
              </>
            ) : (
              strings.apiKeyMissing
            )}
          </p>
        </div>

        <label className="flex items-start gap-3 border-t border-[#e6e5e0] pt-5">
          <input
            type="checkbox"
            checked={settings?.telemetryOptIn ?? false}
            disabled={pending || !settings}
            onChange={(event) => void save({ telemetryOptIn: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[#f54e00]"
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[#26251e]">{strings.telemetryLabel}</span>
            <span className="text-xs text-[#807d72]">{strings.telemetryHint}</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={pending || !keyInput.trim()}
            className="rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? strings.saving : strings.save}
          </button>
          {settings?.hasKey ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void save({ apiKey: "" })}
              className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {strings.clearKey}
            </button>
          ) : null}
          {saved ? <p className="text-sm text-[#1f8a65]">{strings.saved}</p> : null}
          {error ? <p className="text-sm text-[#cf2d56]">{strings.saveFailed}</p> : null}
        </div>
      </form>
    </>
  );
}
