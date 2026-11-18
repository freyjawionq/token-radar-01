# Token Radar — token-radar-01 entry (INITIAL DRAFT)

A token launch radar for make.fun's token-radar-01 bounty: it reads the
sealed DefiLlama snapshot, ranks pre-token protocols by an implied token
value, and hands in an offline dashboard with a farm plan for every row.

**Status: initial draft, pending team review** (JEMBOER → MUSE →
kontolchina gate). Not submitted. Deadline: 14 Dec 2026 10:00 UTC.

## The model

Implied value is a comparable-companies estimate built only from the
snapshot's own figures — no protocol name is ever special-cased:

1. **Observed multiples.** For every protocol that already records a token
   and reports both figures, `ratio = mcap_usd / tvl_usd`. Ratios are
   grouped by the snapshot's `category`; a category with at least 3 such
   peers contributes its **median** ratio. Categories thinner than that —
   and protocols in them — fall back to the **global median** across all
   categories (0.205x on this snapshot, from 129 observed multiples).
2. **Base value.** `base = tvl_usd x ratio` for the protocol's category.
3. **Momentum.** The 7-day TVL change is clamped to [-50%, +100%] and
   scaled mildly: `momentum = 1 + clamped/100 x 0.35` (range 0.825–1.35).
   An unreported change counts as zero (factor exactly 1).
4. **Implied value.** `implied_value_usd = round(tvl_usd x ratio x
   momentum)`, whole dollars, at least $1, at most $100,000,000,000,000.

**Board composition.** Every one of the 40 watchlist slugs, plus the
highest-TVL remaining pre-token protocols (both `gecko_id` and `symbol`
null) up to 140 rows. Rows sort by implied value descending; exact ties
break by TVL, then slug; a value that would repeat the previous row's is
stepped down $1 at a time so the ranking is strict.

**Fill exclusion (tokenized representations).** The fill — never the
watchlist — skips products that are tokenized representations of another
asset: their TVL is backing for a token that already exists, not a
protocol awaiting one. The rule reads only the snapshot's own fields
(`isTokenizedRepresentation` in `lib/model.ts`); no slug is listed and no
rank or value is consulted. An entry is excluded when any of these holds:

- its category is a bridge category (`Bridge`, `Canonical Bridge`,
  `Cross Chain Bridge`) — a bridge entry's TVL is collateral locked
  against wrapped copies of other chains' assets;
- its category is a liquid receipt or representation category (`Liquid
  Staking`, `Liquid Restaking`, `Stablecoin Wrapper`, `Anchor BTC`,
  `Restaked BTC`, `Decentralized BTC`) — the product is defined by the
  liquid token it issues against staked, restaked or wrapped assets;
- its name or slug carries the word `wrapped` or `staked`, whatever its
  category.

`Staking Pool` and `Restaking` entries stay eligible: they operate
staking infrastructure and record no liquid receipt token as their
product. On this snapshot the rule excludes 92 of the 302 fill
candidates (WBTC, USDT0 and Binance staked ETH among them) and the fill
takes the next eligible protocols instead; all 40 watchlist rows stay,
including any that match the pattern.

**Dataset citation.** `board.json` carries the snapshot's `source` and
`as_of` at the top level beside the rows, and the dashboard masthead
cites the same dataset source and as-of date from `data.js`.

**Farm plans.** Five text steps per row, templated from the protocol's
category (lending, DEX, staking, bridge, yield, derivatives, RWA, CEX,
generic) and its chains: wallet preparation, the core product action, a
second/recurring action, a four-week hold with weekly check-ins, and
community/governance tracking. Each step states a cost and a time. The
plans are guidance printed on the page — the program never interacts with
any protocol or network.

## Layout

- `main.ts` — entry point: reads the snapshot, writes `/output/board.json`,
  `data.js` (window.BOARD_DATA), copies `dashboard/` and `screenshots/`,
  and writes `dossier.json` via the vendored library.
- `lib/model.ts` — snapshot parsing, the ratio table, scoring, farm plans,
  and the board self-check (`boardIssue`).
- `vendor/makefun-board.ts` — the kit's dossier library, byte-identical to
  the kit's starter copy (sha256
  9ca51b6e5cd84fe46cb0efa61e2ea99365a1fb0e21f2b75e6007f977f0dc326e).
- `dashboard/` — offline page: ranked table with search, category and
  chain filters, sortable columns, and a detail view per protocol showing
  its farm plan and the exact model inputs behind its value.
- `screenshots/` — board, detail (Bittensor dTAO) and filtered (Dexs)
  views, rendered locally with a headless browser at 1280x900.
- `tests/board.test.mjs` — runs the program against the kit snapshot and
  validates the board against the gate's rules.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
node --test tests/board.test.mjs   # set RADAR_KIT_SNAPSHOT to relocate the kit
```

Node 22.18+ (type stripping), standard library only. Two runs of the
program write identical bytes.

## Remaining tasks

- Team review gate (JEMBOER → MUSE → kontolchina) before any submission;
  no submission is authorized by this draft.
- The gate's fill question is answered in this fix round: the fill now
  excludes tokenized representations of another asset under the
  documented, rule-based classifier above (watchlist exempt). The fix
  itself still goes through the same team review gate before any
  submission.
- Consider whether the model should also state an age/maturity term (the
  snapshot's `listed_at`) — the current formula is the assigned design
  (category multiple x momentum) and states age only as a displayed fact.
- Re-render screenshots if the dashboard changes; keep each under the
  512 KiB cap and the dossier under 1.5 MiB.
