/**
 * Two dictionaries and a locale guess — no i18n library.
 *
 * Deliberately narrow: this covers only the strings added for the validation
 * release (settings, the AI error states, the pricing question). The rest of
 * the app is still English-only, and translating it is out of scope. At two
 * locales and this many keys, a library would be more machinery than message.
 *
 * Safe to import from client components: no node-only code.
 */
export const LOCALE_KEY = "study_hack:locale";

export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export interface Strings {
  // Settings
  settingsTitle: string;
  settingsIntro: string;
  apiKeyLabel: string;
  apiKeyHint: string;
  apiKeyPlaceholder: string;
  apiKeySet: string;
  apiKeyMissing: string;
  keyKindOpenai: string;
  keyKindBeta: string;
  clearKey: string;
  telemetryLabel: string;
  telemetryHint: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;

  // Sign-in
  signInTitle: string;
  signInBody: string;
  signInButton: string;
  signInWaiting: string;
  signInUnavailable: string;
  signedInAs: string;
  signOut: string;

  // AI error states
  noKeyAction: string;
  quotaExhausted: string;
  aiNotConnected: string;

  // The pricing question
  fakeDoorTitle: string;
  fakeDoorBody: string;
  fakeDoorYes: string;
  fakeDoorNotSure: string;
  fakeDoorNo: string;
  fakeDoorThanks: string;
}

const en: Strings = {
  settingsTitle: "Settings",
  settingsIntro:
    "Stored in ~/.study-hack/config.json, outside your workspace — so a key never lands in a folder you sync or commit.",
  apiKeyLabel: "API key",
  apiKeyHint:
    "An OpenAI key (sk-…) or a study-hack beta token (sb-beta-…). Takes effect immediately — no restart.",
  apiKeyPlaceholder: "sk-… or sb-beta-…",
  apiKeySet: "A key is saved.",
  apiKeyMissing: "No key saved. Reading, paging, and your own notes work without one.",
  keyKindOpenai: "OpenAI key",
  keyKindBeta: "Beta token",
  clearKey: "Remove the saved key",
  telemetryLabel: "Share anonymous usage counts",
  telemetryHint:
    "Off by default. When on, sends how many notes and AI generations you have — never your notes, PDFs, or key.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  saveFailed: "Could not save the settings.",

  signInTitle: "Sign in to study_hack",
  signInBody:
    "Your PDFs and notes stay on this computer. Google is only how the app knows which beta account you are, so the managed AI works without a key of your own.",
  signInButton: "Sign in with Google",
  signInWaiting: "Waiting for the browser tab you just opened…",
  signInUnavailable:
    "This build has no Google sign-in configured yet, so there is no way in from here. A build with the OAuth client set is on the way.",
  signedInAs: "Signed in as",
  signOut: "Sign out",

  noKeyAction: "Add one in Settings",
  quotaExhausted: "This month's free beta quota is used up. It resets on the 1st.",
  aiNotConnected: "AI is not connected to this account.",

  fakeDoorTitle: "Would you pay for this?",
  fakeDoorBody:
    "AI notes and the concept map cost real money to run. If they were ₩7,900 a month, with no key to set up, would you pay for it?",
  fakeDoorYes: "Yes, I'd pay",
  fakeDoorNotSure: "Not sure",
  fakeDoorNo: "No",
  fakeDoorThanks: "Thanks — that's the whole question.",
};

const ko: Strings = {
  settingsTitle: "설정",
  settingsIntro:
    "~/.study-hack/config.json에 저장됩니다. 워크스페이스 밖이라 동기화하거나 커밋하는 폴더에 키가 들어가지 않습니다.",
  apiKeyLabel: "API 키",
  apiKeyHint:
    "OpenAI 키(sk-…) 또는 study-hack 베타 토큰(sb-beta-…). 저장하면 재시작 없이 바로 적용됩니다.",
  apiKeyPlaceholder: "sk-… 또는 sb-beta-…",
  apiKeySet: "키가 저장되어 있습니다.",
  apiKeyMissing: "저장된 키가 없습니다. 읽기·페이지 이동·내 노트는 키 없이도 됩니다.",
  keyKindOpenai: "OpenAI 키",
  keyKindBeta: "베타 토큰",
  clearKey: "저장된 키 삭제",
  telemetryLabel: "익명 사용 통계 보내기",
  telemetryHint:
    "기본값은 꺼짐입니다. 켜면 노트 수와 AI 생성 횟수만 보냅니다. 노트 내용·PDF·키는 보내지 않습니다.",
  save: "저장",
  saving: "저장 중…",
  saved: "저장했습니다.",
  saveFailed: "설정을 저장하지 못했습니다.",

  signInTitle: "study_hack 로그인",
  signInBody:
    "PDF와 노트는 이 컴퓨터에 그대로 있습니다. 구글 로그인은 어떤 베타 계정인지 확인하는 용도라서, 직접 키를 넣지 않아도 관리형 AI를 쓸 수 있습니다.",
  signInButton: "구글로 로그인",
  signInWaiting: "방금 열린 브라우저 탭에서 로그인을 기다리는 중…",
  signInUnavailable:
    "이 빌드에는 구글 로그인이 아직 설정되어 있지 않아 여기서는 들어갈 수 없습니다. OAuth 클라이언트가 설정된 빌드가 곧 나옵니다.",
  signedInAs: "로그인 계정",
  signOut: "로그아웃",

  noKeyAction: "설정에서 키 추가하기",
  quotaExhausted: "이번 달 무료 베타 사용량을 다 썼습니다. 매월 1일에 초기화됩니다.",
  aiNotConnected: "이 계정에는 AI가 연결되어 있지 않습니다.",

  fakeDoorTitle: "돈을 낼 만한가요?",
  fakeDoorBody:
    "AI 노트와 개념 지도는 실제로 비용이 듭니다. 키 설정 없이 월 7,900원이라면, 결제하실 생각이 있나요?",
  fakeDoorYes: "네, 낼게요",
  fakeDoorNotSure: "잘 모르겠어요",
  fakeDoorNo: "아니요",
  fakeDoorThanks: "감사합니다. 이게 질문의 전부입니다.",
};

export const dictionaries: Record<Locale, Strings> = { en, ko };

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ko";
}

/**
 * Decide which dictionary to use.
 *
 * An explicit stored choice always wins. Otherwise any Korean browser locale
 * (`ko`, `ko-KR`, `ko-Kore-KR`) gets Korean; everything else gets English,
 * because English is the only other dictionary that exists.
 */
export function pickLocale(stored: string | null, browserLanguage: string | undefined): Locale {
  if (isLocale(stored)) return stored;
  if (browserLanguage && /^ko(-|$)/i.test(browserLanguage)) return "ko";
  return "en";
}

/** The active locale in the browser. Storage failures degrade to English. */
export function readLocale(): Locale {
  try {
    return pickLocale(window.localStorage.getItem(LOCALE_KEY), window.navigator.language);
  } catch {
    // Storage can be disabled entirely — that is not an error state here.
    return "en";
  }
}

/** The dictionary for a locale. */
export function t(locale: Locale): Strings {
  return dictionaries[locale];
}
