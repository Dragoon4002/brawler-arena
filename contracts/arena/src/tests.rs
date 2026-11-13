use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const N: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn as_(who: &str, deposit: u128) {
    as_at(who, deposit, 0);
}

fn as_at(who: &str, deposit: u128, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts);
    testing_env!(b.build());
}

const SEED: u128 = 5 * N;

/// Fresh contract with a treasury that can seed two matches.
fn setup() -> Arena {
    as_("arena", 0);
    let mut c = Arena::new(acc("arena"), acc("ref"));
    as_("arena", 2 * SEED);
    c.fund();
    c
}

/// Live bettable match 0 between host and guest with `stake` each.
fn live(stake: u128) -> Arena {
    let mut c = setup();
    as_("host", stake);
    assert_eq!(c.create_match(true), 0);
    as_("guest", stake);
    c.join_match(0);
    c
}

fn claim_as(c: &mut Arena, who: &str) -> u128 {
    as_(who, 0);
    c.claim(0).0
}

#[test]
fn escrow_and_join() {
    let mut c = setup();
    as_("host", N);
    c.create_match(false);
    assert_eq!(c.get_match(0).unwrap().status, "open");
    as_("guest", N);
    c.join_match(0);
    let m = c.get_match(0).unwrap();
    assert_eq!(m.status, "live");
    assert_eq!(m.guest, Some(acc("guest")));
}

#[test]
#[should_panic(expected = "Deposit must equal stake")]
fn join_wrong_deposit() {
    let mut c = setup();
    as_("host", N);
    c.create_match(false);
    as_("guest", N / 2);
    c.join_match(0);
}

#[test]
#[should_panic(expected = "Host cannot join own match")]
fn host_cannot_join() {
    let mut c = setup();
    as_("host", N);
    c.create_match(false);
    c.join_match(0);
}

#[test]
#[should_panic(expected = "Players cannot bet on their own match")]
fn player_cannot_bet() {
    let mut c = live(N);
    as_("guest", N);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "Bet below minimum")]
fn bet_min() {
    let mut c = live(N);
    as_("bob", N / 1000);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "Bet above maximum")]
fn bet_max() {
    let mut c = live(N);
    as_("bob", 101 * N);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "Match not bettable")]
fn unbettable() {
    let mut c = setup();
    as_("host", 0);
    c.create_match(false);
    as_("guest", 0);
    c.join_match(0);
    as_("bob", N);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "Betting closed")]
fn no_trading_before_live() {
    let mut c = setup();
    as_("host", N);
    c.create_match(true);
    as_("bob", N);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "House can't fund bets right now")]
fn bettable_needs_treasury() {
    as_("arena", 0);
    let mut c = Arena::new(acc("arena"), acc("ref"));
    as_("host", N);
    c.create_match(true);
}

#[test]
fn long_moves_price_and_quote_matches() {
    let mut c = live(N);
    assert_eq!(c.get_match(0).unwrap().price_bps, 5000);
    let q = c.quote_buy(0, 0, U128(N)).0;
    as_("bob", N);
    assert_eq!(c.buy(0, 0, U128(q)).0, q);
    let up = c.get_match(0).unwrap().price_bps;
    assert!(up > 5000, "long A raises A's price: {up}");
    as_("cat", 2 * N);
    c.buy(0, 1, U128(0)); // short A
    assert!(c.get_match(0).unwrap().price_bps < up);
    assert_eq!(c.get_prices(0).len(), 3); // live start + 2 trades
}

#[test]
#[should_panic(expected = "Price moved, try again")]
fn slippage_guard() {
    let mut c = live(N);
    let q = c.quote_buy(0, 0, U128(N)).0;
    as_("cat", N);
    c.buy(0, 0, U128(0)); // front-run
    as_("bob", N);
    c.buy(0, 0, U128(q));
}

/// Plays a market, settles with `winner`, claims everyone, checks every yocto is accounted for.
fn conserve(winner: Option<u8>) {
    let stake = 3 * N;
    let mut c = live(stake);
    let t0 = c.config().treasury.0; // after seeding
    let mut deposits = 2 * stake;
    for (who, side, amt) in [("aa", 0, 2 * N), ("bb", 1, 5 * N), ("cc", 0, N + 7), ("aa", 1, N / 3), ("dd", 1, 40 * N)] {
        as_(who, amt);
        c.buy(0, side, U128(0));
        deposits += amt;
    }
    as_("ref", 0);
    c.report_result(0, winner);
    let mut paid = 0;
    for who in ["host", "guest", "aa", "bb", "cc", "dd"] {
        paid += c.claimable(0, acc(who)).0;
        if c.claimable(0, acc(who)).0 > 0 {
            claim_as(&mut c, who);
        }
        assert_eq!(c.claimable(0, acc(who)).0, 0);
    }
    let gained = c.config().treasury.0 - t0; // seed back (or not) + fees
    let in_ = deposits + SEED;
    let out = paid + gained;
    assert!(out <= in_, "overpaid by {}", out - in_);
    assert!(in_ - out < 100, "dust only: {}", in_ - out);
}

#[test]
fn settle_a_conserves() {
    conserve(Some(0));
}

#[test]
fn settle_b_conserves() {
    conserve(Some(1));
}

#[test]
fn refund_conserves() {
    conserve(None);
}

#[test]
fn settle_pays_winning_shares() {
    let mut c = live(N);
    as_("bob", 2 * N);
    let sh = c.buy(0, 0, U128(0)).0;
    as_("cat", N);
    c.buy(0, 1, U128(0));
    as_("ref", 0);
    c.report_result(0, Some(0));
    assert_eq!(c.claimable(0, acc("bob")).0, sh);
    assert_eq!(c.claimable(0, acc("cat")).0, 0);
}

