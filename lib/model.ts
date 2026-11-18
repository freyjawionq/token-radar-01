// Token Radar model: turns the sealed snapshot into a ranked board of
// pre-token protocols with an implied value for each.
//
// Method (comparable-companies, from the snapshot's own figures only):
//   1. Protocols that already record a token give an observed multiple,
//      ratio = mcap_usd / tvl_usd. The multiples are grouped by category;
//      a category with at least MIN_PEERS observed multiples contributes
//      its median, otherwise the global median across all categories is
//      used (and also for protocols whose category has no token peers).
//   2. A pre-token protocol's base value is tvl_usd x its category ratio:
//      what the market currently pays, per dollar of TVL, for comparable
//      protocols that already issued a token.
//   3. A momentum factor adjusts for the last seven days: the TVL change
//      is clamped to [CHANGE_FLOOR, CHANGE_CAP] percent and scaled by
//      MOMENTUM_WEIGHT, so one hot week moves the value mildly, never
//      wildly. An unreported change counts as zero (factor exactly 1).
//   implied_value_usd = round(tvl_usd x ratio x momentum), whole dollars.
//
// The board is every watchlist slug plus the highest-TVL remaining
// pre-token protocols, TARGET_ROWS in all. Rows are ordered by implied
// value; exact ties are broken by TVL, then slug, and any value that
// would repeat the previous row's is stepped down one dollar at a time
// so the ranking is strict. No protocol name is ever special-cased.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard and the README. */
export const MODEL = {
  /** Fewest token peers with an observed multiple before a category speaks for itself. */
  minPeers: 3,
  /** Seven-day TVL change is clamped into this band, in percent. */
  changeFloor: -50,
  changeCap: 100,
  /** How much of the clamped change becomes a value factor: 1 + change/100 x weight. */
  momentumWeight: 0.35,
  /** Board size: the 40 watchlist slugs plus the strongest early finds. */
  targetRows: 140,
  /** Gate cap on one row's implied value. */
  maxValue: 100_000_000_000_000,
} as const;

export const MODEL_NAME = 'category-median multiple x 7d momentum';

/** The observed multiples: a median per category plus one global median. */
export interface RatioTable {
  byCategory: Map<string, number>;
  peers: Map<string, number>;
  globalMedian: number;
  globalPeers: number;
}

/** One ranked board row, as board.json carries it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    ratio: number;
    ratio_basis: 'category' | 'global';
    ratio_peers: number;
    momentum_factor: number;
    change_clamped_pct: number;
  };
  farm_steps: string[];
}

/** The dashboard's dataset, written to data.js as window.BOARD_DATA. */
export interface BoardData {
  as_of: string;
  floor_usd: number;
  model_name: string;
  model_constants: typeof MODEL;
  global_median_ratio: number;
  watchlist_size: number;
  board_size: number;
  rows: BoardRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token when both token identifiers are absent. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The multiples the snapshot itself offers: for every protocol that records
 * a token and reports both a market cap and a TVL, ratio = mcap / tvl.
 */
export function ratioTable(snapshot: Snapshot): RatioTable {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [ratio]);
    else list.push(ratio);
  }
  if (all.length === 0) throw new SnapshotError('snapshot holds no token protocol with both a market cap and a TVL');
  const byCategory = new Map<string, number>();
  const peers = new Map<string, number>();
  for (const [key, list] of groups) {
    peers.set(key, list.length);
    if (list.length >= MODEL.minPeers) byCategory.set(key, median(list));
  }
  return { byCategory, peers, globalMedian: median(all), globalPeers: all.length };
}

/** The multiple one protocol is priced with: its category median when the category has enough token peers, else the global median. */
export function ratioFor(p: SnapshotProtocol, table: RatioTable): { ratio: number; basis: 'category' | 'global'; peers: number } {
  const key = p.category ?? '(uncategorised)';
  const own = table.byCategory.get(key);
  if (own !== undefined) return { ratio: own, basis: 'category', peers: table.peers.get(key)! };
  return { ratio: table.globalMedian, basis: 'global', peers: table.globalPeers };
}

