//! Brawler Arena: staked 1v1 duels with a live spectator market.
//!
//! Players: host `create_match` (stake = deposit) -> guest `join_match` (same deposit) -> referee
//! `report_result` -> winner `claim`s the pot (fee `fee_bps` taken once at settlement).
//!
//! Spectators back a fighter by buying their shares on a constant-product AMM while the match is Live.
//! One A share (fighter 0 wins) plus one B share always equals 1 NEAR, so the pool is always fully
//! backed. Price of A = b / (a + b). Bets lock until the result: there is no selling. At settlement
//! each winning share redeems 1 NEAR; a void match refunds every bet (after fee).
//! The house treasury seeds each bettable match's pool (`seed`) and takes back what the pool holds
//! at the end; trade fees (`fee_bps`) go to the treasury.
//!
//! Storage for matches/positions is paid from the contract balance (min trade covers a position).
//!
//! Monsters (NFTs on the `monsters` contract) are optional for matches and required for tournaments.
//! Joining with one locks it there first (`lock`), and a `#[private]` callback does the actual
//! create/join/enter, refunding the deposit (and unlocking) if anything changed meanwhile.
//! Tournaments: entry fees build a pot; 4 or 8 entrants play a single-elimination bracket of
//! zero-stake Live matches (still bettable), champion `claim_tournament`s pot - fee.

use ethnum::U256;
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, assert_one_yocto, env,
    ext_contract, near, require,
};

const BPS: u128 = 10_000;
const EXPIRY_NS: u64 = 2 * 60 * 60 * 1_000_000_000; // 2 h
const MAX_LIST: u64 = 50;
const MAX_RECENT: u32 = 20;
const MAX_HISTORY: usize = 200; // ponytail: oldest price points drop off; store sampled history if longer charts matter
const CALLBACK_GAS: Gas = Gas::from_tgas(5);
// Callers of create/join with a monster should attach >= 100 Tgas; enter_tournament needs ENTER_GAS.
const LOCK_GAS: Gas = Gas::from_tgas(15);
const ON_LOCK_GAS: Gas = Gas::from_tgas(40);
const ON_ENTER_GAS: Gas = Gas::from_tgas(100); // the 8th entry creates 4 bettable matches
const ENTER_GAS: Gas = Gas::from_tgas(150); // lock + on_enter + enter_tournament itself
// report_result worst case (tournament final): record 20 + unlock 10 + title 10 + unlock 10 = 50 Tgas of the referee's 100.
const RECORD_GAS: Gas = Gas::from_tgas(20);
const UNLOCK_GAS: Gas = Gas::from_tgas(10);
const TITLE_GAS: Gas = Gas::from_tgas(10);
const MATCH_LOCK_MS: u64 = 5 * 60 * 60 * 1000; // 2 h open expiry + 2 h live expiry + 1 h buffer
// ponytail: 72 h covers the 24 h entry window + 3 rounds x 2 h expiry; re-lock per round if brackets get slower.
const TOURNEY_LOCK_MS: u64 = 72 * 60 * 60 * 1000;
const TOURNEY_CANCEL_NS: u64 = 24 * 60 * 60 * 1_000_000_000; // 24 h entry window, then only cancel

/// (monster token id, until_ms we locked it with). Unlock passes both, so a stale unlock can't free someone else's lock.
type Lock = (String, u64);

#[allow(dead_code)] // trait only feeds the macro
#[ext_contract(ext_monsters)]
trait Monsters {
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
    host: AccountId,
    guest: Option<AccountId>,
    stake: u128,
    bettable: bool,
    status: Status,
    kos: u8,
    amm: [u128; 2],    // pool's A and B shares
    seed: u128,        // house liquidity put in at create
    collateral: u128,  // NEAR backing the market (= every A share = every B share, pool + traders)
    bet_count: u32,
    created_ns: u64,
    started_ns: u64,
    claimed: [bool; 2], // player pot / stake refund claimed, by seat
    advances: u8,       // tournament: seat that moved on (set when it ended)
    monsters: [Option<Lock>; 2],
    tournament: Option<(u64, u8, u8)>, // (tournament id, round, slot)
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
    size: u8,
    entry_fee: u128,
    pot: u128,
    bettable: bool,
    status: TStatus,
    entrants: Vec<(AccountId, Lock)>,
    rounds: Vec<Vec<Option<u64>>>,      // match ids
    champion: Option<AccountId>,
    created_ns: u64,
    claimed: Vec<bool>, // by entrant: champion prize or cancel refund
}

