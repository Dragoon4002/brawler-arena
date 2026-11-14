# Brawler Arena

A real-time 1v1 platform fighter on NEAR testnet. Monsters are NEP-171 NFTs whose on-chain DNA sets their stats, skills are NEP-245 tokens that players trade and equip, and every staked match, spectator bet and tournament settles in a contract. Every result can be replayed and checked against the hash the referee posted on-chain.

- **Game:** `<game url>` (TBD: Vercel deploy of `games/brawler/client`)
- **Market:** `<market url>` (TBD: Vercel deploy of `market/`)
- **Game server:** `wss://65-0-237-185.sslip.io` (AWS EC2, Caddy TLS)
- **Network:** NEAR testnet. **License:** MIT.

## Problem

Wagered online games ask players to trust the operator: that it holds the stakes, reports the real winner and pays out. Game items are usually database rows the player can't sell, lend or take elsewhere. Brawler Arena puts the money, the result and the items on NEAR:

- The game server never holds funds. It can only report a result, through a referee key.
- The result is reproducible. Anyone can re-run the input tape in the browser and compare its hash with the contract.
- Monsters and skills are tokens the player owns. They trade on a player-run market, can be rented out, and change how the monster fights.

## How to try it

Practice and watching need no wallet. Anything that moves NEAR needs a NEAR **testnet** wallet (HOT, Meteor, MyNearWallet or any wallet in the near-connect selector) with a little testnet NEAR.

1. **Practice vs bot (no wallet).** Open `<game url>` → press **Practice vs bot** → you fight a local bot. Keys: WASD move, Space jump, J light, K heavy, L block, C dodge (full table in [Controls](#controls)).
2. **Host a room and call a bot.** Press **Play** → create a free room → in the room lobby press **Call bot** → a bot joins with a "bot" chip, says hi in chat → press **Start** → you fight it online through the server (rollback netcode, server referee).
3. **Get monsters.** Connect wallet → **Monsters** → **Claim 3 starter monsters** (one-time, 0.1 NEAR storage deposit, excess refunded) → three gen-0 monster NFTs appear with stat bars from their DNA, plus 3 starter skill units.
4. **Staked room.** Click **Balance** in the header → deposit testnet NEAR into your platform balance → **Play** → create a room with a stake and pick a monster → a second wallet joins with the same stake → fight → the winner's balance gets 2× stake minus 0.1% fee. The monster is locked for the match (it can't be sold or transferred until it ends).
5. **Spectator betting.** From a second browser, open **Lobby** → **Watch** a live bettable room → the betting card shows live AMM prices per fighter → buy a side → after the fight, **Account → Claims** shows the payout to claim.
6. **Verify a replay.** **Account → History** (or a player profile) → **Replay** on any finished match → `/replay/<id>` re-runs the tape locally → the **Fairness check** panel shows ✓/✗ for the re-run winner, the tape hash vs the server record, and the tape hash vs `tape_hash` stored on the platform contract for that match.
7. **Customize skills.** **Skills** (or **Customize** on a monster) → pick a monster → put up to 3 owned skills in its slots → live stat preview → **Save** sends one `equip` transaction → the next chain match uses those skills (the server reads them from `get_monster`, not from the client).
8. **Market.** Open `<market url>` → home shows top skill (24h), hottest monster, live presale → open a skill → buy from a presale or from a player listing → **Me** lists your skills; list free units for sale, cancel listings, withdraw owed proceeds. Creators (allow-listed by the contract owner) publish collections, skills and presales at **Create**. `?demo` runs the market on mock data without a wallet.
9. **Sell, rent, breed monsters.** Open a monster (**Monsters** → click it) → **Sell or rent out** sets a price or a daily rent → another wallet buys or rents it from the same page; a renter can fight with it until the rental ends but can't sell, transfer or re-equip it. Breeding (`/breed`, 0.1 NEAR, 1 h cooldown, child mixes parents' DNA) and the in-game monster market (`/market`) work by URL; their hub buttons show "Soon". Monster listings also appear on the market app.
10. **Tournaments.** **Cups** → create or enter a 4/8-player bracket with an entry fee → bracket advances as matches settle → winner claims the pot (`claim_tournament`).

## Games With Real Economies track

