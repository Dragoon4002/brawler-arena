# Ready for both tracks: Games (09) + NFTs (10)

Status: draft, waiting for OK. Contracts get redeployed: monsters v3 (skills + vaults), platform v3 (attestation + CLOB, already in progress, plus balance play + vault payouts).

## 1. Game loop on paper (Games track asks for this first)

| Every | Player does | Economy touch |
|---|---|---|
| 30 s | One exchange in a fight: dodge, hit, recover. Spectators flip their bet in the order book. | Skills (AirJump, Lifesteal...) decide exchanges. Bet prices move. |
| 5 min | One match: 3 stocks, ~3 min, then "Claim and return to lobby". Visit a merchant: sell the skill that dropped, buy a better one. | Staked pot paid out. Win drops a skill unit (faucet). Monster's vault earns its cut. Merchant prices react. |
| Session | Climb the ladder or a cup, re-equip, breed or rent a monster, invest in a broke merchant. | Skill units wear out (sink). Stud fees and rent flow to monster vaults. Merchants open and close. |

## 2. Games track: work

### G1. Chain the player never notices
- **Login:** NEAR Connect + Privy plugin (email / Google). Wallet users keep their wallets. Verify Privy NEAR works on testnet first.
- **Session key:** after login the client makes a local ed25519 function-call key for the platform and one for monsters (one approval, once). In-game calls sign silently with it.
- **Gasless:** the server relays NEP-366 meta-transactions signed by the session key; the relayer account pays gas. Players need 0 NEAR for gas.
- **No deposits in the loop:** stake, bet, claim, equip, merchant buy/sell all draw from the player's platform balance. Contract methods in the loop attach no deposit; storage comes out of balance. Equip drops its 1-yocto guard (moves no value; NFT transfers keep theirs).
- **Money in:** one "Add funds" step (wallet transfer; on mainnet also any token via NEAR Intents 1Click). Testnet starter grant: new accounts get play credits from the treasury, once per account.

### G2. NPC merchants with wallets (`agents/`)
- 3 merchants (Smith, Alchemist, Fletcher), each a real account with NEAR + skill inventory. They buy and sell skills through the skill contract like players.
- **Pricing in one file:** `agents/pricing.ts`, pure function `(stock, target, recentBuys, recentSells, cash) -> {bid, ask, why}`. More stock = cheaper. Flood the market with Swift Feet and it gets cheap.
- **Reasoning tooltip:** merchants publish `why` per price; market shows it on hover.
- **Broke merchant closes** (cash below floor): shop shows "Closed". Players can invest NEAR for a share of its future profit (share = NFT, see N1 tie-in).

### G3. Economy that moves without a patch
- **Faucet:** a staked win drops 1 Common skill unit (seeded by the match seed).
- **Sink:** each equipped skill unit has 20 fights of charge, then burns. Keeps demand alive.
- Merchant prices + player CLOB + presales set prices; nothing hard-coded except the pricing rules file.

### G4. Fast-forward
- `/economy` page: replays a week of merchant trading in 60 s using the same `pricing.ts` with simulated players (flood iron... flood Swift Feet, merchant goes broke, investor reopens it). Charts of price, stock, cash per merchant.
- Pure TS sim, no chain, deterministic seed.

### G5. NEP-245
- Skills already NEP-245 in the monsters contract. Deploy it (v3). Drops and wear use `mt_mint` / burn events.

## 3. NFTs track: work

### N1. Monster = account (vault)
- Each monster gets sub-account `m<id>.<monsters contract>` at hatch, running a tiny vault contract (shared code via global contract if testnet supports it, else one small wasm).
- **Vault has no access keys.** It only obeys its parent (monsters contract), which checks the current NFT owner. Holder controls it through the parent: `vault_withdraw(token_id, amount)`.
- Transfer = ownership changes in the parent; the vault never stores an owner, so control moves with the token in the same receipt.

### N2. Monster earns, holds, carries
- Earns: X% of its staked winnings (platform pays the vault, not the owner), stud fee when bred with, rent share.
- Holds inventory: equipped skills (exists) and its vault NEAR.
- Credentials: win count, cup badges on the token (dynamic NFT metadata); presale allowlists can require "holds a monster with N wins".

### N3. Gated page
- `/den`: only current monster holders. Client signs NEP-413, server checks `nft_tokens_for_owner`, same path as seat auth. Shows vault dashboard, holder-only presales, breeding lab.

### N4. History per NFT
- Contract keeps a capped log per token: earned (source), paid out, holder changes, with block time. Page `/monster/<id>/history`.

### N5. Tests
- Transfer path: vault balance and withdraw rights move; old owner's withdraw panics.
- Sale in the middle of a payout: platform settle credits the vault while `buy` runs in another receipt; whoever owns at withdraw time gets it, nothing lost or doubled (near-workspaces sandbox).

### N6. Threat model (prompt says: write before coding, wait for OK)
Ways a seller tries to keep the money, and what stops each:
1. Withdraw right before the sale lands: listing freezes vault withdraw; buyer pays a price set while the balance is frozen.
2. Keep an access key on the vault: vault account is created with no keys; test asserts `view_access_key_list` is empty.
3. In-flight payout routed to them: payouts always go to the vault, never to the owner at settle time.
4. Old NEP-178 approval reused to transfer back: approvals cleared on every transfer.
5. Unequip skills before sale: equip blocked while listed (exists).
6. Rent it out, then sell: busy monsters can't be listed (exists); renter can't withdraw.
7. Storage refund or delete-account to self: vault has no delete method; storage deposits refund to the contract.
8. Parent upgrade to drain vaults: vault code immutable (global by hash); parent upgrade can't move vault funds except via `vault_withdraw`.

## 4. Order
1. Wait for platform v3 agent (attestation + CLOB) to finish, merge.
2. Write N6 + loop doc final, get OK.
3. Contracts: monsters v3 (vault, history, drops, wear, no-yocto equip) + platform v3 additions (balance play, vault payouts, starter grant). Tests incl. N5.
4. Server: meta-tx relayer, gated-page auth.
5. Client: Privy/NEAR Connect login, session key, Add funds, `/den`, history page, tooltips.
6. Agents: merchants + `pricing.ts`; `/economy` fast-forward.
7. Deploy testnet, e2e money path, README sections per track (control-on-transfer explanation, pricing file pointer), demo video.

Testnet NEAR needed: ~40 (contracts ~15, relayer gas ~5, merchants ~10, vault sub-accounts and starter grants ~10).
