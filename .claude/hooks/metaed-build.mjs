// PostToolUse hook: run the MetaEd build after a .metaed file is edited and
// block if the build reports errors or could not run at all.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Test seam: override the build command (e.g. a stub that prints JSON log lines).
// NOTE: setting this also bypasses the node_modules install check below.
const buildCmd = process.env.METAED_HOOK_BUILD_CMD || 'npm start';
const TIMEOUT_MS = 115_000; // just under the hook's 120s timeout in settings.json

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function tail(text, lines = 15) {
  return text.trim().split('\n').slice(-lines).join('\n');
}

function isInsideProject(p) {
  const rel = relative(resolve(cwd), resolve(cwd, p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// 1. Only build for .metaed edits inside the project. If the payload is missing
//    or unparseable, fall through and build anyway (fail safe).
let filePath;
try {
  const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  filePath = JSON.parse(input)?.tool_input?.file_path;
} catch {
  // no/invalid payload
}
if (typeof filePath === 'string') {
  if (!filePath.toLowerCase().endsWith('.metaed') || !isInsideProject(filePath)) {
    process.exit(0);
  }
}

const unavailable =
  'MetaEd build did not run — validation unavailable. Run `npm ci` ' +
  '(requires access to the Ed-Fi Azure Artifacts npm feed).';

// 2. Detect "build did not run". `npm start` sets LOG_LEVEL=error, so a clean
//    build can legitimately print zero JSON lines; "no JSON output" therefore
//    can't distinguish success from failure. Instead we rely on (a) the
//    metaed-console package being installed and (b) the process exit code:
//    a missing cross-env/console, a crash, or a timeout all exit non-zero.
if (!process.env.METAED_HOOK_BUILD_CMD && !existsSync(join(cwd, 'node_modules', '@edfi', 'metaed-console'))) {
  block(`${unavailable}\nnode_modules/@edfi/metaed-console is not installed.`);
}

const result = spawnSync(buildCmd, {
  cwd,
  shell: true,
  encoding: 'utf8',
  timeout: TIMEOUT_MS,
  killSignal: 'SIGKILL',
});
const output = (result.stdout || '') + (result.stderr || '');

// 3. Collect `level: "error"` entries from the JSON log lines. MetaEd's Logger
//    emits { level, message, error? | err? }; validation failures already embed
//    "<file> (<line>:<col>)" in `message`. Fall back to the raw line if there is
//    no message so a failing build is never silently dropped.
const errors = output
  .split('\n')
  .filter((line) => line.trim().startsWith('{'))
  .map((line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed.level !== 'error') return null;
      const base = parsed.message ?? line.trim();
      const detail = parsed.error ?? parsed.err;
      return detail ? `${base}\n  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : base;
    } catch {
      return null; // not JSON
    }
  })
  .filter(Boolean);

if (errors.length > 0) {
  block('MetaEd build errors:\n' + errors.join('\n'));
}

if (result.error || result.status !== 0) {
  const why =
    result.error?.code === 'ETIMEDOUT'
      ? `timed out after ${TIMEOUT_MS / 1000}s`
      : result.error
        ? result.error.message
        : result.signal
          ? `killed by ${result.signal}`
          : `exit code ${result.status}`;
  // The package is installed (or overridden), so this is a failed run, not a missing install.
  block(`MetaEd build failed: \`${buildCmd}\` ${why}. Output tail:\n${tail(output) || '(no output)'}`);
}

process.exit(0);