| Track asks for | What we built |
|---|---|
| Player-owned markets | Monsters: in-contract `list` / `buy`, 2.5% fee, 5% royalty to the breeder. Skills: `list_skill` / `buy_skill` with partial fills, creator royalty (≤10%), `price_history` on-chain (last 64 trades) for charts. Creators run presales (window, total cap, per-wallet cap, allowlist). The market app reads contract views directly, no indexer. |
| NEP-245 | Skills are a hand-rolled NEP-245 multi-token in the monsters contract: token id `skill:<id>`, `mt_transfer`, `mt_batch_transfer`, `mt_balance_of`, `mt_supply`, `mt_token`, `mt_mint` / `mt_transfer` events. |
| Economy affects gameplay | Equipped skills change the fight. Stat skills add to DNA stats before `stat_mods` (≤ +2 per stat, ≤ +3 total, max 3 skills). Effect skills: Air Jump (3 air jumps), Lifesteal (heal dealt/5), Quick Dodge (dodge cooldown −1/3), Second Wind (heal 30 once per stock at ≤50 HP). Same rules in the TS sim and the Rust referee, golden-tested. |
| Provable fairness | Deterministic sim (no randomness, no clock, no trig). The referee re-simulates the confirmed tape, posts winner + SHA-256 tape hash on-chain; `/replay/<id>` recomputes both in the browser. |
| Agents / NPCs | Bots (`agents/`) join free rooms on "Call bot" and play over the normal client protocol; a commentator posts play-by-play in chat. Bots never touch money. |
| Players never notice the chain | Practice, watching and free rooms need no wallet. Stakes come from one in-contract balance, so a match is one call, not a transfer per round. |

## NFTs That Do Something track

