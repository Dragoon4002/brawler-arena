//! Brawler Arena: staked 1v1 duels with live pari-mutuel betting.
//!
//! Flow: host `create_match` (stake = deposit) -> guest `join_match` (same deposit) -> spectators
//! `place_bet` while Live (later bets weighted down by KOs reported so far) -> referee
//! `report_result` -> everyone `claim`s. Fee (`fee_bps`) is taken from the winner pot and from the
//! losing betting pool, once, at settlement, into `treasury`.
//!
//! Storage for matches/bets is paid from the contract balance (min bet covers a bet's bytes).

use ethnum::U256;
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, assert_one_yocto, env, near, require,
};

const BPS: u128 = 10_000;
const EXPIRY_NS: u64 = 2 * 60 * 60 * 1_000_000_000; // 2 h
const MAX_LIST: u64 = 50;
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Matches,
    Bets,
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
    pool: [u128; 2],
    weight: [u128; 2],
    created_ns: u64,
    started_ns: u64,
    claimed: [bool; 2], // player pot / stake refund claimed, by seat
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Bet {
    side: u8,
    amount: u128,
    weight: u128,
    claimed: bool,
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
    pub pool: [U128; 2],
    pub created_ms: u64,
    pub started_ms: u64,
}

#[near(serializers = [json])]
pub struct BetView {
    pub side: u8,
    pub amount: U128,
    pub weight: U128,
    pub claimed: bool,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub referee: AccountId,
    pub fee_bps: u32,
    pub min_bet: U128,
    pub max_bet: U128,
    pub treasury: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    owner: AccountId,
    referee: AccountId,
    fee_bps: u32,
    min_bet: u128,
    max_bet: u128,
    treasury: u128,
    matches: Vector<Match>, // id = index
    bets: LookupMap<(u64, AccountId), Bet>,
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

#[near]
impl Arena {
    #[init]
    pub fn new(owner_id: AccountId, referee_id: AccountId) -> Self {
        Self {
            owner: owner_id,
            referee: referee_id,
            fee_bps: 10, // 0.1%
            min_bet: NearToken::from_millinear(10).as_yoctonear(),
            max_bet: NearToken::from_near(100).as_yoctonear(),
            treasury: 0,
            matches: Vector::new(Key::Matches),
            bets: LookupMap::new(Key::Bets),
        }
    }

    /* ---------- players ---------- */

    #[payable]
    pub fn create_match(&mut self, bettable: bool) -> u64 {
        let id = self.matches.len() as u64;
        self.matches.push(Match {
            host: env::predecessor_account_id(),
            guest: None,
            stake: env::attached_deposit().as_yoctonear(),
            bettable,
            status: Status::Open,
            kos: 0,
            pool: [0; 2],
            weight: [0; 2],
            created_ns: env::block_timestamp(),
            started_ns: 0,
            claimed: [false; 2],
        });
        id
    }

    #[payable]
    pub fn join_match(&mut self, match_id: u64) {
        let guest = env::predecessor_account_id();
        let m = self.get_mut(match_id);
        require!(m.status == Status::Open, "Match not open");
        require!(guest != m.host, "Host cannot join own match");
        require!(env::attached_deposit().as_yoctonear() == m.stake, "Deposit must equal stake");
        m.guest = Some(guest);
        m.status = Status::Live;
        m.started_ns = env::block_timestamp();
    }

    /// Host backs out before anyone joins; stake goes straight back.
    pub fn cancel_match(&mut self, match_id: u64) {
        let m = self.get_mut(match_id);
        require!(env::predecessor_account_id() == m.host, "Only host");
        require!(m.status == Status::Open, "Match not open");
        m.status = Status::Refund;
        if m.stake > 0 {
            self.claim(match_id);
        }
    }

    /* ---------- spectators ---------- */