/// Totals per spectator; this is what settles.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Position {
    shares: [u128; 2],
    paid: u128, // NEAR that went into the pool (after fees) = the refund on a void match
    claimed: bool,
}

/// One bet, kept for the "your bets" list and the live bet feed.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct BetView {
    pub id: u32,
    pub who: AccountId,
    pub side: u8,
    pub amount: U128, // deposit before fee
    pub shares: U128,
    pub ms: u64,
}

#[near(serializers = [json])]
pub struct MatchView {
    pub id: u64,
    pub host: AccountId,
    pub guest: Option<AccountId>,
    pub stake: U128,
    pub bettable: bool,
    pub status: String,
    pub winner: Option<u8>,
    pub kos: u8,
    pub amm: [U128; 2],
    pub price_bps: u16, // fighter 0's price, 0..10000
    pub collateral: U128,
    pub created_ms: u64,
    pub started_ms: u64,
    pub monsters: [Option<String>; 2],
    pub tournament: Option<u64>,
}

#[near(serializers = [json])]
pub struct EntrantView {
    pub account: AccountId,
    pub monster: String,
}

#[near(serializers = [json])]
pub struct TournamentView {
    pub id: u64,
    pub size: u8,
    pub entry_fee: U128,
    pub pot: U128,
    pub bettable: bool,
    pub status: String,
    pub entrants: Vec<EntrantView>,
    pub rounds: Vec<Vec<Option<u64>>>,
    pub champion: Option<AccountId>,
    pub created_ms: u64,
    pub claimed: Vec<bool>, // by entrant
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
    pub referee: AccountId,
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
    referee: AccountId,
    monsters: AccountId,
    fee_bps: u32,
    min_bet: u128,
    max_bet: u128,
    seed: u128,
    treasury: u128,
    matches: Vector<Match>, // id = index
    positions: LookupMap<(u64, AccountId), Position>,
    history: LookupMap<u64, Vec<(u64, u16)>>, // (ms, fighter 0 price bps), one point per trade
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

/// Deposit `x` NEAR for `side` shares: mint x pairs, swap the other side back in until a*b holds.
/// Returns (shares out, new reserves). Rounds against the trader.
fn amm_buy(r: [u128; 2], side: usize, x: u128) -> (u128, [u128; 2]) {
    let o = 1 - side;
    let k = U256::from(r[0]) * U256::from(r[1]);
    let ro = U256::from(r[o] + x);
    let keep = ((k + ro - 1) / ro).as_u128(); // ceil
    let mut n = r;
    n[o] = r[o] + x;
    n[side] = keep;
    (r[side] + x - keep, n)
}

#[near]
impl Arena {
    #[init]
    pub fn new(owner_id: AccountId, referee_id: AccountId, monsters_id: AccountId) -> Self {
        Self {
            owner: owner_id,
            referee: referee_id,
            monsters: monsters_id,
            fee_bps: 10, // 0.1%
            min_bet: NearToken::from_millinear(10).as_yoctonear(),
            max_bet: NearToken::from_near(100).as_yoctonear(),
            seed: NearToken::from_near(5).as_yoctonear(),
            treasury: 0,
            matches: Vector::new(Key::Matches),
            positions: LookupMap::new(Key::Positions),
            history: LookupMap::new(Key::History),
            bets: LookupMap::new(Key::Bets),
            my_bets: LookupMap::new(Key::MyBets),
            tournaments: Vector::new(Key::Tournaments),
        }
    }

    /* ---------- players ---------- */

    /// With a monster this locks it first and returns `on_create`'s result (`null` = refunded).
    #[payable]
    pub fn create_match(&mut self, bettable: bool, monster_id: Option<String>) -> PromiseOrValue<Option<u64>> {
        let host = env::predecessor_account_id();
        let stake = env::attached_deposit().as_yoctonear();
        require!(!bettable || self.treasury >= self.seed, "House can't fund bets right now");
        let Some(mon) = monster_id else {
            return PromiseOrValue::Value(Some(self.open_match(host, stake, bettable, None)));
        };
        let until = now_ms() + MATCH_LOCK_MS;
        PromiseOrValue::Promise(self.lock(&mon, &host, until).then(
            Self::ext(env::current_account_id()).with_static_gas(ON_LOCK_GAS).on_create(host, U128(stake), bettable, mon, until),
        ))
    }

