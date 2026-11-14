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
