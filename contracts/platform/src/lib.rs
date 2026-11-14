//! Spend calls need 1 yocto: wallet confirm, fn-call keys can't spend.
//! Games: `register_game(game, referee, assets?)`. Referee settles that game's matches; assets = optional NFT
//! contract w/ lock/unlock/record_result/add_title (lock first, `#[private]` callback re-credits on fail).
//! Market: per-match constant-product AMM, A share + B share = 1 NEAR, no selling, winners redeem 1 NEAR/share,
//! void refunds net bets. House treasury seeds bettable pools, takes fees.

use ethnum::U256;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, assert_one_yocto, env,
    ext_contract, near, require,
};

const BPS: u128 = 10_000;
const EXPIRY_NS: u64 = 2 * 60 * 60 * 1_000_000_000;
const MAX_LIST: u64 = 50;
const MAX_RECENT: u32 = 20;
const MAX_SCAN: usize = 500; // ponytail: game filter scans newest 500; per-game index if games outgrow it
const MAX_HISTORY: usize = 200; // ponytail: oldest price points drop off; store sampled history if longer charts matter
const CALLBACK_GAS: Gas = Gas::from_tgas(5);
// create/join w/ monster: attach >= 100 Tgas
const LOCK_GAS: Gas = Gas::from_tgas(15);
const ON_LOCK_GAS: Gas = Gas::from_tgas(40);
const ON_ENTER_GAS: Gas = Gas::from_tgas(100); // the 8th entry creates 4 bettable matches
const ENTER_GAS: Gas = Gas::from_tgas(150); // lock + on_enter + enter_tournament itself
// report_result worst case (final): 20 + 10 + 10 + 10 = 50 of referee's 100 Tgas
const RECORD_GAS: Gas = Gas::from_tgas(20);
const UNLOCK_GAS: Gas = Gas::from_tgas(10);
const TITLE_GAS: Gas = Gas::from_tgas(10);
const MATCH_LOCK_MS: u64 = 5 * 60 * 60 * 1000; // 2 h open + 2 h live + 1 h buffer
// ponytail: 72 h = 24 h entry + 3 rounds x 2 h; re-lock per round if brackets get slower
const TOURNEY_LOCK_MS: u64 = 72 * 60 * 60 * 1000;
const TOURNEY_CANCEL_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

/// (token id, until_ms). unlock passes both: stale unlock can't free newer lock.
type Lock = (String, u64);

