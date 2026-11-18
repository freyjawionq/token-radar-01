// Board gate test: runs main.ts against the kit's sealed snapshot into a
// temporary output directory and validates the board.json it writes against
// the token-radar-01 gate's board rules.
//
//   node --test tests/board.test.mjs
//
// The kit snapshot path comes from RADAR_KIT_SNAPSHOT when set, else the
// level-20 kit location used to build this draft.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('..', import.meta.url));
const snapshotPath =
  process.env.RADAR_KIT_SNAPSHOT ?? '/tmp/kits-new/token-radar-01/token-radar-01-kit/input/snapshot.json';

function runProgram() {
  const out = mkdtempSync(join(tmpdir(), 'token-radar-test-'));
  try {
    execFileSync('/usr/bin/node', ['main.ts', '--input', snapshotPath], {
      cwd: repo,
      env: { ...process.env, MAKEFUN_OUTPUT_DIR: out },
      stdio: 'pipe',
    });
    return { out, board: JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')) };
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw err;
  }
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const { out, board } = runProgram();
const rows = board.rows;
test.after(() => rmSync(out, { recursive: true, force: true }));

test('board holds 100..4000 rows', () => {
  assert.ok(Array.isArray(rows), 'board.json rows is an array');
  assert.ok(rows.length >= 100 && rows.length <= 4000, `rows = ${rows.length}`);
});

test('every slug exists in the snapshot and is unique', () => {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set();
  for (const r of rows) {
    assert.ok(known.has(r.slug), `invented slug ${r.slug}`);
    assert.ok(!seen.has(r.slug), `duplicate slug ${r.slug}`);
    seen.add(r.slug);
    assert.ok(typeof r.name === 'string' && r.name.length > 0, `${r.slug} has an empty name`);
  }
});

test('ranks are exactly 1..N', () => {
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: rows.length }, (_, i) => i + 1));
});

test('implied values are positive whole dollars, capped, non-increasing by rank, not all equal', () => {
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (const r of byRank) {
    assert.ok(Number.isSafeInteger(r.implied_value_usd), `${r.slug} value not a whole number`);
    assert.ok(r.implied_value_usd > 0, `${r.slug} value not positive`);
    assert.ok(r.implied_value_usd <= 100_000_000_000_000, `${r.slug} value past the cap`);
  }
  for (let i = 1; i < byRank.length; i++) {
    assert.ok(
      byRank[i].implied_value_usd <= byRank[i - 1].implied_value_usd,
      `rank ${byRank[i].rank} outvalues rank ${byRank[i - 1].rank}`,
    );
  }
  assert.ok(byRank[0].implied_value_usd !== byRank[byRank.length - 1].implied_value_usd, 'all values equal');
});

test('every watchlist slug is on the board', () => {
  const slugs = new Set(rows.map((r) => r.slug));
  for (const slug of snapshot.watchlist) assert.ok(slugs.has(slug), `watchlist slug ${slug} missing`);
});

test('farm steps: 3..12 strings of 20..600 trimmed characters on every row', () => {
  for (const r of rows) {
    assert.ok(Array.isArray(r.farm_steps), `${r.slug} farm_steps not an array`);
    assert.ok(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, `${r.slug} has ${r.farm_steps.length} steps`);
    for (const s of r.farm_steps) {
      assert.equal(typeof s, 'string', `${r.slug} has a non-string step`);
      const t = s.trim();
      assert.ok(t.length >= 20 && t.length <= 600, `${r.slug} step of ${t.length} characters`);
    }
  }
});

test('the run also wrote the dashboard data and a dossier', () => {
  const data = readFileSync(join(out, 'data.js'), 'utf8');
  assert.ok(data.startsWith('window.BOARD_DATA='), 'data.js carries window.BOARD_DATA');
  const dossier = JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));
  assert.ok(dossier !== null && typeof dossier === 'object', 'dossier.json parses');
});