    /// Seed is taken here, not in `create_match`, so a concurrent create can't overdraw the treasury.
    #[private]
    pub fn on_create(&mut self, host: AccountId, stake: U128, bettable: bool, monster_id: String, until_ms: u64) -> Option<u64> {
        let locked = promise_ok();
        if locked && (!bettable || self.treasury >= self.seed) {
            return Some(self.open_match(host, stake.0, bettable, Some((monster_id, until_ms))));
        }
        self.bounce(host, stake.0, locked.then_some((monster_id, until_ms)));
        None
    }

    /// With a monster this locks it first and returns `on_join`'s result (false = refunded).
    #[payable]
    pub fn join_match(&mut self, match_id: u64, monster_id: Option<String>) -> PromiseOrValue<bool> {
        let guest = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        let m = self.get_match_internal(match_id);
        require!(m.status == Status::Open, "Match not open");
        require!(guest != m.host, "Host cannot join own match");
        require!(deposit == m.stake, "Deposit must equal stake");
        let Some(mon) = monster_id else {
            self.go_live(match_id, guest, None);
            return PromiseOrValue::Value(true);
        };
        let until = now_ms() + MATCH_LOCK_MS;
        PromiseOrValue::Promise(self.lock(&mon, &guest, until).then(
            Self::ext(env::current_account_id()).with_static_gas(ON_LOCK_GAS).on_join(match_id, guest, U128(deposit), mon, until),
        ))
    }

    /// Someone else may have joined (or the host cancelled) while the lock was in flight.
    #[private]
    pub fn on_join(&mut self, match_id: u64, guest: AccountId, deposit: U128, monster_id: String, until_ms: u64) -> bool {
        let locked = promise_ok();
        let m = self.get_match_internal(match_id);
        if locked && m.status == Status::Open && deposit.0 == m.stake {
            self.go_live(match_id, guest, Some((monster_id, until_ms)));
            return true;
        }
        self.bounce(guest, deposit.0, locked.then_some((monster_id, until_ms)));
        false
    }

    /// Host backs out before anyone joins; stake goes straight back.
    pub fn cancel_match(&mut self, match_id: u64) {
        let m = self.get_mut(match_id);
        require!(env::predecessor_account_id() == m.host, "Only host");
        require!(m.status == Status::Open, "Match not open");
        self.finish(match_id, Status::Refund);
        self.after(match_id);
        if self.get_match_internal(match_id).stake > 0 {
            self.claim(match_id);
        }
    }

    /* ---------- spectators ---------- */

    /// Back `side` with the attached deposit. Locked until the result.
    #[payable]
    pub fn buy(&mut self, match_id: u64, side: u8, min_out: U128) -> U128 {
        let who = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(side <= 1, "side must be 0 or 1");
        require!(amount >= self.min_bet, "Bet below minimum");
        require!(amount <= self.max_bet, "Bet above maximum");
        let fee = amount * self.fee_bps as u128 / BPS;
        let x = amount - fee;
        let m = self.tradable(match_id, &who);
        let (out, amm) = amm_buy(m.amm, side as usize, x);
        require!(out >= min_out.0, "Price moved, try again");

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
        let ms = env::block_timestamp() / 1_000_000;
        self.bets.insert((match_id, id), BetView { id, who, side, amount: U128(amount), shares: U128(out), ms });
        self.my_bets.entry(key).or_default().push(id);
        self.treasury += fee;
        self.push_price(match_id);
        U128(out)
    }

    /* ---------- referee ---------- */

    pub fn report_kos(&mut self, match_id: u64, kos: u8) {
        self.only_referee();
        let m = self.get_mut(match_id);
        require!(m.status == Status::Live, "Match not live");
        if kos > m.kos {
            m.kos = kos;
        }
    }

    /// `kos[i]` = KOs scored by seat i (monster record only).
    pub fn report_result(&mut self, match_id: u64, winner: Option<u8>, kos: Option<[u8; 2]>) {
        self.only_referee();
        let m = self.get_match_internal(match_id);
        require!(m.status == Status::Live, "Match not live");
        let status = match winner {
            None => Status::Refund,
            Some(w) => {
                require!(w <= 1, "winner must be 0 or 1");
                self.treasury += 2 * m.stake * self.fee_bps as u128 / BPS;
                Status::Settled(w)
            }
        };
        self.finish(match_id, status);
        if m.monsters.iter().any(Option::is_some) {
            ext_monsters::ext(self.monsters.clone())
                .with_static_gas(RECORD_GAS)
                .record_result(match_id, m.monsters.clone().map(|l| l.map(|l| l.0)), winner, kos.unwrap_or_default(), m.tournament.map(|t| t.0))
                .detach();
        }
        self.after(match_id);
    }

