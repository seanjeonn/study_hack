import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Runs once per test file, before that file's imports. lib/server/workspace.ts
// resolves WORKSPACE_ROOT at module load, so pointing STUDY_WORKSPACE at a temp
// directory here is what keeps a test from ever touching the user's ./workspace.
const root = mkdtempSync(path.join(tmpdir(), "koi-test-"));
process.env.STUDY_WORKSPACE = root;

// Same deal for lib/server/config.ts, and it matters more: without this a
// developer with a real key in ~/.study-hack/config.json would see the
// "no key configured" tests pass on their machine and fail in CI — or worse,
// a test run would overwrite their own settings.
const configDir = mkdtempSync(path.join(tmpdir(), "koi-config-"));
process.env.STUDY_CONFIG_DIR = configDir;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});
