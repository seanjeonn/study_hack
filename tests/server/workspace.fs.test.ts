import fs from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { freshWorkspace } from "@/tests/helpers/workspace";

let root: string;

beforeEach(() => {
  root = freshWorkspace();
});

/** Import after freshWorkspace() — WORKSPACE_ROOT is resolved at module load. */
const load = () => import("@/lib/server/workspace");

describe("atomicWrite", () => {
  it("creates missing parent directories", async () => {
    const { atomicWrite } = await load();
    const target = path.join(root, "deck", ".cache", "text", "page-001.txt");
    await atomicWrite(target, "hello");
    expect(await fs.readFile(target, "utf8")).toBe("hello");
  });

  it("overwrites an existing file and leaves no temp file behind", async () => {
    const { atomicWrite } = await load();
    const dir = path.join(root, "deck");
    const target = path.join(dir, "note.md");
    await atomicWrite(target, "first");
    await atomicWrite(target, "second");
    expect(await fs.readFile(target, "utf8")).toBe("second");
    // Exactly one file: the rename dance must not litter the user's directory.
    expect(await fs.readdir(dir)).toEqual(["note.md"]);
  });

  it("writes buffers as well as strings", async () => {
    const { atomicWrite } = await load();
    const target = path.join(root, "deck", "source.pdf");
    await atomicWrite(target, Buffer.from([1, 2, 3]));
    expect(await fs.readFile(target)).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("claimPdfDir", () => {
  it("suffixes on collision instead of overwriting", async () => {
    const { claimPdfDir } = await load();
    expect(await claimPdfDir("deck")).toBe("deck");
    expect(await claimPdfDir("deck")).toBe("deck-2");
    expect(await claimPdfDir("deck")).toBe("deck-3");
    expect((await fs.readdir(root)).sort()).toEqual([".gitignore", "deck", "deck-2", "deck-3"]);
  });

  it("seeds a .gitignore that excludes the app-owned cache", async () => {
    const { claimPdfDir } = await load();
    await claimPdfDir("deck");
    const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain(".cache/");
  });

  it("never overwrites a .gitignore the user already has", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, ".gitignore"), "mine\n");
    const { claimPdfDir } = await load();
    await claimPdfDir("deck");
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe("mine\n");
  });
});

describe("listPdfIds", () => {
  it("returns nothing when the workspace does not exist yet", async () => {
    rmSync(root, { recursive: true, force: true });
    const { listPdfIds } = await load();
    expect(await listPdfIds()).toEqual([]);
  });

  it("returns only directories that could be a pdf id", async () => {
    await fs.mkdir(path.join(root, "deck"), { recursive: true });
    await fs.mkdir(path.join(root, "my-notes-v2"), { recursive: true });
    await fs.mkdir(path.join(root, "concepts"), { recursive: true });
    await fs.mkdir(path.join(root, "Bad_Name"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "not a pdf");
    const { listPdfIds } = await load();
    expect((await listPdfIds()).sort()).toEqual(["deck", "my-notes-v2"]);
  });
});