#[test]
fn refund_returns_net_deposit() {
    let mut c = live(N);
    as_("aa", 3 * N);
    c.buy(0, 0, U128(0));
    as_("ref", 0);
    c.report_result(0, None);
    assert_eq!(claim_as(&mut c, "host"), N);
    assert_eq!(claim_as(&mut c, "guest"), N);
    assert_eq!(claim_as(&mut c, "aa"), 3 * N - 3 * N / 1000); // fee kept
}

#[test]
fn history_capped() {
    let mut c = live(0);
    for i in 0..(MAX_HISTORY + 5) {
        as_at("bob", N / 10, i as u64 * 1_000_000);
        c.buy(0, (i % 2) as u8, U128(0));
    }
    let h = c.get_prices(0);
    assert_eq!(h.len(), MAX_HISTORY);
    assert_eq!(h.last().unwrap().0, (MAX_HISTORY + 4) as u64);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn double_claim() {
    let mut c = live(N);
    as_("ref", 0);
    c.report_result(0, Some(1));
    claim_as(&mut c, "guest");
    claim_as(&mut c, "guest");
}

#[test]
fn failed_transfer_restores_claim() {
    let mut c = live(N);
    as_("ref", 0);
    c.report_result(0, Some(1));
    claim_as(&mut c, "guest");
    assert_eq!(c.claimable(0, acc("guest")).0, 0);
    // callback with a failed promise result
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena")).predecessor_account_id(acc("arena"));
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![near_sdk::PromiseResult::Failed]);
    assert!(!c.on_claim(0, acc("guest"), Some(1), false));
    assert!(c.claimable(0, acc("guest")).0 > 0);
}

#[test]
fn expire_live_and_open() {
    let mut c = live(N);
    as_("host", N);
    c.create_match(true); // id 1, open
    as_at("anyone", 0, EXPIRY_NS + 1);
    c.expire(0);
    c.expire(1);
    assert_eq!(c.get_match(0).unwrap().status, "refund");
    assert_eq!(claim_as(&mut c, "host"), N); // match 0 stake
    as_("host", 0);
    assert_eq!(c.claim(1).0, N);
}

#[test]
#[should_panic(expected = "Not expired yet")]
fn expire_too_early() {
    let mut c = live(N);
    as_at("anyone", 0, EXPIRY_NS - 1);
    c.expire(0);
}

#[test]
fn cancel_refunds_host() {
    let mut c = setup();
    as_("host", N);
    c.create_match(true);
    c.cancel_match(0);
    assert_eq!(c.get_match(0).unwrap().status, "refund");
    assert_eq!(c.claimable(0, acc("host")).0, 0); // already paid
}

#[test]
fn list_newest_first() {
    let mut c = setup();
    for _ in 0..3 {
        as_("host", 0);
        c.create_match(false);
    }
    let ids: Vec<u64> = c.list_matches(0, 10).iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![2, 1, 0]);
    let ids: Vec<u64> = c.list_matches(1, 1).iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![1]);
}

#[test]
fn owner_limits_need_one_yocto() {
    let mut c = setup();
    as_("arena", 1);
    c.set_limits(U128(N / 100), U128(N));
    assert_eq!(c.config().max_bet.0, N);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn owner_without_yocto_rejected() {
    let mut c = setup();
    as_("arena", 0);
    c.set_referee(acc("evil"));
}

#[test]
fn bets_are_recorded_one_by_one() {
    let mut c = live(N);
    as_at("bob", 45 * N / 10, 1_000_000);
    let a1 = c.buy(0, 0, U128(0)).0;
    as_at("bob", 25 * N / 10, 2_000_000);
    let b = c.buy(0, 1, U128(0)).0;
    as_at("cat", N, 3_000_000);
    c.buy(0, 1, U128(0));
    as_at("bob", 15 * N / 10, 4_000_000);
    let a2 = c.buy(0, 0, U128(0)).0;
    let mine: Vec<(u32, u8, u128, u128, u64)> = c.get_bets_of(0, acc("bob")).iter().map(|x| (x.id, x.side, x.amount.0, x.shares.0, x.ms)).collect();
    assert_eq!(mine, vec![(0, 0, 45 * N / 10, a1, 1), (1, 1, 25 * N / 10, b, 2), (3, 0, 15 * N / 10, a2, 4)]);
    let feed: Vec<u32> = c.get_recent_bets(0, 3).iter().map(|x| x.id).collect();
    assert_eq!(feed, vec![3, 2, 1]); // newest first, capped by limit
    assert_eq!(c.get_recent_bets(0, 99).len(), 4);
    // locked until the result; then A wins pays every A share 1 NEAR
    as_("ref", 0);
    c.report_result(0, Some(0));
    assert_eq!(c.claimable(0, acc("bob")).0, a1 + a2);
}

#[test]
fn void_refunds_every_bet_after_fee() {
    let mut c = live(N);
    as_("bob", 2 * N);
    c.buy(0, 0, U128(0));
    as_("bob", 3 * N);
    c.buy(0, 1, U128(0));
    let t0 = c.config().treasury.0;
    as_("ref", 0);
    c.report_result(0, None);
    assert_eq!(c.claimable(0, acc("bob")).0, 5 * N - 5 * N / 1000);
    assert_eq!(c.config().treasury.0 - t0, SEED); // house gets exactly its seed back
}