    #[payable]
    pub fn place_bet(&mut self, match_id: u64, side: u8) {
        let who = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(side <= 1, "side must be 0 or 1");
        let (min, max) = (self.min_bet, self.max_bet);
        let m = self.get_mut(match_id);
        require!(m.bettable, "Match not bettable");
        require!(m.status == Status::Live, "Betting closed");
        require!(who != m.host && Some(&who) != m.guest.as_ref(), "Players cannot bet on their own match");
        // Later bets count less: 100% at 0 KOs, -30% per KO, floor 10%.
        let pct = 100u128.saturating_sub(30 * m.kos as u128).max(10);
        let weight = amount * pct / 100;
        m.pool[side as usize] += amount;
        m.weight[side as usize] += weight;

        let key = (match_id, who);
        let bet = match self.bets.get(&key) {
            Some(b) => {
                require!(b.side == side, "Cannot bet on both sides");
                Bet { side, amount: b.amount + amount, weight: b.weight + weight, claimed: false }
            }
            None => Bet { side, amount, weight, claimed: false },
        };
        require!(amount >= min, "Bet below minimum");
        require!(bet.amount <= max, "Bet above maximum");
        self.bets.insert(key, bet);
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

    pub fn report_result(&mut self, match_id: u64, winner: Option<u8>) {
        self.only_referee();
        let fee_bps = self.fee_bps as u128;
        let m = self.get_mut(match_id);
        require!(m.status == Status::Live, "Match not live");
        let fee = match winner {
            None => {
                m.status = Status::Refund;
                0
            }
            Some(w) => {
                require!(w <= 1, "winner must be 0 or 1");
                m.status = Status::Settled(w);
                let w = w as usize;
                let pot_fee = 2 * m.stake * fee_bps / BPS;
                let pool_fee = if m.weight[w] > 0 { m.pool[1 - w] * fee_bps / BPS } else { 0 };
                pot_fee + pool_fee
            }
        };
        self.treasury += fee;
    }

    /// Anyone may void a match the referee never settled (or nobody joined) after 2 h.
    pub fn expire(&mut self, match_id: u64) {
        let now = env::block_timestamp();
        let m = self.get_mut(match_id);
        let since = match m.status {
            Status::Open => m.created_ns,
            Status::Live => m.started_ns,
            _ => env::panic_str("Match already finished"),
        };
        require!(now.saturating_sub(since) > EXPIRY_NS, "Not expired yet");
        m.status = Status::Refund;
    }

    /* ---------- payouts ---------- */

    /// Pays the caller everything they are owed for this match (player pot/stake and/or bet).
    pub fn claim(&mut self, match_id: u64) -> U128 {
        let who = env::predecessor_account_id();
        let m = self.get_match_internal(match_id);
        let (seat, seat_amt) = self.player_due(&m, &who);
        let key = (match_id, who.clone());
        let bet_amt = self.bets.get(&key).filter(|b| !b.claimed).map(|b| self.bet_due(&m, b)).unwrap_or(0);
        let total = seat_amt + bet_amt;
        require!(total > 0, "Nothing to claim");

        let paid_seat = seat.filter(|_| seat_amt > 0);
        if let Some(s) = paid_seat {
            self.get_mut(match_id).claimed[s] = true;
        }
        let paid_bet = bet_amt > 0;
        if paid_bet {
            self.bets.get_mut(&key).unwrap().claimed = true;
        }
        Promise::new(who.clone()).transfer(NearToken::from_yoctonear(total)).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_claim(match_id, who, paid_seat.map(|s| s as u8), paid_bet),
        )
        .detach();
        U128(total)
    }

    /// Restores claimed flags if the transfer failed, so the user can retry.
    #[private]
    pub fn on_claim(&mut self, match_id: u64, account_id: AccountId, seat: Option<u8>, bet: bool) -> bool {
        // Transfers return no data, so anything but Failed is success.
        if !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed)) {
            return true;
        }
        if let Some(s) = seat {
            self.get_mut(match_id).claimed[s as usize] = false;
        }
        if bet {
            if let Some(b) = self.bets.get_mut(&(match_id, account_id)) {
                b.claimed = false;
            }
        }
        false
    }

    /* ---------- views ---------- */

    pub fn get_match(&self, match_id: u64) -> Option<MatchView> {
        self.matches.get(match_id as u32).map(|m| view(match_id, m))
    }

    pub fn get_bet(&self, match_id: u64, account_id: AccountId) -> Option<BetView> {
        self.bets.get(&(match_id, account_id)).map(|b| BetView {
            side: b.side,
            amount: U128(b.amount),
            weight: U128(b.weight),
            claimed: b.claimed,
        })
    }

    pub fn claimable(&self, match_id: u64, account_id: AccountId) -> U128 {
        let Some(m) = self.matches.get(match_id as u32) else { return U128(0) };
        let seat = self.player_due(m, &account_id).1;
        let bet = self.bets.get(&(match_id, account_id)).filter(|b| !b.claimed).map(|b| self.bet_due(m, b)).unwrap_or(0);
        U128(seat + bet)
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

    fn bet_due(&self, m: &Match, b: &Bet) -> u128 {
        match m.status {
            Status::Refund => b.amount,
            Status::Settled(w) => {
                let w = w as usize;
                if m.weight[w] == 0 {
                    b.amount // nobody backed the winner: everyone refunded, no fee
                } else if b.side as usize == w {
                    let losing = m.pool[1 - w];
                    let net = losing - losing * self.fee_bps as u128 / BPS;
                    b.amount + mul_div(net, b.weight, m.weight[w])
                } else {
                    0
                }
            }
            _ => 0,
        }
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
        pool: [U128(m.pool[0]), U128(m.pool[1])],
        created_ms: m.created_ns / 1_000_000,
        started_ms: m.started_ns / 1_000_000,
    }
}

#[cfg(test)]
mod tests;
