import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Runs once per test file, before that file's imports. lib/server/workspace.ts
// resolves WORKSPACE_ROOT at module load, so pointing STUDY_WORKSPACE at a temp
// directory here is what keeps a test from ever touching the user's ./workspace.
const root = mkdtempSync(path.join(tmpdir(), "koi-test-"));
process.env.STUDY_WORKSPACE = root;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
