# Brawler Arena

Multi-game platform on NEAR. One balance (platform contract) shared by every game.

| Path | What | Host |
|---|---|---|
| `market/` | game hub: list, wallet, deposit/withdraw | xyz.com |
| `packages/platform/` | shared TS wallet + balance hooks | - |
| `contracts/platform/` | balances, matches, bets, tournaments, per-game referee | NEAR |
| `crates/near-svc/` | rust: view, NEP-413 verify, referee tx queue | - |
| `games/brawler/client/` | brawler game (Next.js, static export) | brawler.xyz.com |
| `games/brawler/server/` | rust ws: relay, lobby, referee | ws svc |
| `games/brawler/sim/` | rust sim port, golden-tested vs TS | - |
| `games/brawler/contract/` | monster NFTs | NEAR |

Brawler: real-time 2D platform fighter, two monsters knock each other off a floating stage.

## Run

```sh
npm install && npm test && npm run build      # all TS workspaces
cargo test --workspace                         # rust sim + server
make dev                                       # backend in docker, ws :8787 (BRAWLER_PORT)
cargo run -p brawler-server                    # same, no docker
npm run dev -w @xyz/brawler                    # http://localhost:3000
npm run dev -w @xyz/market
```

- Server env: `PORT NEAR_RPC CONTRACT_ID MONSTERS_ID REFEREE_ID REFEREE_KEY`. No CONTRACT_ID = free rooms only.
- Client env (build-time): `NEXT_PUBLIC_SERVER_URL` (required in prod), `NEXT_PUBLIC_PLATFORM_ID`, `NEXT_PUBLIC_MARKET_URL`, `NEXT_PUBLIC_MONSTERS_ID`, `NEXT_PUBLIC_ASSET_URL`. Market: `NEXT_PUBLIC_BRAWLER_URL`.
- Golden vectors: `node --experimental-strip-types scripts/golden.ts` after any TS sim change, then `cargo test`.
- New game: `games/<id>/{client,server}`, `register_game(id, referee, assets?)` on platform.

## Controls

Online only: host a room, join by code, or watch from the lobby.

| | Move / aim | Jump | Light | Heavy | Block | Dodge |
|---|---|---|---|---|---|---|
| Keyboard + mouse | WASD / arrows | Space or W | Right click / Z | Left click / X | Q (hold) | C |
| Gamepad | Stick / D-pad | A | X | B / Y | | Bumpers / triggers |

Block (grounded, hold Q): hits from the front deal 1/5 damage and a small push instead of launching you; hits from behind land in full. You can't move or attack while blocking.

Hold a direction with an attack to pick the move (neutral, side or down; ground or air). Air neutral heavy is the recovery move; air down heavy is the ground pound. Hold down on a thin platform to drop through it. Press ` to show hitboxes and Esc to return to the menu.

## How it works

- **`src/lib/sim/`**: deterministic simulation at a fixed 60 Hz. It has no DOM, no randomness, no trig and no clock, so the same inputs always produce the same state.
  - **Fighter states:** idle, run, jumpsquat, air, land, dodge, attack, hitstun, block, dead.
  - **Health + damage %:** each stock has 200 HP. Damage taken lowers HP and raises knockback: (base + damage% × growth) × defence modifier.
  - **Hit timing:** hitlag freezes both fighters on impact, and hitstun scales with knockback.
  - **Stocks:** you lose one when you leave the blast zone or your HP hits 0; 3 each.
  - **Movement:** 1 ground jump plus 2 air jumps, short hop, fast-fall, and dodges with invulnerability frames and a cooldown.
  - **Input buffer:** button presses are remembered for 6 frames.
  - **Frame data:** in `moves.ts` (startup, active and recovery frames, hitbox, damage, knockback).
- **`src/lib/render/`**: a procedural bone rig. Each animation is a keyframed pose that gets tweened: wind-up, then a snap into the strike, then an ease back to rest. On top of that: a camera that zooms to fit both fighters, hit sparks, screen shake and KO beams. The renderer only reads sim state; it never changes it.
- **`src/lib/net.ts` + `games/brawler/server`**: delay-based lockstep netplay. Each client sends its input 4 frames ahead and steps the sim only when both players' inputs for that frame have arrived. The clients compare state hashes every second to detect desyncs. The relay server only pairs rooms and forwards packets.

The reference game was studied for its move set, animation phases and frame counts. No art, names or data were copied.

## Not built yet

Wall cling, weapon pickups, rollback netcode, matchmaking, wiring NFT stats in, sound.