#[allow(dead_code)] // feeds macro only
#[ext_contract(ext_assets)]
trait Assets {
    fn lock(&mut self, token_id: String, account_id: AccountId, until_ms: u64);
    fn unlock(&mut self, locks: Vec<(String, u64)>);
    fn record_result(&mut self, match_id: u64, tokens: [Option<String>; 2], winner: Option<u8>, kos: [u8; 2], tournament: Option<u64>);
    fn add_title(&mut self, token_id: String, title: String);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Matches,
    Positions,
    History,
    Bets,
    MyBets,
    Tournaments,
    Games,
    Balances,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Game {
    pub referee_id: AccountId,
    pub assets_id: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Open,
    Live,
    Settled(u8),
    Refund,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Match {
    game: String,
    host: AccountId,
    guest: Option<AccountId>,
    stake: u128,
    bettable: bool,
    status: Status,
    kos: u8,
    amm: [u128; 2],
    seed: u128,
    collateral: u128, // NEAR backing market (= all A shares = all B shares)
    bet_count: u32,
    created_ns: u64,
    started_ns: u64,
    claimed: [bool; 2],
    advances: u8,       // tournament: seat that moved on
    monsters: [Option<Lock>; 2],
    tournament: Option<(u64, u8, u8)>, // (id, round, slot)
    tape_hash: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum TStatus {
    Open,
    Live,
    Done,
    Cancelled,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Tournament {
    game: String,
    size: u8,
    entry_fee: u128,
    pot: u128,
    bettable: bool,
    status: TStatus,
    entrants: Vec<(AccountId, Lock)>,
    rounds: Vec<Vec<Option<u64>>>,      // match ids
    champion: Option<AccountId>,
    created_ns: u64,
    claimed: Vec<bool>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Position {
    shares: [u128; 2],
    paid: u128, // net of fees = void refund
    claimed: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct BetView {
    pub id: u32,
    pub who: AccountId,
    pub side: u8,
    pub amount: U128, // before fee
    pub shares: U128,
    pub ms: u64,
}

#[near(serializers = [json])]
pub struct MatchView {
    pub id: u64,
    pub game: String,
    pub host: AccountId,
    pub guest: Option<AccountId>,
    pub stake: U128,
    pub bettable: bool,
    pub status: String,
    pub winner: Option<u8>,
    pub kos: u8,
    pub amm: [U128; 2],
    pub price_bps: u16, // seat 0 price
    pub collateral: U128,
    pub created_ms: u64,
    pub started_ms: u64,
    pub monsters: [Option<String>; 2],
    pub tournament: Option<u64>,
    pub tape_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct EntrantView {
    pub account: AccountId,
    pub monster: String,
}

#[near(serializers = [json])]
pub struct TournamentView {
    pub id: u64,
    pub game: String,
    pub size: u8,
    pub entry_fee: U128,
    pub pot: U128,
    pub bettable: bool,
    pub status: String,
    pub entrants: Vec<EntrantView>,
    pub rounds: Vec<Vec<Option<u64>>>,
    pub champion: Option<AccountId>,
    pub created_ms: u64,
    pub claimed: Vec<bool>,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub shares: [U128; 2],
    pub paid: U128,
    pub claimed: bool,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub fee_bps: u32,
    pub min_bet: U128,
    pub max_bet: U128,
    pub seed: U128,
    pub treasury: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    owner: AccountId,
    fee_bps: u32,
    min_bet: u128,
    max_bet: u128,
    seed: u128,
    treasury: u128,
    games: IterableMap<String, Game>,
    balances: LookupMap<AccountId, u128>, // ponytail: storage paid by contract; storage deposit before mainnet
    matches: Vector<Match>, // id = index
    positions: LookupMap<(u64, AccountId), Position>,
    history: LookupMap<u64, Vec<(u64, u16)>>, // (ms, seat 0 bps) per trade
    bets: LookupMap<(u64, u32), BetView>,      // (match, bet id)
    my_bets: LookupMap<(u64, AccountId), Vec<u32>>,
    tournaments: Vector<Tournament>, // id = index
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

fn price_bps(amm: [u128; 2]) -> u16 {
    if amm[0] + amm[1] == 0 { 5000 } else { mul_div(amm[1], BPS, amm[0] + amm[1]) as u16 }
}

/// x NEAR -> `side` shares: mint x pairs, swap other side back till a*b holds. (out, reserves), rounds vs trader.
fn amm_buy(r: [u128; 2], side: usize, x: u128) -> (u128, [u128; 2]) {
    let o = 1 - side;
    let k = U256::from(r[0]) * U256::from(r[1]);
    let ro = U256::from(r[o] + x);
    let keep = ((k + ro - 1) / ro).as_u128();
    let mut n = r;
    n[o] = r[o] + x;
    n[side] = keep;
    (r[side] + x - keep, n)
}

#[near]
impl Arena {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner: owner_id,
            fee_bps: 10,
            min_bet: NearToken::from_millinear(10).as_yoctonear(),
            max_bet: NearToken::from_near(100).as_yoctonear(),
            seed: NearToken::from_near(5).as_yoctonear(),
            treasury: 0,
            games: IterableMap::new(Key::Games),
            balances: LookupMap::new(Key::Balances),
            matches: Vector::new(Key::Matches),
            positions: LookupMap::new(Key::Positions),
            history: LookupMap::new(Key::History),
            bets: LookupMap::new(Key::Bets),
            my_bets: LookupMap::new(Key::MyBets),
            tournaments: Vector::new(Key::Tournaments),
        }
    }

    /* ---------- balance ---------- */

    #[payable]
    pub fn deposit(&mut self) {
        let amt = env::attached_deposit().as_yoctonear();
        require!(amt > 0, "Attach a deposit");
        self.credit(&env::predecessor_account_id(), amt);
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let who = env::predecessor_account_id();
        require!(amount.0 > 0, "Bad amount");
        self.debit(&who, amount.0);
        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_withdraw(who, amount))
    }

    /// Transfer failed -> re-credit.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        if promise_ok() {
            return true;
        }
        self.credit(&account_id, amount.0);
        false
    }

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    /* ---------- players ---------- */

    /// Monster -> lock first, returns `on_create` result (`null` = re-credited).
    #[payable]
    pub fn create_match(&mut self, game: String, stake: U128, bettable: bool, monster_id: Option<String>) -> PromiseOrValue<Option<u64>> {
        assert_one_yocto();
        let host = env::predecessor_account_id();
        let g = self.game(&game);
        let seed = self.seed_for(stake.0, bettable);
        require!(self.treasury >= seed, "House can't fund bets right now");
        self.debit(&host, stake.0);
        let Some(mon) = monster_id else {
            return PromiseOrValue::Value(Some(self.open_match(game, host, stake.0, seed, None)));
        };
        let until = now_ms() + MATCH_LOCK_MS;
        PromiseOrValue::Promise(lock(&g, &mon, &host, until).then(
            Self::ext(env::current_account_id()).with_static_gas(ON_LOCK_GAS).on_create(game, host, stake, bettable, mon, until),
        ))
    }

    /// Seed taken here, not in `create_match`: concurrent create can't overdraw treasury.
    #[private]
    pub fn on_create(&mut self, game: String, host: AccountId, stake: U128, bettable: bool, monster_id: String, until_ms: u64) -> Option<u64> {
        let locked = promise_ok();
        let seed = self.seed_for(stake.0, bettable);
        if locked && self.treasury >= seed {
            return Some(self.open_match(game, host, stake.0, seed, Some((monster_id, until_ms))));
        }
        self.bounce(&game, host, stake.0, locked.then_some((monster_id, until_ms)));
        None
    }

    /// Monster -> lock first, returns `on_join` result (false = re-credited).
    #[payable]
    pub fn join_match(&mut self, match_id: u64, monster_id: Option<String>) -> PromiseOrValue<bool> {
        assert_one_yocto();
        let guest = env::predecessor_account_id();
        let m = self.get_match_internal(match_id);
        require!(m.status == Status::Open, "Match not open");
        require!(guest != m.host, "Host cannot join own match");
        self.debit(&guest, m.stake);
        let Some(mon) = monster_id else {
            self.go_live(match_id, guest, None);
            return PromiseOrValue::Value(true);
        };
        let until = now_ms() + MATCH_LOCK_MS;
        PromiseOrValue::Promise(lock(&self.game(&m.game), &mon, &guest, until).then(
            Self::ext(env::current_account_id()).with_static_gas(ON_LOCK_GAS).on_join(match_id, guest, U128(m.stake), mon, until),
        ))
    }

    /// Someone else may have joined / host cancelled while lock in flight.
    #[private]
    pub fn on_join(&mut self, match_id: u64, guest: AccountId, deposit: U128, monster_id: String, until_ms: u64) -> bool {
        let locked = promise_ok();
        let m = self.get_match_internal(match_id);
        if locked && m.status == Status::Open && deposit.0 == m.stake {
            self.go_live(match_id, guest, Some((monster_id, until_ms)));
            return true;
        }
        self.bounce(&m.game, guest, deposit.0, locked.then_some((monster_id, until_ms)));
        false
    }

    pub fn cancel_match(&mut self, match_id: u64) {
        let m = self.get_mut(match_id);
        require!(env::predecessor_account_id() == m.host, "Only host");
        require!(m.status == Status::Open, "Match not open");
        self.finish(match_id, Status::Refund);
        self.after(match_id, [0, 0]);
        if self.get_match_internal(match_id).stake > 0 {
            self.claim(match_id);
        }
    }

    /* ---------- spectators ---------- */

    /// Back `side` with `amount` from balance. Locked till result.
    #[payable]
    pub fn buy(&mut self, match_id: u64, side: u8, amount: U128, min_out: U128) -> U128 {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let amount = amount.0;
        require!(side <= 1, "side must be 0 or 1");
        require!(amount >= self.min_bet, "Bet below minimum");
        require!(amount <= self.max_bet, "Bet above maximum");
        let fee = amount * self.fee_bps as u128 / BPS;
        let x = amount - fee;
        let m = self.tradable(match_id, &who);
        let (out, amm) = amm_buy(m.amm, side as usize, x);
        require!(out >= min_out.0, "Price moved, try again");
        self.debit(&who, amount);

        let key = (match_id, who.clone());
        let mut p = self.positions.get(&key).cloned().unwrap_or_default();
        p.shares[side as usize] += out;
        p.paid += x;
        self.positions.insert(key.clone(), p);
        let m = self.get_mut(match_id);
        m.amm = amm;
        m.collateral += x;
        let id = m.bet_count;
        m.bet_count += 1;
        self.bets.insert((match_id, id), BetView { id, who, side, amount: U128(amount), shares: U128(out), ms: now_ms() });
        self.my_bets.entry(key).or_default().push(id);
        self.treasury += fee;
        self.push_price(match_id);
        U128(out)
    }

    /* ---------- referee ---------- */

    pub fn report_kos(&mut self, match_id: u64, kos: u8) {
        let game = self.get_match_internal(match_id).game;
        self.only_referee(&game);
        let m = self.get_mut(match_id);
        require!(m.status == Status::Live, "Match not live");
        if kos > m.kos {
            m.kos = kos;
        }
    }

    /// `kos[i]` = KOs by seat i (asset record; void bracket match: more KOs advances). `tape_hash` = sha256 hex of replay.
    pub fn report_result(&mut self, match_id: u64, winner: Option<u8>, kos: Option<[u8; 2]>, tape_hash: Option<String>) {
        let m = self.get_match_internal(match_id);
        self.only_referee(&m.game);
        require!(m.status == Status::Live, "Match not live");
        if let Some(h) = &tape_hash {
            require!(h.len() == 64 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')), "Bad tape_hash");
        }
        self.get_mut(match_id).tape_hash = tape_hash;
        let status = match winner {
            None => Status::Refund,
            Some(w) => {
                require!(w <= 1, "winner must be 0 or 1");
                self.treasury += 2 * m.stake * self.fee_bps as u128 / BPS;
                Status::Settled(w)
            }
        };
        self.finish(match_id, status);
        if let (true, Some(a)) = (m.monsters.iter().any(Option::is_some), self.assets(&m.game)) {
            ext_assets::ext(a)
                .with_static_gas(RECORD_GAS)
                .record_result(match_id, m.monsters.clone().map(|l| l.map(|l| l.0)), winner, kos.unwrap_or_default(), m.tournament.map(|t| t.0))
                .detach();
        }
        self.after(match_id, kos.unwrap_or_default());
    }

    /// Guest joined, fight never started: refund guest, reopen. Traded market -> rejected (bettors priced this pairing); void via report_result.
    pub fn unjoin(&mut self, match_id: u64) {
        let m = self.get_match_internal(match_id);
        self.only_referee(&m.game);
        require!(m.status == Status::Live && m.tournament.is_none(), "Match not unjoinable");
        require!(m.bet_count == 0, "Market has trades");
        let guest = m.guest.clone().unwrap();
        self.credit(&guest, m.stake);
        self.unlock(&m.game, m.monsters[1].clone().into_iter().collect());
        self.history.remove(&match_id);
        let m = self.get_mut(match_id);
        m.guest = None;
        m.monsters[1] = None;
        m.status = Status::Open;
        m.started_ns = 0;
    }

    /// Anyone voids unsettled (or unjoined) match after 2 h.
    pub fn expire(&mut self, match_id: u64) {
        let now = env::block_timestamp();
        let m = self.get_match_internal(match_id);
        let since = match m.status {
            Status::Open => m.created_ns,
            Status::Live => m.started_ns,
            _ => env::panic_str("Match already finished"),
        };
        require!(now.saturating_sub(since) > EXPIRY_NS, "Not expired yet");
        self.finish(match_id, Status::Refund);
        self.after(match_id, [0, 0]);
    }

    /* ---------- tournaments ---------- */

    #[payable]
    pub fn create_tournament(&mut self, game: String, size: u8, entry_fee: U128, bettable: bool) -> u64 {
        self.only_owner();
        self.game(&game);
        require!(size == 4 || size == 8, "Size must be 4 or 8");
        let rounds = (0..size.trailing_zeros()).map(|r| vec![None; (size >> (r + 1)) as usize]).collect();
        let id = self.tournaments.len() as u64;
        self.tournaments.push(Tournament {
            game,
            size,
            entry_fee: entry_fee.0,
            pot: 0,
            bettable,
            status: TStatus::Open,
            entrants: vec![],
            rounds,
            champion: None,
            created_ns: env::block_timestamp(),
            claimed: vec![],
        });
        id
    }

    /// Locks monster 72 h, then `on_enter` registers (false = re-credited).
    #[payable]
    pub fn enter_tournament(&mut self, id: u64, monster_id: String) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let t = self.get_t(id);
        require!(t.status == TStatus::Open, "Tournament not open");
        require!(env::block_timestamp().saturating_sub(t.created_ns) <= TOURNEY_CANCEL_NS, "Entry closed");
        require!(!t.entrants.iter().any(|e| e.0 == who), "Already entered");
        // fail here, not out of gas in on_enter after lock
        require!(env::prepaid_gas() >= ENTER_GAS, "Attach 150 Tgas");
        self.debit(&who, t.entry_fee);
        let until = now_ms() + TOURNEY_LOCK_MS;
        lock(&self.game(&t.game), &monster_id, &who, until).then(
            Self::ext(env::current_account_id()).with_static_gas(ON_ENTER_GAS).on_enter(id, who, U128(t.entry_fee), monster_id, until),
        )
    }

    /// No panics past lookup: fee lands in pot or re-credited.
    #[private]
    pub fn on_enter(&mut self, id: u64, account_id: AccountId, fee: U128, monster_id: String, until_ms: u64) -> bool {
        let locked = promise_ok();
        let t = self.get_t(id);
        if !locked || t.status != TStatus::Open || t.entrants.iter().any(|e| e.0 == account_id) {
            self.bounce(&t.game, account_id, fee.0, locked.then_some((monster_id, until_ms)));
            return false;
        }
        let t = self.tournaments.get_mut(id as u32).unwrap();
        t.entrants.push((account_id, (monster_id, until_ms)));
        t.claimed.push(false);
        t.pot += fee.0;
        if t.entrants.len() == t.size as usize {
            t.status = TStatus::Live;
            let e = t.entrants.clone();
            for s in 0..e.len() / 2 {
                self.tourney_match(id, 0, s as u8, e[2 * s].clone(), e[2 * s + 1].clone());
            }
        }
        true
    }

    /// Champion: pot - fee. Cancelled: fee back. Credits balance.
    pub fn claim_tournament(&mut self, id: u64) -> U128 {
        let who = env::predecessor_account_id();
        let t = self.get_t(id);
        let i = t.entrants.iter().position(|e| e.0 == who).unwrap_or_else(|| env::panic_str("Nothing to claim"));
        let due = match t.status {
            _ if t.claimed[i] => 0,
            TStatus::Cancelled => t.entry_fee,
            TStatus::Done if t.champion.as_ref() == Some(&who) => t.pot - t.pot * self.fee_bps as u128 / BPS,
            _ => 0,
        };
        require!(due > 0, "Nothing to claim");
        self.tournaments.get_mut(id as u32).unwrap().claimed[i] = true;
        self.credit(&who, due);
        U128(due)
    }

    /// Anyone cancels a tournament unfilled after 24 h.
    pub fn cancel_tournament(&mut self, id: u64) {
        let t = self.get_t(id);
        require!(t.status == TStatus::Open, "Tournament not open");
        require!(env::block_timestamp().saturating_sub(t.created_ns) > TOURNEY_CANCEL_NS, "Not expired yet");
        self.tournaments.get_mut(id as u32).unwrap().status = TStatus::Cancelled;
        self.unlock(&t.game, t.entrants.into_iter().map(|e| e.1).collect());
    }

    /* ---------- payouts ---------- */

    /// Credits caller all owed for this match (seat pot/stake + bets).
    pub fn claim(&mut self, match_id: u64) -> U128 {
        let who = env::predecessor_account_id();
        let m = self.get_match_internal(match_id);
        let (seat, seat_amt) = self.player_due(&m, &who);
        let key = (match_id, who.clone());
        let settle_amt = self.positions.get(&key).map(|p| position_due(&m, p)).unwrap_or(0);
        let total = seat_amt + settle_amt;
        require!(total > 0, "Nothing to claim");
        if let Some(s) = seat.filter(|_| seat_amt > 0) {
            self.get_mut(match_id).claimed[s] = true;
        }
        if settle_amt > 0 {
            self.positions.get_mut(&key).unwrap().claimed = true;
        }
        self.credit(&who, total);
        U128(total)
    }

    /* ---------- views ---------- */

    pub fn get_game(&self, game: String) -> Option<Game> {
        self.games.get(&game).cloned()
    }

    pub fn list_games(&self) -> Vec<(String, Game)> {
        self.games.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_tournament(&self, id: u64) -> Option<TournamentView> {
        self.tournaments.get(id as u32).map(|t| tview(id, t))
    }

    /// Newest first. `from` = newest ids to skip.
    pub fn list_tournaments(&self, from: u64, limit: u64, game: Option<String>) -> Vec<TournamentView> {
        newest(self.tournaments.len(), from)
            .map(|id| (id, &self.tournaments[id as u32]))
            .filter(|(_, t)| game.as_ref().is_none_or(|g| *g == t.game))
            .take(limit.min(MAX_LIST) as usize)
            .map(|(id, t)| tview(id, t))
            .collect()
    }

    pub fn get_match(&self, match_id: u64) -> Option<MatchView> {
        self.matches.get(match_id as u32).map(|m| view(match_id, m))
    }

    pub fn get_position(&self, match_id: u64, account_id: AccountId) -> Option<PositionView> {
        self.positions.get(&(match_id, account_id)).map(|p| PositionView {
            shares: [U128(p.shares[0]), U128(p.shares[1])],
            paid: U128(p.paid),
            claimed: p.claimed,
        })
    }

    /// Oldest first.
    pub fn get_bets_of(&self, match_id: u64, account_id: AccountId) -> Vec<BetView> {
        let ids = self.my_bets.get(&(match_id, account_id)).cloned().unwrap_or_default();
        ids.iter().filter_map(|id| self.bets.get(&(match_id, *id)).cloned()).collect()
    }

    /// Newest first (live feed).
    pub fn get_recent_bets(&self, match_id: u64, limit: u32) -> Vec<BetView> {
        let n = self.matches.get(match_id as u32).map(|m| m.bet_count).unwrap_or(0);
        (0..limit.min(MAX_RECENT)).map_while(|i| n.checked_sub(i + 1)).filter_map(|id| self.bets.get(&(match_id, id)).cloned()).collect()
    }

    /// (ms, seat 0 bps), oldest first.
    pub fn get_prices(&self, match_id: u64) -> Vec<(u64, u16)> {
        self.history.get(&match_id).cloned().unwrap_or_default()
    }

    /// Shares `amount` buys now (after fee).
    pub fn quote_buy(&self, match_id: u64, side: u8, amount: U128) -> U128 {
        let m = self.get_match_internal(match_id);
        let x = amount.0 - amount.0 * self.fee_bps as u128 / BPS;
        U128(amm_buy(m.amm, side.min(1) as usize, x).0)
    }

    pub fn claimable(&self, match_id: u64, account_id: AccountId) -> U128 {
        let Some(m) = self.matches.get(match_id as u32) else { return U128(0) };
        let seat = self.player_due(m, &account_id).1;
        let pos = self.positions.get(&(match_id, account_id)).map(|p| position_due(m, p)).unwrap_or(0);
        U128(seat + pos)
    }

    /// Newest first. `from` = newest ids to skip.
    pub fn list_matches(&self, from: u64, limit: u64, game: Option<String>) -> Vec<MatchView> {
        newest(self.matches.len(), from)
            .map(|id| (id, &self.matches[id as u32]))
            .filter(|(_, m)| game.as_ref().is_none_or(|g| *g == m.game))
            .take(limit.min(MAX_LIST) as usize)
            .map(|(id, m)| view(id, m))
            .collect()
    }

    pub fn config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            fee_bps: self.fee_bps,
            min_bet: U128(self.min_bet),
            max_bet: U128(self.max_bet),
            seed: U128(self.seed),
            treasury: U128(self.treasury),
        }
    }

    /* ---------- owner ---------- */

    /// Upsert.
    #[payable]
    pub fn register_game(&mut self, game: String, referee_id: AccountId, assets_id: Option<AccountId>) {
        self.only_owner();
        require!(!game.is_empty() && game.len() <= 32, "Bad game id");
        self.games.insert(game, Game { referee_id, assets_id });
    }

    #[payable]
    pub fn set_limits(&mut self, min_bet: U128, max_bet: U128) {
        self.only_owner();
        require!(min_bet.0 > 0 && min_bet.0 <= max_bet.0, "Bad limits");
        self.min_bet = min_bet.0;
        self.max_bet = max_bet.0;
    }

    #[payable]
    pub fn set_seed(&mut self, seed: U128) {
        self.only_owner();
        require!(seed.0 > 0, "Bad seed");
        self.seed = seed.0;
    }

    #[payable]
    pub fn fund(&mut self) {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
        self.treasury += env::attached_deposit().as_yoctonear();
    }

    #[payable]
    pub fn withdraw_treasury(&mut self, amount: U128) -> Promise {
        self.only_owner();
        require!(amount.0 <= self.treasury, "Exceeds treasury");
        self.treasury -= amount.0;
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }
}

impl Arena {
    /// 1 yocto: fn-call key can't trigger.
    fn only_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only owner");
    }
    fn only_referee(&self, game: &str) {
        require!(env::predecessor_account_id() == self.game(game).referee_id, "Only referee");
    }
    fn game(&self, game: &str) -> Game {
        self.games.get(game).cloned().unwrap_or_else(|| env::panic_str("Unknown game"))
    }
    /// None if game dropped assets mid-match: locks then just expire.
    fn assets(&self, game: &str) -> Option<AccountId> {
        self.games.get(game).and_then(|g| g.assets_id.clone())
    }
    fn credit(&mut self, who: &AccountId, amt: u128) {
        if amt > 0 {
            *self.balances.entry(who.clone()).or_insert(0) += amt;
        }
    }
    fn debit(&mut self, who: &AccountId, amt: u128) {
        if amt == 0 {
            return;
        }
        let b = self.balances.get_mut(who).filter(|b| **b >= amt).unwrap_or_else(|| env::panic_str("Insufficient balance"));
        *b -= amt;
    }
    fn get_mut(&mut self, id: u64) -> &mut Match {
        self.matches.get_mut(id as u32).unwrap_or_else(|| env::panic_str("No such match"))
    }
    fn get_match_internal(&self, id: u64) -> Match {
        self.matches.get(id as u32).cloned().unwrap_or_else(|| env::panic_str("No such match"))
    }

    fn get_t(&self, id: u64) -> Tournament {
        self.tournaments.get(id as u32).cloned().unwrap_or_else(|| env::panic_str("No such tournament"))
    }

    fn unlock(&self, game: &str, locks: Vec<Lock>) {
        if let (false, Some(a)) = (locks.is_empty(), self.assets(game)) {
            ext_assets::ext(a).with_static_gas(UNLOCK_GAS).unlock(locks).detach();
        }
    }

    /// Failed lock callback: re-credit, unlock if we did lock.
    fn bounce(&mut self, game: &str, who: AccountId, amount: u128, locked: Option<Lock>) {
        self.credit(&who, amount);
        self.unlock(game, locked.into_iter().collect());
    }

    /// Spectator betting is independent of the players' stake: any bettable room gets the config seed.
    // ponytail: colluding players can throw a bettable room to take up to `seed` per match; keep seed small (set_seed), add per-host limits if abused
    fn seed_for(&self, _stake: u128, bettable: bool) -> u128 {
        if bettable { self.seed } else { 0 }
    }

    /// Seed (0 = not bettable) comes out of treasury here; `finish` returns it.
    fn open_match(&mut self, game: String, host: AccountId, stake: u128, seed: u128, monster: Option<Lock>) -> u64 {
        require!(self.treasury >= seed, "House can't fund bets right now");
        self.treasury -= seed;
        let id = self.matches.len() as u64;
        self.matches.push(Match {
            game,
            host,
            guest: None,
            stake,
            bettable: seed > 0,
            status: Status::Open,
            kos: 0,
            amm: [seed; 2],
            seed,
            collateral: seed,
            bet_count: 0,
            created_ns: env::block_timestamp(),
            started_ns: 0,
            claimed: [false; 2],
            advances: 0,
            monsters: [monster, None],
            tournament: None,
            tape_hash: None,
        });
        id
    }

    fn go_live(&mut self, id: u64, guest: AccountId, monster: Option<Lock>) {
        let m = self.get_mut(id);
        m.guest = Some(guest);
        m.monsters[1] = monster;
        m.status = Status::Live;
        m.started_ns = env::block_timestamp();
        if m.bettable {
            self.push_price(id);
        }
    }

    /// Zero-stake Live bracket match; bettable only if house can seed now.
    fn tourney_match(&mut self, tid: u64, round: u8, slot: u8, a: (AccountId, Lock), b: (AccountId, Lock)) {
        let t = &self.tournaments[tid as u32];
        let seed = if t.bettable && self.treasury >= self.seed { self.seed } else { 0 };
        let id = self.open_match(t.game.clone(), a.0, 0, seed, Some(a.1));
        self.get_mut(id).tournament = Some((tid, round, slot));
        self.go_live(id, b.0, Some(b.1));
        self.tournaments.get_mut(tid as u32).unwrap().rounds[round as usize][slot as usize] = Some(id);
    }

    fn after(&mut self, id: u64, kos: [u8; 2]) {
        let m = self.get_match_internal(id);
        let Some((tid, round, slot)) = m.tournament else {
            return self.unlock(&m.game, m.monsters.into_iter().flatten().collect());
        };
        // void/expired: more reported KOs advances, tie -> seat 0 (lower entrant index)
        let w = match m.status {
            Status::Settled(w) => w as usize,
            _ => (kos[1] > kos[0]) as usize,
        };
        self.get_mut(id).advances = w as u8;
        self.unlock(&m.game, m.monsters[1 - w].clone().into_iter().collect());
        let t = self.get_t(tid);
        let (r, s) = (round as usize, slot as usize);
        if r + 1 == t.rounds.len() {
            let mon = m.monsters[w].clone().unwrap();
            self.treasury += t.pot * self.fee_bps as u128 / BPS;
            let t = self.tournaments.get_mut(tid as u32).unwrap();
            t.status = TStatus::Done;
            t.champion = Some(seat_account(&m, w));
            if let Some(a) = self.assets(&m.game) {
                ext_assets::ext(a).with_static_gas(TITLE_GAS).add_title(mon.0.clone(), format!("Tournament #{tid} Champion")).detach();
            }
            return self.unlock(&m.game, vec![mon]);
        }
        let Some(sib) = t.rounds[r][s ^ 1].map(|i| self.get_match_internal(i)) else { return };
        if matches!(sib.status, Status::Open | Status::Live) {
            return;
        }
        let ws = sib.advances as usize;
        let me = (seat_account(&m, w), m.monsters[w].clone().unwrap());
        let them = (seat_account(&sib, ws), sib.monsters[ws].clone().unwrap());
        let (a, b) = if s % 2 == 0 { (me, them) } else { (them, me) };
        self.tourney_match(tid, round + 1, (s / 2) as u8, a, b);
    }

    fn tradable(&self, id: u64, who: &AccountId) -> Match {
        let m = self.get_match_internal(id);
        require!(m.bettable, "Match not bettable");
        require!(m.status == Status::Live, "Betting closed");
        require!(*who != m.host && Some(who) != m.guest.as_ref(), "Players cannot bet on their own match");
        m
    }

    /// End match, house takes its pool share: Settled(w) = pool's winning shares, Refund = seed back.
    fn finish(&mut self, id: u64, status: Status) {
        let m = self.get_mut(id);
        m.status = status;
        let house = match status {
            Status::Settled(w) => m.amm[w as usize],
            _ => m.seed,
        };
        self.treasury += house;
    }

    fn push_price(&mut self, id: u64) {
        let p = (now_ms(), price_bps(self.get_match_internal(id).amm));
        let h = self.history.entry(id).or_default();
        if h.len() >= MAX_HISTORY {
            h.remove(0);
        }
        h.push(p);
    }

    /// (seat, unclaimed) for a player.
    fn player_due(&self, m: &Match, who: &AccountId) -> (Option<usize>, u128) {
        let seat = if *who == m.host { Some(0) } else if Some(who) == m.guest.as_ref() { Some(1) } else { None };
        let Some(s) = seat else { return (None, 0) };
        if m.claimed[s] {
            return (seat, 0);
        }
        let due = match m.status {
            Status::Refund => m.stake, // host alone or both
            Status::Settled(w) if w as usize == s => {
                let pot = 2 * m.stake;
                pot - pot * self.fee_bps as u128 / BPS
            }
            _ => 0,
        };
        (seat, due)
    }
}

fn lock(g: &Game, mon: &str, who: &AccountId, until_ms: u64) -> Promise {
    let a = g.assets_id.clone().unwrap_or_else(|| env::panic_str("Game has no assets"));
    ext_assets::ext(a).with_static_gas(LOCK_GAS).lock(mon.into(), who.clone(), until_ms)
}

fn newest(len: u32, from: u64) -> impl Iterator<Item = u64> {
    (0..(len as u64).saturating_sub(from)).rev().take(MAX_SCAN)
}

/// Promise 0 not Failed. Transfers return nothing, lock's Dna unused.
fn promise_ok() -> bool {
    !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
}

fn now_ms() -> u64 {
    env::block_timestamp() / 1_000_000
}

fn seat_account(m: &Match, seat: usize) -> AccountId {
    if seat == 0 { m.host.clone() } else { m.guest.clone().unwrap() }
}

fn tview(id: u64, t: &Tournament) -> TournamentView {
    let status = match t.status {
        TStatus::Open => "open",
        TStatus::Live => "live",
        TStatus::Done => "done",
        TStatus::Cancelled => "cancelled",
    };
    TournamentView {
        id,
        game: t.game.clone(),
        size: t.size,
        entry_fee: U128(t.entry_fee),
        pot: U128(t.pot),
        bettable: t.bettable,
        status: status.into(),
        entrants: t.entrants.iter().map(|(a, m)| EntrantView { account: a.clone(), monster: m.0.clone() }).collect(),
        rounds: t.rounds.clone(),
        champion: t.champion.clone(),
        created_ms: t.created_ns / 1_000_000,
        claimed: t.claimed.clone(),
    }
}

fn position_due(m: &Match, p: &Position) -> u128 {
    if p.claimed {
        return 0;
    }
    match m.status {
        Status::Settled(w) => p.shares[w as usize],
        Status::Refund => p.paid,
        _ => 0,
    }
}

fn view(id: u64, m: &Match) -> MatchView {
    let (status, winner) = match m.status {
        Status::Open => ("open", None),
        Status::Live => ("live", None),
        Status::Settled(w) => ("settled", Some(w)),
        Status::Refund => ("refund", None),
    };
    MatchView {
        id,
        game: m.game.clone(),
        host: m.host.clone(),
        guest: m.guest.clone(),
        stake: U128(m.stake),
        bettable: m.bettable,
        status: status.into(),
        winner,
        kos: m.kos,
        amm: [U128(m.amm[0]), U128(m.amm[1])],
        price_bps: price_bps(m.amm),
        collateral: U128(m.collateral),
        created_ms: m.created_ns / 1_000_000,
        started_ms: m.started_ns / 1_000_000,
        monsters: m.monsters.clone().map(|l| l.map(|l| l.0)),
        tournament: m.tournament.map(|t| t.0),
        tape_hash: m.tape_hash.clone(),
    }
}

#[cfg(test)]
mod tests;
