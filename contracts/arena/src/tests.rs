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

fn setup() -> Arena {
    as_("arena", 0);
    Arena::new(acc("arena"), acc("ref"))
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
    c.place_bet(0, 0);
}

#[test]
#[should_panic(expected = "Bet below minimum")]
fn bet_min() {
    let mut c = live(N);
    as_("bob", N / 1000);
    c.place_bet(0, 0);
}

#[test]
#[should_panic(expected = "Bet above maximum")]
fn bet_max_accumulates() {
    let mut c = live(N);
    as_("bob", 60 * N);
    c.place_bet(0, 0);
    as_("bob", 60 * N);
    c.place_bet(0, 0);
}

#[test]
#[should_panic(expected = "Cannot bet on both sides")]
fn no_side_switch() {
    let mut c = live(N);
    as_("bob", N);
    c.place_bet(0, 0);
    as_("bob", N);
    c.place_bet(0, 1);
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
    c.place_bet(0, 0);
}

#[test]
fn weight_drops_with_kos() {
    let mut c = live(0);
    as_("ref", 0);
    c.report_kos(0, 2);
    c.report_kos(0, 1); // lower is ignored
    as_("bob", N);
    c.place_bet(0, 0);
    assert_eq!(c.get_bet(0, acc("bob")).unwrap().weight.0, N * 40 / 100);
    as_("ref", 0);
    c.report_kos(0, 5);
    as_("cat", N);
    c.place_bet(0, 1);
    assert_eq!(c.get_bet(0, acc("cat")).unwrap().weight.0, N * 10 / 100); // floor 10%
}

#[test]
#[should_panic(expected = "Only referee")]
fn non_referee_report() {
    let mut c = live(N);
    as_("host", 0);
    c.report_result(0, Some(0));
}

#[test]
fn settled_payouts_conserve_funds() {
    let stake = 3 * N;
    let mut c = live(stake);
    // early bets on host, a late bet on host, bets on guest
    as_("aa", 2 * N);
    c.place_bet(0, 0);
    as_("ref", 0);
    c.report_kos(0, 2);
    as_("bb", 4 * N); // weight 40%
    c.place_bet(0, 0);
    as_("xx", 5 * N);
    c.place_bet(0, 1);
    as_("yy", N + 7); // odd amount for rounding
    c.place_bet(0, 1);
    as_("ref", 0);
    c.report_result(0, Some(0));

    let deposited = 2 * stake + 2 * N + 4 * N + 5 * N + N + 7;
    let host = claim_as(&mut c, "host");
    let a = claim_as(&mut c, "aa");
    let b = claim_as(&mut c, "bb");
    assert_eq!(c.claimable(0, acc("guest")).0, 0);
    assert_eq!(c.claimable(0, acc("xx")).0, 0);
    let treasury = c.config().treasury.0;
    let paid = host + a + b;
    assert!(paid + treasury <= deposited);
    assert!(deposited - paid - treasury < 10, "dust only"); // rounding dust stays in contract
    assert_eq!(host, 2 * stake - 2 * stake / 1000);
    // early bettor (full weight 2N) beats late bettor (weight 1.6N) despite smaller stake
    assert!(a - 2 * N > b - 4 * N);
}

#[test]
fn no_winning_bets_refunds_everyone() {
    let mut c = live(N);
    as_("xx", 2 * N);
    c.place_bet(0, 1);
    as_("ref", 0);
    c.report_result(0, Some(0));
    assert_eq!(claim_as(&mut c, "xx"), 2 * N);
    assert_eq!(c.config().treasury.0, 2 * N / 1000); // pot fee only
}

#[test]
fn refund_returns_exact_amounts() {
    let mut c = live(N);
    as_("aa", 3 * N);
    c.place_bet(0, 0);
    as_("ref", 0);
    c.report_result(0, None);
    assert_eq!(claim_as(&mut c, "host"), N);
    assert_eq!(claim_as(&mut c, "guest"), N);
    assert_eq!(claim_as(&mut c, "aa"), 3 * N);
    assert_eq!(c.config().treasury.0, 0);
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
