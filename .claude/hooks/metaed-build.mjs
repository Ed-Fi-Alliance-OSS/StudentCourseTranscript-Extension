// Stop hook: when Claude finishes a turn, run the MetaEd build if .metaed files
// have uncommitted changes that have not been built yet, and block if the build
// reports errors or could not run at all (Claude then keeps working to fix them).
//
// The set of uncommitted .metaed changes is fingerprinted (paths + contents) and
// remembered after each completed build, so an unchanged dirty tree is neither
// rebuilt nor re-blocked on later turns.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Test seam: override the build command (e.g. a stub that prints JSON log lines).
// It runs through a shell. NOTE: setting this also bypasses the node_modules
// install check below.
const buildCmd = process.env.METAED_HOOK_BUILD_CMD;
const TIMEOUT_MS = 115_000; // just under the hook's 120s timeout in settings.json
// Where the last-built fingerprint is kept: outside the repo, one file per project.
// METAED_HOOK_STATE_FILE overrides the location (used by tests).
const stateFile =
  process.env.METAED_HOOK_STATE_FILE ||
  join(tmpdir(), `metaed-build-hook-${createHash('sha1').update(cwd).digest('hex').slice(0, 12)}.json`);

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function tail(text, lines = 15) {
  return text.trim().split('\n').slice(-lines).join('\n');
}

// 1. Read the hook payload. If it is missing or unparseable, carry on (fail safe).
let input = {};
try {
  const raw = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object') input = parsed;
} catch {
  // no/invalid payload
}

// Stop hooks set stop_hook_active when Claude is already continuing because of a
// previous block. Do not build again, or a persistent error would loop forever.
if (input.stop_hook_active === true) process.exit(0);

// 2. Only build when .metaed files have uncommitted changes that differ from the
//    state last built. This also covers edits made through Bash. If git itself
//    fails, build anyway (fail safe).
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '*.metaed'], {
  cwd,
  encoding: 'utf8',
});
const gitOk = !status.error && status.status === 0;
if (gitOk && status.stdout.trim() === '') {
  process.exit(0);
}

// Fingerprint = the status lines plus the contents of each changed file.
function fingerprint() {
  const hash = createHash('sha256');
  for (const line of status.stdout.split('\n').filter(Boolean)) {
    hash.update(line + '\0');
    const file = line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '');
    try {
      hash.update(readFileSync(join(cwd, file)));
    } catch {
      hash.update('<unreadable>'); // deleted or oddly quoted path
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}
const currentFingerprint = gitOk ? fingerprint() : null;

function lastFingerprint() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')).fingerprint ?? null;
  } catch {
    return null;
  }
}
function rememberFingerprint() {
  if (!currentFingerprint) return;
  try {
    writeFileSync(stateFile, JSON.stringify({ fingerprint: currentFingerprint }));
  } catch {
    // state is an optimization only
  }
}

if (currentFingerprint && currentFingerprint === lastFingerprint()) process.exit(0);

const unavailable =
  'MetaEd build did not run — validation unavailable. Run `npm ci` ' +
  '(requires access to the Ed-Fi Azure Artifacts npm feed).';

// 3. Detect "build did not run". A clean build can legitimately print zero JSON
//    lines (LOG_LEVEL=error), so "no JSON output" can't distinguish success from
//    failure. Instead we rely on (a) the metaed-console package being installed
//    and (b) the process exit code: a crash or a timeout exits non-zero.
if (!buildCmd && !existsSync(join(cwd, 'node_modules', '@edfi', 'metaed-console'))) {
  block(`${unavailable}\nnode_modules/@edfi/metaed-console is not installed.`);
}

const commonOptions = {
  cwd,
  env: { ...process.env, NODE_NO_WARNINGS: '1', LOG_LEVEL: 'error' },
  encoding: 'utf8',
  timeout: TIMEOUT_MS,
  killSignal: 'SIGKILL',
};
// No shell: node is invoked directly with the same arguments as the package.json start script.
const result = buildCmd
  ? spawnSync(buildCmd, { ...commonOptions, shell: true })
  : spawnSync(
      process.execPath,
      [
        '--no-deprecation',
        'node_modules/@edfi/metaed-console/dist/index.js',
        '-c',
        './metaed-config.json',
        '-a',
      ],
      commonOptions,
    );
const output = (result.stdout || '') + (result.stderr || '');

// 4. Collect `level: "error"` entries from the JSON log lines. MetaEd's Logger
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

// A build that ran to completion (clean or with reported errors) is remembered so
// the same uncommitted state is not built or blocked again. Timeouts and crashes
// are not remembered, so they are retried.
if (errors.length > 0 || (!result.error && result.status === 0)) rememberFingerprint();

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
  block(`MetaEd build failed (${why}). Output tail:\n${tail(output) || '(no output)'}`);
}

process.exit(0);