    /// Anyone may void a match the referee never settled (or nobody joined) after 2 h.
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
        self.after(match_id);
    }

    /* ---------- tournaments ---------- */

    #[payable]
    pub fn create_tournament(&mut self, size: u8, entry_fee: U128, bettable: bool) -> u64 {
        self.only_owner();
        require!(size == 4 || size == 8, "Size must be 4 or 8");
        let rounds = (0..size.trailing_zeros()).map(|r| vec![None; (size >> (r + 1)) as usize]).collect();
        let id = self.tournaments.len() as u64;
        self.tournaments.push(Tournament {
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

    /// Locks the monster for 72 h, then `on_enter` registers (false = refunded).
    #[payable]
    pub fn enter_tournament(&mut self, id: u64, monster_id: String) -> Promise {
        let who = env::predecessor_account_id();
        let fee = env::attached_deposit().as_yoctonear();
        let t = self.get_t(id);
        require!(t.status == TStatus::Open, "Tournament not open");
        require!(fee == t.entry_fee, "Deposit must equal entry fee");
        require!(env::block_timestamp().saturating_sub(t.created_ns) <= TOURNEY_CANCEL_NS, "Entry closed");
        require!(!t.entrants.iter().any(|e| e.0 == who), "Already entered");
        // Fail here (runtime refunds the deposit) rather than run out of gas in on_enter after the lock.
        require!(env::prepaid_gas() >= ENTER_GAS, "Attach 150 Tgas");
        let until = now_ms() + TOURNEY_LOCK_MS;
        self.lock(&monster_id, &who, until).then(
            Self::ext(env::current_account_id()).with_static_gas(ON_ENTER_GAS).on_enter(id, who, U128(fee), monster_id, until),
        )
    }

    /// No panics past the lookup: the fee ends up in the pot or bounced.
    #[private]
    pub fn on_enter(&mut self, id: u64, account_id: AccountId, fee: U128, monster_id: String, until_ms: u64) -> bool {
        let locked = promise_ok();
        let t = self.get_t(id);
        if !locked || t.status != TStatus::Open || t.entrants.iter().any(|e| e.0 == account_id) {
            self.bounce(account_id, fee.0, locked.then_some((monster_id, until_ms)));
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

    /// Champion: pot - fee. Cancelled: each entrant their fee back.
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
        Promise::new(who)
            .transfer(NearToken::from_yoctonear(due))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_claim_tournament(id, i as u8))
            .detach();
        U128(due)
    }

    #[private]
    pub fn on_claim_tournament(&mut self, id: u64, entrant: u8) -> bool {
        if promise_ok() {
            return true;
        }
        self.tournaments.get_mut(id as u32).unwrap().claimed[entrant as usize] = false;
        false
    }

    /// Anyone may cancel a tournament that didn't fill within 24 h.
    pub fn cancel_tournament(&mut self, id: u64) {
        let t = self.get_t(id);
        require!(t.status == TStatus::Open, "Tournament not open");
        require!(env::block_timestamp().saturating_sub(t.created_ns) > TOURNEY_CANCEL_NS, "Not expired yet");
        self.tournaments.get_mut(id as u32).unwrap().status = TStatus::Cancelled;
        self.unlock(t.entrants.into_iter().map(|e| e.1).collect());
    }

    /// A `bounce` refund that didn't land goes to the treasury.
    // ponytail: owner refunds by hand from the treasury; track per-account credits if this ever happens.
    #[private]
    pub fn on_refund(&mut self, amount: U128) -> bool {
        if promise_ok() {
            return true;
        }
        self.treasury += amount.0;
        false
    }

    /* ---------- payouts ---------- */

    /// Pays the caller everything they are owed for this match (player pot/stake and/or bets).
    pub fn claim(&mut self, match_id: u64) -> U128 {
        let who = env::predecessor_account_id();
        let m = self.get_match_internal(match_id);
        let (seat, seat_amt) = self.player_due(&m, &who);
        let key = (match_id, who.clone());
        let settle_amt = self.positions.get(&key).map(|p| position_due(&m, p)).unwrap_or(0);
        let total = seat_amt + settle_amt;
        require!(total > 0, "Nothing to claim");

        let paid_seat = seat.filter(|_| seat_amt > 0);
        if let Some(s) = paid_seat {
            self.get_mut(match_id).claimed[s] = true;
        }
        let paid_pos = settle_amt > 0;
        if paid_pos {
            self.positions.get_mut(&key).unwrap().claimed = true;
        }
        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(total))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_claim(match_id, who, paid_seat.map(|s| s as u8), paid_pos),
            )
            .detach();
        U128(total)
    }

    /// Restores claimed flags if the transfer failed, so the user can retry.
    #[private]
    pub fn on_claim(&mut self, match_id: u64, account_id: AccountId, seat: Option<u8>, position: bool) -> bool {
        if promise_ok() {
            return true;
        }
        if let Some(s) = seat {
            self.get_mut(match_id).claimed[s as usize] = false;
        }
        if position {
            if let Some(p) = self.positions.get_mut(&(match_id, account_id)) {
                p.claimed = false;
            }
        }
        false
    }

    /* ---------- views ---------- */

    pub fn get_tournament(&self, id: u64) -> Option<TournamentView> {
        self.tournaments.get(id as u32).map(|t| tview(id, t))
    }

    /// Newest first. `from` = how many of the newest to skip.
    pub fn list_tournaments(&self, from: u64, limit: u64) -> Vec<TournamentView> {
        let len = self.tournaments.len() as u64;
        (0..limit.min(MAX_LIST)).map_while(|i| len.checked_sub(from + i + 1)).map(|id| tview(id, &self.tournaments[id as u32])).collect()
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

    /// One account's bets on a match, oldest first.
    pub fn get_bets_of(&self, match_id: u64, account_id: AccountId) -> Vec<BetView> {
        let ids = self.my_bets.get(&(match_id, account_id)).cloned().unwrap_or_default();
        ids.iter().filter_map(|id| self.bets.get(&(match_id, *id)).cloned()).collect()
    }

    /// Latest bets on a match, newest first (for the live feed).
    pub fn get_recent_bets(&self, match_id: u64, limit: u32) -> Vec<BetView> {
        let n = self.matches.get(match_id as u32).map(|m| m.bet_count).unwrap_or(0);
        (0..limit.min(MAX_RECENT)).map_while(|i| n.checked_sub(i + 1)).filter_map(|id| self.bets.get(&(match_id, id)).cloned()).collect()
    }

    /// Price points (ms, fighter 0 price bps), oldest first.
    pub fn get_prices(&self, match_id: u64) -> Vec<(u64, u16)> {
        self.history.get(&match_id).cloned().unwrap_or_default()
    }

    /// Shares a deposit of `amount` would buy right now (after fee).
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

    /// Newest first. `from` = how many of the newest matches to skip.
    pub fn list_matches(&self, from: u64, limit: u64) -> Vec<MatchView> {
        let len = self.matches.len() as u64;
        (0..limit.min(MAX_LIST))
            .map_while(|i| len.checked_sub(from + i + 1))
            .map(|id| view(id, &self.matches[id as u32]))
            .collect()
    }

    pub fn config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            referee: self.referee.clone(),
            fee_bps: self.fee_bps,
            min_bet: U128(self.min_bet),
            max_bet: U128(self.max_bet),
            seed: U128(self.seed),
            treasury: U128(self.treasury),
        }
    }

