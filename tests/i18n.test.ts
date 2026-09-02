import { describe, expect, it } from "vitest";
import { dictionaries, LOCALES, pickLocale, t } from "@/lib/i18n";

describe("pickLocale", () => {
  it("honours an explicit stored choice over the browser", () => {
    expect(pickLocale("ko", "en-US")).toBe("ko");
    expect(pickLocale("en", "ko-KR")).toBe("en");
  });

  it("falls back to the browser language when nothing is stored", () => {
    expect(pickLocale(null, "ko")).toBe("ko");
    expect(pickLocale(null, "ko-KR")).toBe("ko");
    expect(pickLocale(null, "ko-Kore-KR")).toBe("ko");
    expect(pickLocale(null, "en-US")).toBe("en");
    expect(pickLocale(null, undefined)).toBe("en");
  });

  it("does not treat a language that merely starts with 'ko' as Korean", () => {
    expect(pickLocale(null, "kok-IN")).toBe("en");
  });

  it("ignores a stored value that is not a locale we ship", () => {
    // The key is localStorage: another tab, an extension, or a hand edit can
    // put anything there, and it must not blank the UI.
    expect(pickLocale("de", "en-US")).toBe("en");
    expect(pickLocale("", "ko-KR")).toBe("ko");
    expect(pickLocale("null", undefined)).toBe("en");
  });
});

describe("dictionaries", () => {
  it("ships exactly the locales it declares", () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...LOCALES].sort());
  });

  it("keeps both locales at key parity", () => {
    // A missing key would render as `undefined` rather than fall back, so the
    // parity check is the whole safety net here.
    const en = Object.keys(dictionaries.en).sort();
    const ko = Object.keys(dictionaries.ko).sort();
    expect(ko).toEqual(en);
  });

  it("has no empty or untranslated string", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(t(locale))) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
    // Every Korean string should actually contain Hangul — an English string
    // copied across is the realistic way this dictionary rots.
    for (const [key, value] of Object.entries(dictionaries.ko)) {
      expect(/[가-힣]/.test(value), `ko.${key}`).toBe(true);
    }
  });
});
