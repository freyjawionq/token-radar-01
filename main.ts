// Token Radar entry point (Node 22, standard library only).
//
// Reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json),
// builds the ranked board with lib/model.ts, and writes the hand-in into the
// output directory (--output <dir>, else $MAKEFUN_OUTPUT_DIR, else /output):
//   board.json    the ranked board, {"source": ..., "as_of": ..., "rows": [...]}
//   data.js       the dashboard's dataset (window.BOARD_DATA), beside the page
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  written last, with buildDossier from vendor/makefun-board.ts
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildData, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --name in argv (either "--name value" or "--name=value"), or the fallback. */
function argValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const glued = args.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);

const out = argValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const board = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model built a board the gate refuses: ${issue}`);
const data = buildData(snapshot, board);

mkdirSync(out, { recursive: true });
// board.json cites the dataset it was built from: the snapshot's own
// source and as-of date ride at the top level, beside the rows.
writeFileSync(
  join(out, 'board.json'),
  `${JSON.stringify({ source: snapshot.source, as_of: snapshot.as_of, rows: board }, null, 1)}\n`,
);
writeFileSync(join(out, 'data.js'), dataScript(data));

/** Copy a directory's regular files into the output, skipping dot names; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const pageFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');

const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4 (board, detail, filtered)`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = statSync(join(out, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${bytes} bytes, past the 512 KiB cap`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} board rows\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json in ${out}\n`,
);