    /* ---------- owner ---------- */

    #[payable]
    pub fn set_referee(&mut self, referee_id: AccountId) {
        self.only_owner();
        self.referee = referee_id;
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

    /// Owner tops up the treasury that seeds match pools.
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
    /// Owner actions need 1 yoctoNEAR so a function-call key can't trigger them.
    fn only_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only owner");
    }
    fn only_referee(&self) {
        require!(env::predecessor_account_id() == self.referee, "Only referee");
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

    fn lock(&self, mon: &str, who: &AccountId, until_ms: u64) -> Promise {
        ext_monsters::ext(self.monsters.clone()).with_static_gas(LOCK_GAS).lock(mon.into(), who.clone(), until_ms)
    }

    fn unlock(&self, locks: Vec<Lock>) {
        if !locks.is_empty() {
            ext_monsters::ext(self.monsters.clone()).with_static_gas(UNLOCK_GAS).unlock(locks).detach();
        }
    }

    /// Failed lock callback: deposit back, monster unlocked if we did lock it.
    fn bounce(&self, who: AccountId, amount: u128, locked: Option<Lock>) {
        if amount > 0 {
            Promise::new(who)
                .transfer(NearToken::from_yoctonear(amount))
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_refund(U128(amount)))
                .detach();
        }
        self.unlock(locked.into_iter().collect());
    }

