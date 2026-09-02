import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  choosePort,
  CliError,
  DEFAULT_PORT,
  parseArgs,
  parsePort,
  resolveWorkspace,
} from "@/bin/cliArgs.mjs";

const resolve = (...parts: string[]) => path.resolve("/cwd", ...parts);

describe("parseArgs", () => {
  it("serves with defaults when given nothing", () => {
    expect(parseArgs([])).toEqual({ command: "serve", workspace: null, port: null, open: true });
  });

  it("takes a value as a separate argument or after an equals sign", () => {
    expect(parseArgs(["--workspace", "notes"]).workspace).toBe("notes");
    expect(parseArgs(["--workspace=notes"]).workspace).toBe("notes");
    expect(parseArgs(["--port", "4000"]).port).toBe(4000);
    expect(parseArgs(["--port=4000"]).port).toBe(4000);
  });

  it("reads the command flags", () => {
    expect(parseArgs(["--smoke"]).command).toBe("smoke");
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["-v"]).command).toBe("version");
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["--no-open"]).open).toBe(false);
  });

  it("combines flags in any order", () => {
    expect(parseArgs(["--no-open", "--port", "3005", "--workspace", "/w"])).toEqual({
      command: "serve",
      workspace: "/w",
      port: 3005,
      open: false,
    });
  });

  it("rejects an unknown flag rather than forwarding it", () => {
    // A typo'd --workspace must not fall through to the server, where it would
    // quietly write notes to the default directory instead.
    expect(() => parseArgs(["--workspac", "notes"])).toThrow(CliError);
    expect(() => parseArgs(["--workspac", "notes"])).toThrow(/unknown option/);
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["--workspace"])).toThrow(CliError);
    expect(() => parseArgs(["--workspace="])).toThrow(CliError);
    expect(() => parseArgs(["--port"])).toThrow(CliError);
  });
});

describe("parsePort", () => {
  it("accepts a plain number in range", () => {
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
  });

  it("rejects anything that is not a bare in-range integer", () => {
    for (const bad of ["", "0", "65536", "-1", "3000.5", "3000abc", "0x1"]) {
      expect(() => parsePort(bad), bad).toThrow(CliError);
    }
  });
});

describe("choosePort", () => {
  it("honours an explicit port without probing", async () => {
    const isFree = vi.fn(async () => false);
    expect(await choosePort(4321, isFree)).toBe(4321);
    // An explicit --port that is busy should fail loudly at listen time, not
    // silently move the server somewhere the user is not looking.
    expect(isFree).not.toHaveBeenCalled();
  });

  it("probes upward from the default until one is free", async () => {
    const isFree = async (port: number) => port === DEFAULT_PORT + 2;
    expect(await choosePort(null, isFree)).toBe(DEFAULT_PORT + 2);
  });

  it("gives up with a usable message when the whole range is busy", async () => {
    await expect(choosePort(null, async () => false)).rejects.toThrow(CliError);
    await expect(choosePort(null, async () => false)).rejects.toThrow(/--port/);
  });
});

describe("resolveWorkspace", () => {
  it("prefers the flag, then the env var, then ~/study-hack", () => {
    expect(resolveWorkspace("flag", "env", "/home/u", resolve)).toBe("/cwd/flag");
    expect(resolveWorkspace(null, "env", "/home/u", resolve)).toBe("/cwd/env");
    expect(resolveWorkspace(null, undefined, "/home/u", resolve)).toBe("/home/u/study-hack");
    expect(resolveWorkspace(null, "", "/home/u", resolve)).toBe("/home/u/study-hack");
  });

  it("resolves a relative path against the cwd, not the home directory", () => {
    // npx runs from wherever the user is; a relative workspace has to mean
    // *there*, and it has to be absolute before the CLI chdirs to the package.
    expect(resolveWorkspace("./notes", undefined, "/home/u", resolve)).toBe("/cwd/notes");
  });
});