/** The momentum factor from a seven-day TVL change: clamped, mildly scaled, 1 when unreported. */
export function momentumFor(change7d: number | null): { factor: number; clamped: number } {
  const raw = change7d === null || !Number.isFinite(change7d) ? 0 : change7d;
  const clamped = Math.min(MODEL.changeCap, Math.max(MODEL.changeFloor, raw));
  return { factor: 1 + (clamped / 100) * MODEL.momentumWeight, clamped };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Score one pre-token protocol: the full row except its rank. */
function scoreRow(p: SnapshotProtocol, snapshot: Snapshot, table: RatioTable, onWatchlist: boolean): Omit<BoardRow, 'rank'> {
  const { ratio, basis, peers } = ratioFor(p, table);
  const { factor, clamped } = momentumFor(p.change_7d);
  const raw = p.tvl_usd * ratio * factor;
  const value = Math.min(MODEL.maxValue, Math.max(1, Math.round(raw)));
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: ageDays(snapshot.as_of, p.listed_at),
    on_watchlist: onWatchlist,
    implied_value_usd: value,
    model: {
      ratio: round4(ratio),
      ratio_basis: basis,
      ratio_peers: peers,
      momentum_factor: round4(factor),
      change_clamped_pct: clamped,
    },
    farm_steps: farmSteps(p),
  };
}

/**
 * The board: every watchlist slug, then the highest-TVL pre-token protocols
 * outside the watchlist until TARGET_ROWS rows, ranked by implied value.
 */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = ratioTable(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (const p of early) {
    if (chosen.size >= MODEL.targetRows) break;
    chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => scoreRow(p, snapshot, table, watchlist.has(p.slug)));
  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  // Strict order: a value equal to the previous row's steps down a dollar at
  // a time until it sits below it, so implied value never rises and never
  // repeats as rank ascends. Values are large; the floor guard is a formality.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied_value_usd >= scored[i - 1]!.implied_value_usd) {
      scored[i]!.implied_value_usd = Math.max(1, scored[i - 1]!.implied_value_usd - 1);
    }
  }
  return scored.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Everything the dashboard renders: the board plus the model's own statement of itself. */
export function buildData(snapshot: Snapshot, board: BoardRow[]): BoardData {
  const table = ratioTable(snapshot);
  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_name: MODEL_NAME,
    model_constants: MODEL,
    global_median_ratio: round4(table.globalMedian),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows: board,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate takes, or null: coverage, ranks, strict order, value shape, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outvalues rank ${byRank[i - 1]!.rank}`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > MODEL.maxValue) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Farm plans. Text only: steps a reader can take with the protocol's public
// product. Templates are keyed by the snapshot's category; the protocol's
// own name and chains fill them in. Nothing here calls a network or a
// protocol; it is a plan printed on a page.
// ---------------------------------------------------------------------------

type CategoryKey = 'lending' | 'dex' | 'staking' | 'bridge' | 'yield' | 'derivatives' | 'rwa' | 'cex' | 'generic';

function categoryKey(category: string | null): CategoryKey {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('swap') || c.includes('aggregator')) return 'dex';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('basis')) return 'yield';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 'derivatives';
  if (c.includes('rwa') || c.includes('real world')) return 'rwa';
  if (c.includes('cex') || c.includes('exchange')) return 'cex';
  return 'generic';
}

function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main supported chain';
}

function secondChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** A sensible starter position size from the protocol's own scale. */
function positionFor(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 1_000_000_000) return '$250';
  if (p.tvl_usd >= 250_000_000) return '$150';
  if (p.tvl_usd >= 50_000_000) return '$100';
  return '$50';
}

const CORE_ACTION: Record<CategoryKey, (p: SnapshotProtocol) => string> = {
  lending: (p) =>
    `Supply ${positionFor(p)} of a major stablecoin as collateral in ${p.name} on ${primaryChain(p)}, then borrow a small amount against it and repay once, so the wallet shows both sides of the market. Cost: the capital plus a few dollars of gas. Time: about 20 minutes.`,
  dex: (p) =>
    `Make several swaps through ${p.name} on ${primaryChain(p)} across different days, then provide ${positionFor(p)} of liquidity to one of its main pools and leave it there. Cost: swap fees plus a few dollars of gas. Time: about 20 minutes to set up.`,
  staking: (p) =>
    `Stake ${positionFor(p)} of the native staking asset through ${p.name} on ${primaryChain(p)} and keep the liquid receipt token in the same wallet. Cost: the staked capital plus a small gas fee. Time: about 10 minutes.`,
  bridge: (p) =>
    `Bridge ${positionFor(p)} of a major stablecoin to ${primaryChain(p)} through ${p.name}, then use the bridged funds in one application on the destination chain instead of bridging straight back. Cost: the bridge fee plus gas on both chains. Time: about 15 minutes.`,
  yield: (p) =>
    `Deposit ${positionFor(p)} of a major stablecoin into a ${p.name} vault on ${primaryChain(p)} and hold the vault shares in the same wallet. Cost: the deposit plus a few dollars of gas. Time: about 10 minutes.`,
  derivatives: (p) =>
    `Deposit ${positionFor(p)} of margin collateral into ${p.name} on ${primaryChain(p)} and open one small, hedged position, then close it after a day. Cost: the margin plus trading fees of a few dollars. Time: about 20 minutes.`,
  rwa: (p) =>
    `Complete the onboarding ${p.name} asks for, then subscribe ${positionFor(p)} to its yield-bearing asset on ${primaryChain(p)} and hold the position. Cost: the subscription plus any onboarding fee it states. Time: about 30 minutes with verification.`,
  cex: (p) =>
    `Open an account with ${p.name}, complete the verification it requires, and make a first spot trade of about ${positionFor(p)} so the account is active and funded. Cost: the trade plus its trading fee. Time: about 30 minutes with verification.`,
  generic: (p) =>
    `Use ${p.name}'s core product on ${primaryChain(p)} with a real position of about ${positionFor(p)}: a deposit, a stake or a trade, whichever the product is built around. Cost: the capital plus a few dollars of gas. Time: about 15 minutes.`,
};