    /// Seed for a bettable match comes out of the treasury here.
    fn open_match(&mut self, host: AccountId, stake: u128, bettable: bool, monster: Option<Lock>) -> u64 {
        let seed = if bettable {
            require!(self.treasury >= self.seed, "House can't fund bets right now");
            self.treasury -= self.seed;
            self.seed
        } else {
            0
        };
        let id = self.matches.len() as u64;
        self.matches.push(Match {
            host,
            guest: None,
            stake,
            bettable,
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

    /// Zero-stake Live bracket match; bettable only if the house can seed it right now.
    fn tourney_match(&mut self, tid: u64, round: u8, slot: u8, a: (AccountId, Lock), b: (AccountId, Lock)) {
        let bettable = self.tournaments[tid as u32].bettable && self.treasury >= self.seed;
        let id = self.open_match(a.0, 0, bettable, Some(a.1));
        self.get_mut(id).tournament = Some((tid, round, slot));
        self.go_live(id, b.0, Some(b.1));
        self.tournaments.get_mut(tid as u32).unwrap().rounds[round as usize][slot as usize] = Some(id);
    }

    /// After a match ends: free its monsters, or move the tournament bracket on.
    fn after(&mut self, id: u64) {
        let m = self.get_match_internal(id);
        let Some((tid, round, slot)) = m.tournament else {
            return self.unlock(m.monsters.into_iter().flatten().collect());
        };
        // ponytail: a void (or expired) bracket match advances a random seat (random_seed: block producer could bias it);
        // replay voids if fairness matters.
        let w = match m.status {
            Status::Settled(w) => w as usize,
            _ => (env::random_seed()[0] & 1) as usize,
        };
        self.get_mut(id).advances = w as u8;
        self.unlock(m.monsters[1 - w].clone().into_iter().collect());
        let t = self.get_t(tid);
        let (r, s) = (round as usize, slot as usize);
        if r + 1 == t.rounds.len() {
            let mon = m.monsters[w].clone().unwrap();
            self.treasury += t.pot * self.fee_bps as u128 / BPS;
            let t = self.tournaments.get_mut(tid as u32).unwrap();
            t.status = TStatus::Done;
            t.champion = Some(seat_account(&m, w));
            ext_monsters::ext(self.monsters.clone()).with_static_gas(TITLE_GAS).add_title(mon.0.clone(), format!("Tournament #{tid} Champion")).detach();
            return self.unlock(vec![mon]);
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

    /// Match a spectator `who` may trade on right now.
    fn tradable(&self, id: u64, who: &AccountId) -> Match {
        let m = self.get_match_internal(id);
        require!(m.bettable, "Match not bettable");
        require!(m.status == Status::Live, "Betting closed");
        require!(*who != m.host && Some(who) != m.guest.as_ref(), "Players cannot bet on their own match");
        m
    }

    /// Ends a match and hands the house its share of the pool.
    /// Settled(w): the pool's own winning shares. Refund: bets are refunded in full, so the house gets its seed back.
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
        let p = (env::block_timestamp() / 1_000_000, price_bps(self.get_match_internal(id).amm));
        let h = self.history.entry(id).or_default();
        if h.len() >= MAX_HISTORY {
            h.remove(0);
        }
        h.push(p);
    }

    /// (seat, unclaimed amount) for a player of this match.
    fn player_due(&self, m: &Match, who: &AccountId) -> (Option<usize>, u128) {
        let seat = if *who == m.host { Some(0) } else if Some(who) == m.guest.as_ref() { Some(1) } else { None };
        let Some(s) = seat else { return (None, 0) };
        if m.claimed[s] {
            return (seat, 0);
        }
        let due = match m.status {
            Status::Refund => m.stake, // host alone (Open/cancel/expire) or both players
            Status::Settled(w) if w as usize == s => {
                let pot = 2 * m.stake;
                pot - pot * self.fee_bps as u128 / BPS
            }
            _ => 0,
        };
        (seat, due)
    }
}

/// Promise 0 didn't fail. Transfers return nothing and `lock`'s Dna isn't needed, so anything but Failed is success.
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

/// Settlement payout for a position.
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
    }
}

#[cfg(test)]
mod tests;
