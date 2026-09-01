import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

/**
 * Point STUDY_WORKSPACE at an empty temp directory and drop the module cache,
 * so the next import of `lib/server/*` recomputes WORKSPACE_ROOT against it.
 *
 * IMPORTANT: WORKSPACE_ROOT is resolved at module load, so every module under
 * test must be dynamically imported AFTER this call — a top-level
 * `import { atomicWrite } from "@/lib/server/workspace"` would already be bound
 * to the setup file's workspace, not this one.
 */
export function freshWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "koi-case-"));
  process.env.STUDY_WORKSPACE = root;
  vi.resetModules();
  return root;
}

/**
 * The same trick for `lib/server/config.ts`, whose CONFIG_DIR is likewise
 * resolved at module load. Import the module under test after calling this.
 */
export function freshConfigDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "koi-config-case-"));
  process.env.STUDY_CONFIG_DIR = dir;
  vi.resetModules();
  return dir;
}