const SECOND_ACTION: Record<CategoryKey, (p: SnapshotProtocol) => string> = {
  lending: (p) =>
    `Repeat the supply-and-borrow cycle once a week for a month, varying the amounts slightly, and vote in any governance poll ${p.name} opens to its users. Cost: a few dollars of gas a week. Time: 10 minutes a week.`,
  dex: (p) =>
    `Stake or lock the liquidity position inside ${p.name} where it offers that, and take part in one gauge or governance vote with the position's weight. Cost: a small gas fee. Time: about 10 minutes.`,
  staking: (p) =>
    `Put the receipt token to work in one partner market that accepts it, or restake it where ${p.name} offers that path, and keep both positions in the same wallet. Cost: a few dollars of gas. Time: about 15 minutes.`,
  bridge: (p) => {
    const second = secondChain(p);
    return second === null
      ? `Bridge a second, smaller amount on a later day and try the reverse route once, so the wallet has history in both directions. Cost: the bridge fee plus gas. Time: about 15 minutes.`
      : `Bridge a second amount to ${second} on a later day and use one application there too, so the wallet has genuine history on more than one destination. Cost: the bridge fee plus gas. Time: about 15 minutes.`;
  },
  yield: (p) =>
    `Add a second, smaller deposit on a later week and claim or compound any rewards the vault issues, so the position grows in more than one step. Cost: a few dollars of gas. Time: 10 minutes a week.`,
  derivatives: (p) =>
    `Trade small size on several different days rather than once, and try one other market the venue lists, keeping total risk small. Cost: trading fees of a few dollars a session. Time: 15 minutes a session.`,
  rwa: (p) =>
    `Make a second, smaller subscription on a later date and hold both positions, and read the issuer reports ${p.name} publishes for holders. Cost: the second subscription plus gas. Time: about 15 minutes.`,
  cex: (p) =>
    `Use one more of the venue's products, such as an earn or staking product, with a small amount, and keep the account active with a trade every few weeks. Cost: a small amount of capital plus trading fees. Time: 10 minutes a session.`,
  generic: (p) =>
    `Repeat the core action on a later day with a second, smaller amount, so the wallet's history spans weeks instead of a single session. Cost: a few dollars of gas. Time: about 10 minutes.`,
};

/**
 * One protocol's farm plan: five concrete steps built from its category and
 * chains. Steps are text for the reader; nothing is executed.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const key = categoryKey(p.category);
  const chain = primaryChain(p);
  const steps = [
    `Prepare a wallet you control and fund it on ${chain} with enough of the chain's gas token for a month of small transactions, keeping the seed phrase offline. Cost: the gas token you buy. Time: about 10 minutes.`,
    CORE_ACTION[key](p),
    SECOND_ACTION[key](p),
    `Keep the position open for at least four weeks and check in weekly: claim any points, rewards or receipts ${p.name} issues to active users, and never pay a third party to claim for you. Cost: a few dollars of gas a week. Time: 10 minutes a week.`,
    `Join the community and governance channels ${p.name} itself links to, note any points program, testnet or snapshot it announces, and keep a simple log of your dates, amounts and transaction hashes. Cost: nothing. Time: about 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The dashboard's data.js: the whole board as one script, no fetch, no network. */
export function dataScript(data: BoardData): string {
  return `window.BOARD_DATA=${JSON.stringify(data)};\n`;
}
