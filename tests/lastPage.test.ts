import { describe, expect, it } from "vitest";
import { lastPageKey, parseLastPage } from "@/lib/lastPage";

describe("parseLastPage", () => {
  it("accepts a plain decimal page", () => {
    expect(parseLastPage("7")).toBe(7);
    expect(parseLastPage("128")).toBe(128);
  });

  it("treats anything that is not a positive integer as absent", () => {
    for (const raw of [null, "", "0", "-3", "1.5", "1e3", "abc", " 7 ", "07"]) {
      expect(parseLastPage(raw)).toBeNull();
    }
  });
});

describe("lastPageKey", () => {
  it("namespaces one key per PDF", () => {
    expect(lastPageKey("deck")).toBe("study_hack:last-page:deck");
  });
});
