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
- [x] Deploy v2 + testnet run (v2.brawler-platform-5c8e2b.testnet, see contracts/DEPLOYMENTS.md; buy-only AMM, no sell)

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

# Gen-1 SVG character art (v2: monster-folk humanoids, weapon from tail gene)
- [x] render/parts.ts: SVG path part library (limbs, torso, skull/jaw, 4 horns, 3 tails, 3 patterns, 4 eyes)
- [x] rig.ts drawMonster -> Path2D parts, cel rim light/shadow, ink outline, blink
## Review
- npm test 30/30; no tsc errors in render/ (pre-existing refactor errors elsewhere). Variant sheet screenshot ok.

# Godot fight client at /godot (plan, not started — awaiting OK)
Goal: Godot 4 web export served at `/godot`, playing same fights as web client. Original gen-1 monster-folk art only.
Layout: project `games/brawler/godot/` -> export (single-threaded, no COOP/COEP) to `games/brawler/client/public/godot/`.
- [ ] 0. Install Godot 4.4.1 stable + web export templates to ~/.local (one-time ~1 GB download, needs OK)
- [ ] 1. Scaffold project.godot, 1280x720 stretch, web export preset (threads off), npm script `godot:build`
- [ ] 2. Port sim (sim.ts, moves.ts, stages.ts) -> GDScript. Parity test: TS dumps seeded random-input replay + per-frame state hash; `godot --headless` replays, must match every frame (keeps referee + cross-play valid)
- [ ] 3. Art: script exports parts.ts paths -> .svg files (white base, tinted per DNA via modulate); Node2D bone tree; port pose tables + poseFor/attack tweening
- [ ] 4. Stage platforms/backdrop (3 stages), camera follow/zoom, shake, hit sparks, HUD (hp, stocks)
- [ ] 5. Input: same keymap (WASD+Space/Z/X/C, arrows+numpad) + gamepads
- [ ] 6. Modes: local hot-seat; online via relay WebSocket (relay-only lockstep, `go p2p:false`; WebRTC later)
- [ ] 7. Embed contract: URL params / postMessage in (room, seat, dna x2, stage, relay URL); result postMessage out. React wallet/claims untouched
- [ ] 8. Hosting: Vite serves public/godot; `/godot` -> `/godot/` redirect; long cache on .wasm/.pck
- [ ] 9. Verify: parity test green, export builds, Chrome screenshot /godot, local match, 2-window online match vs web client
Est: ~1-2 days of sessions.

## Godot v1 progress (games/brawler/godot)
- [x] data.json from TS source (moves, stages, SVG parts, 8-fighter gen-1 roster) via tools/export-data.ts
- [x] svgpath.gd (SVG subset -> polygons), sim.gd (port of sim.ts), rig.gd (poses + cel-shaded parts), game.gd (loop, input, camera, stages, fx, HUD, menu, wallet buttons)
- [x] /godot React page + near_bridge.gd postMessage bridge (tested with stub in demo mode)
- [x] Headless: 1800 frames random demo fight, 0 runtime errors; rendered fight + menu frames checked
- [x] `npm run godot:build` (GODOT=<binary>) -> client/public/godot/game/
- [x] Web templates installed (nothreads only); export builds; /godot boots game in Chrome, in-game Connect + Create room round-trip via bridge (demo)
- [ ] Online play, TS<->GD sim parity test, real-wallet test

## Image heroes (web): cutout rig vs sprite sheet (lortor, torfen)
- [x] Cutout rig: Blender cut (games/brawler/sprites/cutout/cut.py + <hero>.json) -> client/public/chars/<hero>/cutout/; render/cutout.ts drives parts with rig.ts poses; `?p1=lortor&p2=torfen`
- [x] Verified: all poses + attack strikes (scratch gallery), demo bot fight renders
- [x] Sprite sheet (Blender mesh-deform renders, sprites/build.py, render/sheet.ts) -> client/public/chars/<hero>/sheet.*; `&style=sheet`
- [ ] User picks preferred style

## Art stages + heroes as defaults (staging)
- [x] Merge origin/main into staging (Arena.tsx conflict resolved)
- [x] Stage geometry from painted art: stages.ts + sim/src/stages.rs, golden regen, sim/server/client tests green, godot data.json re-exported
- [x] Art is default render (fight, thumbnails, backdrops); procedural fallback while loading; grove keeps procedural sky (needs platform-free bg)
- [x] Heroes from DNA (5 equal hue bands) in fights + portraits; cutout rig default; ?p1/?p2/&style=sheet debug only
- [x] Bot follows stage solids (crosses grove gap)
- [ ] Godot visuals still procedural (geometry synced only)
