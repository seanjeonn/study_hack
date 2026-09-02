/**
 * Pure argument parsing and port selection for the `study-hack` CLI.
 *
 * Kept apart from `bin/study-hack.mjs` so the decisions are unit-testable
 * without spawning a server — the same split as `conceptRefreshCore.ts`. Plain
 * ESM rather than TypeScript because `bin/` ships to npm as-is, with no build
 * step and no bundler between it and Node.
 */

/** The first port tried, and how many consecutive ports the probe will try. */
export const DEFAULT_PORT = 3000;
export const PORT_PROBE_COUNT = 11; // 3000–3010

/** A user-facing argument error: printed as a message, never a stack trace. */
export class CliError extends Error {}

export const HELP = `study-hack — read PDFs, keep a note on every page.

Usage
  npx study-hack [options]

Options
  --workspace <dir>  Where your PDFs and notes live (default: ~/study-hack).
  --port <n>         Port to serve on (default: the first free port from 3000).
  --no-open          Do not open a browser.
  --smoke            Run the self-check (packaged server + Korean PDF) and exit.
  -v, --version      Print the version.
  -h, --help         Print this help.

Environment
  STUDY_WORKSPACE    Same as --workspace; the flag wins.
`;

/**
 * @typedef {object} CliOptions
 * @property {"serve" | "smoke" | "version" | "help"} command
 * @property {string | null} workspace  Raw path as typed; resolved by the caller.
 * @property {number | null} port       null means "probe from DEFAULT_PORT".
 * @property {boolean} open
 */

/**
 * Parse `process.argv.slice(2)`.
 *
 * Deliberately strict: an unrecognised flag is an error rather than something
 * forwarded to `next start`, so a typo in `--workspace` can never silently
 * write notes to the wrong directory.
 *
 * @param {string[]} argv
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = { command: "serve", workspace: null, port: null, open: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Accept both `--flag value` and `--flag=value`.
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq !== -1 ? arg.slice(0, eq) : arg;
    const inlineValue = arg.startsWith("--") && eq !== -1 ? arg.slice(eq + 1) : null;
    const takeValue = () => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[++i];
      if (next === undefined) throw new CliError(`${name} needs a value`);
      return next;
    };

    switch (name) {
      case "-h":
      case "--help":
        options.command = "help";
        break;
      case "-v":
      case "--version":
        options.command = "version";
        break;
      case "--smoke":
        options.command = "smoke";
        break;
      case "--no-open":
        options.open = false;
        break;
      case "--workspace": {
        const value = takeValue();
        if (!value) throw new CliError("--workspace needs a value");
        options.workspace = value;
        break;
      }
      case "--port":
        options.port = parsePort(takeValue());
        break;
      default:
        throw new CliError(`unknown option: ${arg}`);
    }
  }

  return options;
}

/**
 * @param {string} raw
 * @returns {number}
 */
export function parsePort(raw) {
  if (!/^\d+$/.test(raw)) throw new CliError(`--port must be a number, got: ${raw}`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new CliError(`--port must be 1–65535, got: ${raw}`);
  return port;
}

/**
 * Pick a port to serve on.
 *
 * An explicit `--port` is honoured as typed — if it is busy the user should
 * hear about it, not be quietly moved elsewhere. Otherwise probe upward from
 * 3000 so a second workspace in a second terminal just works.
 *
 * @param {number | null} requested
 * @param {(port: number) => Promise<boolean>} isFree
 * @returns {Promise<number>}
 */
export async function choosePort(requested, isFree) {
  if (requested !== null) return requested;
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_PROBE_COUNT; port++) {
    if (await isFree(port)) return port;
  }
  throw new CliError(
    `no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_PROBE_COUNT - 1} — pass --port`,
  );
}

/**
 * Resolve the workspace directory: the flag, then `STUDY_WORKSPACE`, then
 * `~/study-hack`.
 *
 * The home-directory default is load-bearing. `npx` runs from whatever
 * directory the user happens to be in, so a cwd-relative default would scatter
 * notes across the filesystem and lose them on the next run.
 *
 * @param {string | null} flag
 * @param {string | undefined} envValue
 * @param {string} homeDir
 * @param {(...parts: string[]) => string} resolve  Typically path.resolve, bound to cwd.
 * @returns {string}
 */
export function resolveWorkspace(flag, envValue, homeDir, resolve) {
  if (flag) return resolve(flag);
  if (envValue) return resolve(envValue);
  return resolve(homeDir, "study-hack");
}
