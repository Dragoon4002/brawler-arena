# brawler_arena base battle

- [x] Scaffold Vite + TS + Canvas2D
- [x] Deterministic sim (states, moves, hits, KO, stocks) + node:test suite
- [x] Bone rig + poses + FX + HUD + camera
- [x] Input (2 keyboard sets + gamepads, tap latch)
- [x] Lockstep netplay + ws relay + menu
- [x] README

## Review
- `npm test` 7/7, `tsc --noEmit` clean, `vite build` ok.
- Headless Chrome: local match renders, attacks/swoosh/hitboxes visible.
- Two-browser online match 15 s random inputs: no desync, same stocks both sides.
- KO thresholds (dummy, side/top KO): sHeavy ~120% center / ~70% edge, nHeavy ~120%, dHeavy ~150-190%.
- Next: NFT stats → `Stats`/`Look`, rollback if latency hurts, deploy relay.

# Perp betting cards (plan: ~/.claude/plans/parallel-popping-peach.md)
- [x] Contract: AMM buy/sell, house seed, positions, history, claim/refund, views
- [x] Contract tests (conservation settle A/B/refund, slippage, guards, history cap, failed sell)
- [x] near.ts + demo.ts API
- [x] Watch: FighterCard x2 + PriceChart, Claims -> positions
- [x] CSS: canvas + cards column / phone stack
- [x] tsc, npm test, demo screenshots + playwright flow
- [ ] Deploy v2 (ask first) + testnet run

## Review (perp)
- cargo test 28/28 (conservation settle A / B / refund within 100 yocto dust, slippage, guards, history cap, failed sell -> owed), wasm builds, 0 warnings.
- tsc clean, npm test 22/22.
- Demo 1280x800 + 390x844: cards match sketch, chart splits green/red at even line, HUD clear, phone stage sticky.
- Playwright: max/min/empty validation msgs, Long/Short/Close msgs on clicked card.
- draw.ts canvas now fits parent (ResizeObserver) so watch column doesn't overlap.
- Pending: deploy v2 + fund treasury + referee FC key + testnet run (needs user OK).

# Economy: NFTs, provenance, market, breeding, rentals, seasons + tournaments (spec: tasks/economy-spec.md)
- [x] W1 monsters contract (opus)
- [x] W1 arena: monster hooks + tournaments (opus)
- [x] W1 data layer near.ts/nft.ts/demo (sonnet)
- [x] W1 referee/relay: chain DNA, per-seat KOs, tournament rooms (sonnet)
- [x] W2 UI screens (sonnet)
- [x] W3 review (opus) + cargo test x2, tsc, npm test, demo check
- [x] Review fixes: random void advance, lock lengths 5h/72h + 24h entry window, owed map, O(1) season end, tournament-only season wins, NEP-413 seat auth, 5 min no-show forfeit
- [x] Deploy monsters + arena v3 to testnet (seed 1 NEAR, treasury 4 NEAR); smoke: hatch, create+cancel lock/unlock ok

## Review (economy)
- arena cargo test 46/46, monsters 44/44, both wasm 0 warnings. tsc clean, npm test 30/30, vite build ok, server boots.
- Demo screenshots of all new routes at 1280x800 + 390x844 (scratchpad).
- Not tested: real wallet signing, live cross-contract calls, end-to-end tournament on testnet.
- Known/deferred: relay reconnect mid-match; bettable 0-stake spam drains treasury seed (pre-existing); random_seed bias by block producers (testnet ok).

# Multi-game refactor (plan v2, not started)

## Target layout (grouped per game)
```
market/                 # xyz.com vite app: game list, wallet, balance, deposit/withdraw
games/brawler/
  client/               # vite app (current src/) -> brawler.xyz.com
  server/               # rust ws svc: relay + lobby + referee
  sim/                  # rust crate: sim port + genes, no near deps
  contract/             # monsters NFT contract (from contracts/monsters)
packages/platform/      # ts: wallet hooks, platform contract calls, balance hook. used by market + every client
crates/near-svc/        # rust: near-api wrapper: view, NEP-413 verify, per-match referee tx queue. reused by every game server
contracts/platform/     # arena generalized
Cargo.toml              # workspace: games/*/server, games/*/sim, crates/*. contracts excluded (wasm toolchain)
package.json            # npm workspaces: market, games/*/client, packages/*
```

## Phases
- [ ] P1 move: git mv into layout, no logic change. tests + builds green.
- [ ] P2 platform contract (from arena):
  - deposit/withdraw/balance_of; stake/bet/entry fee debit balance, payouts credit it
  - Match/Tournament get `game`; `register_game(game, referee, assets: Option<AccountId>)` owner only
  - assets contract = current ext_monsters iface (lock -> Dna, unlock, record_result, add_title), per game instead of global
  - port + extend tests (conservation w/ balances); fresh testnet deploy
- [ ] P3 rust sim + golden test:
  - sim crate: port sim.ts/moves.ts/stages.ts; genes from monsters genes.rs (split near derive out, contract re-exports)
  - scripts/golden.ts dumps per-frame fighter fields for N seeded tapes -> games/brawler/sim/testdata/golden.json
  - cargo test: bit-exact every frame
  - traps: JS Math.round (half -> +inf) != f64::round, use (x+0.5).floor(); `|0`/Math.imul/>>> -> i32/u32 wrapping ops; client hash() stays TS-only
- [ ] P4 rust brawler server (tokio + axum ws): same protocol as server/relay.ts. referee via crates/near-svc. delete server/.
- [ ] P5 market app + packages/platform; brawler client reads balance from it, deposit links to xyz.com.
- [ ] P6 deploy: market + brawler client static (vercel), brawler server -> ws.brawler.xyz.com.
- [ ] comments caveman-trimmed per file as moved.

## Design calls
- Unified payment = balance in platform contract. one source of truth, no sync/custody. ponytail: no off-chain payment svc until fiat/offchain credits.
- One platform contract; new game = register_game + rust server (+ optional assets contract w/ same 4 methods).
- Subdomains: each origin = own wallet connect (near-connect localStorage per origin). accepted cost.
- Rust over Go: NEAR has no official Go SDK (community, stale); official rust `near-api` crate covers view, signed fn calls, NEP-413 verify. reuse genes.rs. one backend lang w/ contracts.
