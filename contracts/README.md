# Platform contract

One NEAR balance per player, shared by every game. Matches, betting AMM, tournaments keyed by `game`.
Source `platform/src/lib.rs`, tests `platform/src/tests.rs`.

```sh
cd platform
cargo test
cargo near build non-reproducible-wasm  # -> target/near/arena.wasm
```

Init `new(owner_id)`, fresh deploy (no migration from arena v3).

## Balance
- `deposit()` attach NEAR -> balance. `withdraw(amount)` -> transfer, re-credited if transfer fails. `balance_of(account_id)`.
- Stakes, bets, entry fees debit balance; claims/refunds credit it. Never per-match transfers.
- Spend calls (`create_match`, `join_match`, `buy`, `enter_tournament`) need exactly 1 yocto attached:
  wallet confirm, fn-call keys can't spend.

## Games
- Owner `register_game(game, referee_id, assets_id?)` (1 yocto, upsert). `get_game(game)`, `list_games()`.
- `referee_id` alone may `report_kos` / `report_result` that game's matches (tournament matches inherit tournament's game).
- `assets_id`: optional NFT contract w/ `lock(token_id, account_id, until_ms)`, `unlock(locks)`, `record_result(...)`,
  `add_title(token_id, title)`. Brawler -> monsters contract. No assets -> monster ids rejected.

## Match flow
1. Host `create_match(game, stake, bettable, monster_id?)`. Bettable needs stake >= min_bet; house seed = min(seed, stake), returned at settle/void. Monster: lock first (attach >= 100 Tgas), `on_create` opens or re-credits.
2. Guest `join_match(match_id, monster_id?)`: debits same stake, Live.
3. Spectators `buy(match_id, side, amount, min_out)` while Live. A share + B share = 1 NEAR; price A = b / (a + b). No selling.
4. Referee `report_kos`, then `report_result(match_id, winner | null, kos?, tape_hash?)` (tape_hash = 64-char lowercase sha256 hex, in MatchView). Guest joined but fight never started: referee `unjoin(match_id)` refunds guest, reopens (rejected once bets exist: void instead).
5. `claim(match_id)`: winner 2×stake − 0.1%; winning shares 1 NEAR each; void/`cancel_match`/`expire` (2 h) -> stakes + net bets back.

## Tournaments
- Owner `create_tournament(game, size 4|8, entry_fee, bettable)`. `enter_tournament(id, monster_id)` (1 yocto, >= 150 Tgas),
  24 h entry window, monster locked 72 h. Full -> bracket of zero-stake Live matches; void/expired -> seat with more reported KOs advances, tie -> seat 0 (lower entrant index).
- `claim_tournament(id)`: champion pot − 0.1%; `cancel_tournament(id)` after 24 h unfilled -> fees back.
- Views `get_tournament`, `list_tournaments(from, limit, game?)`, `list_matches(from, limit, game?)` (newest first, filter scans newest 500).

## Trust
- Referee per game decides results; give its key a fn-call key scoped to `report_kos`, `report_result`.
- Owner calls need 1 yocto (full-access key).
- Storage for balances, matches, bets paid from contract balance; add storage deposits before mainnet.