| Track asks for | What we built |
|---|---|
| NEP-171 | Monsters are NEP-171/177/181 NFTs (`nft_transfer`, `nft_token`, `nft_tokens_for_owner`, metadata). |
| Dynamic NFTs | DNA is generated on-chain (`hatch_starters`, `breed` mixes parents' DNA) and sets fight stats. The token keeps changing after mint: win/loss/KO record, match history (last 50), season wins, titles, equipped skills, rental and lock state. |
| Hold inventory | The skill loadout is stored on the monster. Equipped units leave the owner's free balance and travel with the monster on `nft_transfer` and `buy`; the new owner can unequip them into their own balance. |
| Access rights | Rental: `offer_rent` / `rent(days)`. For the rental period the renter may enter matches with the monster (the platform's `lock` accepts the renter); the owner can't sell, transfer or re-equip it, and the renter can't either. |
| Ownership with behavior | While a monster fights, the platform locks it (`lock` until the match ends): no transfer, sale, breed or equip. `report_result` unlocks it and writes the result to the token. |
| Earn royalties | Breeder gets 5% of every resale of a monster it bred; skill creators get their royalty on every skill resale and presale proceeds via `owed` / `withdraw_owed`. |

## Contracts (testnet)

| Contract | Account | What it does |
|---|---|---|
| Platform | [`v2.brawler-platform-5c8e2b.testnet`](https://testnet.nearblocks.io/address/v2.brawler-platform-5c8e2b.testnet) | balances, staked matches, spectator AMM market, tournaments, per-game referee |
| Monsters + skills | [`v2.brawler-monsters-5c8e2b.testnet`](https://testnet.nearblocks.io/address/v2.brawler-monsters-5c8e2b.testnet) | monster NFTs (hatch, breed, list/buy, rent, match locks) and NEP-245 skills (presales, skill market, `equip`) |
| Referee | [`referee.v2.brawler-platform-5c8e2b.testnet`](https://testnet.nearblocks.io/address/referee.v2.brawler-platform-5c8e2b.testnet) | the game server's key; only it can report results |
| Platform owner | [`brawler-platform-5c8e2b.testnet`](https://testnet.nearblocks.io/address/brawler-platform-5c8e2b.testnet) | registers games, owns the monsters contract, creator of the "Arena Basics" skills |

Superseded: monsters without skills at `brawler-monsters-5c8e2b.testnet`, platform v1 at `brawler-platform-5c8e2b.testnet`. Deploy and end-to-end transaction log: [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md). Skills interface: [`games/brawler/plans/skills-interface.md`](games/brawler/plans/skills-interface.md).

## What's on-chain

| On-chain | Off-chain |
|---|---|
| Deposits, withdrawals, in-contract balance | Live fight inputs (WebRTC P2P, or WebSocket relay) |
| Match stakes, escrow, payout (`create_match`, `join_match`, `report_result`) | Room lobby, chat, matchmaking |
| Guest refund before the fight (`unjoin`), voids and expiry | Rendering, sound |
| Spectator prediction market: AMM prices, `buy`, `claim` | Full input tapes (served at `/tape/<id>`) |
| SHA-256 hash of every settled match's input tape (`tape_hash`) | Free friendly matches |
| Tournaments: entry, bracket advance, `claim_tournament` | Bots |
| Monster NFTs, DNA, breeding, sales, rentals, lock during a match | |
| Skill tokens, presales, skill listings, price history, loadouts | |

## How we use NEAR

- **Escrow without trust:** stakes and bets live in the platform contract. The game server can only call `report_result` through its referee key; it never holds funds.
- **Provable fairness:** the referee re-simulates both players' inputs, reports the winner and the tape's SHA-256 on-chain, and anyone can re-check it at `/replay/<id>`.
- **Prediction markets per fight:** each bettable match opens an AMM market seeded by the house treasury, on staked and free rooms alike; the seed comes back at settle.
- **Assets the game reads:** the server reads DNA and equipped skills from `get_monster` at match start. Client-claimed stats are never trusted.
- **One balance across games:** the platform registers games with their own referee and assets contract (`register_game`); Brawler is the first.
- **Wallet only when money moves:** practice and watching need no wallet.

## Built during the hackathon

Hackathon window: 2026-10-19 → 2026-11-14 (Q-001). The first commit in this repository is 2026-11-11 (`git log --reverse --date=short`) and no commit predates 2026-10-19, so there is **no pre-hackathon baseline**: the whole history is hackathon work.

Libraries and tools used (Q-005):

- TS: Next.js 16, React 19, `near-api-js` 7, `@hot-labs/near-connect` + `near-connect-hooks` (wallet selector), Tailwind 4 (market), bun (market), TypeScript.
- Rust: `near-sdk` / `near-contract-standards` 5.30 (contracts), `cargo-near`, `axum` (WebSocket server), `near-api` (referee RPC), `sha2`, `serde`, `rand`, `ethnum`.
- Infra: Terraform, Ansible, Docker, Caddy; Vercel (client, market, UI art in Vercel Blob).
- Art and video: Blender (`games/brawler/sprites/*.blend`), Remotion (`games/brawler/video/`); Godot 4 for the experimental `games/brawler/godot/` client.
- AI-assisted code: most code was written with AI coding agents (Claude Code), directed and reviewed by the team. Plans and specs the agents worked from are in `games/brawler/plans/` and `tasks/`.

## Features

- Practice vs bot, no wallet, keyboard / gamepad / touch.
- Online rooms: public or private, free or staked, spectators, chat, rematch.
- Rollback netcode (P2P with relay fallback); reconnect to a fight within 30 s.
- Live spectator market with price chart.
- Tournaments (4/8 players), leaderboard by wins and NEAR won, player profiles and match history with replays.
- Monsters: hatch starters (with 3 starter skill units), breed, sell, rent.
- Skills: equip up to 3 on a monster; buy, sell and publish them on the market app.
- Bots: press "Call bot" in a free room and a bot joins, marked with a "bot" chip (`agents/`).

## Repo

| Path | What |
|---|---|
| `games/brawler/client/` | game client (Next.js) |
| `games/brawler/server/` | Rust WebSocket server: relay, lobby, referee, tapes, history |
| `games/brawler/sim/` | Rust port of the sim, golden-tested against the TS sim |
| `games/brawler/contract/` | monsters + skills contract (NEP-171 + NEP-245) |
| `contracts/platform/` | platform contract |
| `crates/near-svc/` | Rust NEAR RPC, NEP-413 verify, referee tx queue |
| `packages/platform/` | shared TS wallet + balance hooks |
| `agents/` | bot service |
| `market/` | skill + monster marketplace (Next.js + Tailwind, bun) |
| `scripts/` | testnet deploy (`deploy-monsters-v2.mjs`), skill seed (`seed-skills.mjs`), e2e (`testnet-e2e.mjs`), golden vectors |
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
- Contracts: `make wasm`; `node scripts/deploy-monsters-v2.mjs --check` prints the balance preflight, without `--check` it deploys, registers the game and seeds skills.
- New game: `games/<id>/{client,server}`, `register_game(id, referee, assets?)` on platform.

## Deploy

The game client and market deploy to Vercel (project roots `games/brawler/client` and `market/`, env in `infra/README.md`). A single EC2 box runs the server and bots (rooms are in-memory, so exactly one instance) behind Caddy for TLS. Needs `terraform`, `ansible`, AWS creds, a domain.

```sh
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars   # set ssh_cidr, domain, route53_zone_id?
make deploy-infra                     # EC2 + EIP + SG (+ Route53 A record)
# no route53_zone_id? point an A record for <domain> at `terraform -chdir=infra/terraform output -raw public_ip`
export CONTRACT_ID=v2.brawler-platform-5c8e2b.testnet MONSTERS_ID=v2.brawler-monsters-5c8e2b.testnet REFEREE_ID=referee.v2.brawler-platform-5c8e2b.testnet REFEREE_KEY=...   # or ansible-vault secrets.yml via ANSIBLE_ARGS
make deploy                           # docker + repo (repo_version, default main) + compose up
```

- DNS must resolve to the EIP before `make deploy`, or Caddy can't get a cert.
- `?server=wss://<domain>` on the game URL overrides the server for a quick test.
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
