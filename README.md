# Brawler Arena

**A real-time monster fighting game on NEAR where every staked match, spectator bet and tournament settles on-chain, and every result is provably replayable.**

- **Play now:** https://65-0-237-185.sslip.io (Practice vs bot needs no wallet; online rooms need a NEAR testnet wallet)
- **Demo video:** _coming soon_
- **Network:** NEAR testnet

## What it is

Two monsters knock each other off a floating stage (3 stocks, damage %, blocks, dodges). Host a room, stake NEAR, and the winner takes the pot. Spectators trade a live prediction market on the fight. Monsters are NFTs whose DNA sets their stats; you can breed, rent and sell them. No opponent? Press "Call bot" in your room and a bot joins.

## Contracts (testnet)

| Contract | Account | What it does |
|---|---|---|
| Platform | [`v2.brawler-platform-5c8e2b.testnet`](https://testnet.nearblocks.io/address/v2.brawler-platform-5c8e2b.testnet) | balances, staked matches, spectator market, tournaments, per-game referee |
| Monsters | [`brawler-monsters-5c8e2b.testnet`](https://testnet.nearblocks.io/address/brawler-monsters-5c8e2b.testnet) | monster NFTs: hatch, breed, list/buy, rent, match locks |
| Referee | [`referee.v2.brawler-platform-5c8e2b.testnet`](https://testnet.nearblocks.io/address/referee.v2.brawler-platform-5c8e2b.testnet) | the game server's key; only it can report results |

Deploy and end-to-end transaction log: [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md).

## What's on-chain

| On-chain | Off-chain |
|---|---|
| Deposits, withdrawals, in-contract balance | Live fight inputs (WebRTC P2P, or WebSocket relay) |
| Match stakes, escrow, payout (`create_match`, `join_match`, `report_result`) | Room lobby, chat, matchmaking |
| Guest refund before the fight (`unjoin`), voids and expiry | Rendering, sound |
| Spectator prediction market: AMM prices, `buy`, `claim` | Full input tapes (served at `/tape/<id>`) |
| SHA-256 hash of every settled match's input tape (`tape_hash`) | Free friendly matches |
| Tournaments: entry, bracket advance, `claim_tournament` | |
| Monster NFTs, DNA, breeding, sales, rentals, lock during a match | |

## How we use NEAR

- **Escrow without trust:** stakes and bets live in the platform contract. The game server can only call `report_result` through its referee key; it never holds funds.
- **Provable fairness:** the sim is deterministic. The referee re-simulates both players' inputs, reports the winner and the tape's SHA-256 on-chain. Anyone can open `/replay/<id>`: the browser re-runs the tape, recomputes the hash and checks both against the contract.
- **Prediction markets per fight:** each bettable match opens an AMM market seeded by the house treasury, on staked and free rooms alike; the seed comes back at settle.
- **NFT gameplay assets:** monster stats come from on-chain DNA, and the NFT is locked while it fights, so it can't be sold mid-match.
- **What moves with a monster on transfer:** the NFT carries its DNA, record, titles and fight history; the new owner gets all of it. A monster that is locked in a match or rented out can't be transferred, listed or bred, so the seller can't sell it mid-fight or while a renter holds it. A transfer clears any sale listing and rent offer, so the old owner can't collect on it afterwards. In-contract sales pay 5% royalty to the breeder (gen > 0) and 2.5% to the treasury (`games/brawler/contract/README.md`).
- **One balance across games:** the platform registers games with their own referee; Brawler is the first.
- **Wallet only when money moves:** Practice vs bot and watching need no wallet.

## Features

- Practice vs bot, no wallet, keyboard / gamepad / touch.
- Online rooms: public or private, free or staked, spectators, chat, rematch.
- Rollback netcode (P2P with relay fallback); reconnect to a fight within 30 s.
- Live spectator market with price chart.
- Tournaments (4/8 players), leaderboard by wins and NEAR won, player profiles and match history with replays.
- Monsters: hatch starters, breed, sell, rent.
- Bots: press "Call bot" in a free room and a bot joins, marked with a "bot" chip (`agents/`).

## Try it (judges)

1. Open https://65-0-237-185.sslip.io and press "Practice vs bot". You fight a bot right away, no wallet needed.
2. Connect a NEAR testnet wallet and host a free room, then press "Call bot" and a bot joins. For a staked room, join as the guest from a second browser with another wallet (bots only play free rooms). The stake moves into the platform contract (`create_match` / `join_match`).
3. Open the lobby in another browser and watch the room. Buy a side in the live prediction market and watch the AMM price chart move.
4. Finish the fight. The referee calls `report_result`, the pot goes to the winner's in-contract balance, and spectators `claim`.
5. Open `/replay/<match id>`. Your browser re-runs the input tape, recomputes its SHA-256 and checks both the hash and the winner against the contract.
6. Go to Monsters: hatch starters, breed two of them, list one for sale or rent. Each one's record and titles update on-chain after it fights.

## Hackathon

Built at NEAR HACKATHON (2026-11-01 to 2026-11-14). The first commit is 2026-11-11; all code was written during the hackathon. There is no pre-hackathon baseline and no other project by the same team.

| Track | What fits |
|---|---|
| `games` | Player-owned markets (monster sales and rentals, a prediction market per fight), staked matches, tournaments; AMM prices move with demand, no dev patch. |
| `nfts` | NEP-171/177/181 monsters with dynamic on-chain state (DNA, win/loss record, titles, fight history), breeder royalties on resale, rentals, and a lock while the monster fights. |
| `open` | Provably fair real-time fights: a deterministic sim plus the on-chain tape hash, re-checkable in any browser. |

NEP-245 skill tokens (`games/brawler/contract/src/skills.rs`) are written and unit-tested, but they are not deployed to the testnet monsters contract.

### Built with

- **NEAR:** `near-sdk`, `near-contract-standards` (NEP-171/177/181), `near-api` (Rust), `near-api-js`, `@hot-labs/near-connect` + `near-connect-hooks` (wallet, NEP-413 sign-in).
- **Client:** Next.js, React. Market app: Next.js, Tailwind, bun.
- **Server:** Rust `axum`, `tokio`, `tokio-tungstenite`, `serde`.
- **Tooling:** Godot (experimental port in `games/brawler/godot/`), Remotion (moveset video), Blender + Python (sprites), Terraform, Ansible, Docker, Caddy.
- **AI:** most code was written with Claude Code (Anthropic) as the coding agent, under human direction and review.
- No game templates or boilerplate were used.

## Repo

| Path | What |
|---|---|
| `games/brawler/client/` | game client (Next.js) |
| `games/brawler/server/` | Rust WebSocket server: relay, lobby, referee, tapes, history |
| `games/brawler/sim/` | Rust port of the sim, golden-tested against the TS sim |
| `games/brawler/contract/` | monster NFT contract |
| `contracts/platform/` | platform contract |
| `crates/near-svc/` | Rust NEAR RPC, NEP-413 verify, referee tx queue |
| `packages/platform/` | shared TS wallet + balance hooks |
| `agents/` | bot service |
| `market/` | skill + monster marketplace (Next.js + Tailwind, bun) |
| `infra/` | Terraform, Ansible, Docker, Caddy |

## Run

```sh
npm install && npm test && npm run build      # all TS workspaces
cargo test --workspace                         # rust sim + server
make dev                                       # backend in docker, ws :8787 (BRAWLER_PORT)
cargo run -p brawler-server                    # same, no docker
npm run dev -w @xyz/brawler                    # http://localhost:3000
cd market && bun install && bun dev           # market, http://localhost:3000 (?demo for mock data)
```

- Server env: `PORT NEAR_RPC CONTRACT_ID MONSTERS_ID REFEREE_ID REFEREE_KEY`. No CONTRACT_ID = free rooms only.
- Room lobby: a staked guest who leaves before the host presses Start frees the seat; referee `unjoin` refunds their stake and reopens the match (rejected once bets exist).
- Client env (build-time): `NEXT_PUBLIC_SERVER_URL` (default: same origin), `NEXT_PUBLIC_PLATFORM_ID`, `NEXT_PUBLIC_MARKET_URL`, `NEXT_PUBLIC_MONSTERS_ID`, `NEXT_PUBLIC_ASSET_URL`. Market: `NEXT_PUBLIC_ASSETS_ID`, `NEXT_PUBLIC_PLATFORM_ID`, `NEXT_PUBLIC_BRAWLER_URL`, `NEXT_PUBLIC_DEMO=1`.
- Golden vectors: `node --experimental-strip-types scripts/golden.ts` after any TS sim change, then `cargo test`.
- New game: `games/<id>/{client,server}`, `register_game(id, referee, assets?)` on platform.

## Deploy to AWS

Single EC2 (rooms are in-memory, so exactly one instance) + Caddy for TLS. Needs `terraform`, `ansible`, AWS creds, a domain.

```sh
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars   # set ssh_cidr, domain, route53_zone_id?
make deploy-infra                     # EC2 + EIP + SG (+ Route53 A record)
# no route53_zone_id? point an A record for <domain> at `terraform -chdir=infra/terraform output -raw public_ip`
export CONTRACT_ID=v2.brawler-platform-5c8e2b.testnet MONSTERS_ID=brawler-monsters-5c8e2b.testnet REFEREE_ID=referee.v2.brawler-platform-5c8e2b.testnet REFEREE_KEY=...   # or ansible-vault secrets.yml via ANSIBLE_ARGS
make deploy                           # docker + repo (repo_version, default main) + compose up
```

- DNS must resolve to the EIP before `make deploy`, or Caddy can't get a cert.
- The box only runs the server and bots; the client and market deploy to Vercel (env in `infra/README.md`). `?server=wss://<domain>` overrides the server for a quick test.
- Redeploy: `make deploy ANSIBLE_ARGS="-e repo_version=<sha>"`. Remote state: add an `s3` backend in `versions.tf` (optional).

## Controls

Practice vs bot from the title screen, or play online: host a room, join by code, or watch from the lobby. Phones get an on-screen stick and buttons.

| | Move / aim | Jump | Light | Heavy | Block | Dodge |
|---|---|---|---|---|---|---|
| Keyboard | WASD (or arrows) | Space or W | J | K | L (hold) | C |
| Mouse / alternates | | | Right click / Z | Left click / X | Q (hold) | |
| Gamepad | Stick / D-pad | A | X | B / Y | | Bumpers / triggers |

Block (grounded, hold L or Q): hits from the front deal 1/5 damage and a small push instead of launching you; hits from behind land in full. You can't move or attack while blocking.

Hold a direction with an attack to pick the move (neutral, side or down; ground or air). Air neutral heavy is the recovery move; air down heavy is the ground pound. Hold down on a thin platform to drop through it. Press ` to show hitboxes and Esc to return to the menu.

## How it works

- **`src/lib/sim/`**: deterministic simulation at a fixed 60 Hz. No DOM, no randomness, no trig, no clock: the same inputs always produce the same state, in TS and in the Rust port.
  - Fighter states: idle, run, jumpsquat, air, land, dodge, attack, hitstun, block, dead.
  - Each stock has 200 HP; damage raises knockback: (base + damage% × growth) × defence modifier.
  - Hitlag on impact, hitstun scaled by knockback, 6-frame input buffer, frame data in `moves.ts`.
- **`src/lib/render/`**: procedural bone rig with keyframed poses, a fit-both camera, hit sparks, screen shake and KO beams. Reads sim state only.
- **`src/lib/net.ts`**: rollback netplay. The local sim predicts the opponent's input up to 10 frames ahead and re-simulates when real input arrives; clients compare state hashes every second.
- **Server**: relays inputs, records the confirmed tape, re-simulates it as referee, reports the result and tape hash on-chain, and serves history and tapes.

## License

MIT, see [LICENSE](LICENSE).
