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

fn create(c: &mut Arena, bettable: bool) -> u64 {
    match c.create_match(bettable, None) {
        PromiseOrValue::Value(v) => v.unwrap(),
        _ => panic!("expected value"),
    }
}

fn join(c: &mut Arena, id: u64) {
    assert!(matches!(c.join_match(id, None), PromiseOrValue::Value(true)));
}

/// Fresh contract with a treasury that can seed two matches.
fn setup() -> Arena {
    as_("arena", 0);
    let mut c = Arena::new(acc("arena"), acc("ref"), acc("mon"));
    as_("arena", 2 * SEED);
    c.fund();
    c
}

/// Live bettable match 0 between host and guest with `stake` each.
fn live(stake: u128) -> Arena {
    let mut c = setup();
    as_("host", stake);
    assert_eq!(create(&mut c, true), 0);
    as_("guest", stake);
    join(&mut c, 0);
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
    create(&mut c, false);
    assert_eq!(c.get_match(0).unwrap().status, "open");
    as_("guest", N);
    join(&mut c, 0);
    let m = c.get_match(0).unwrap();
    assert_eq!(m.status, "live");
    assert_eq!(m.guest, Some(acc("guest")));
}

#[test]
#[should_panic(expected = "Deposit must equal stake")]
fn join_wrong_deposit() {
    let mut c = setup();
    as_("host", N);
    create(&mut c, false);
    as_("guest", N / 2);
    join(&mut c, 0);
}

#[test]
#[should_panic(expected = "Host cannot join own match")]
fn host_cannot_join() {
    let mut c = setup();
    as_("host", N);
    create(&mut c, false);
    join(&mut c, 0);
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
    create(&mut c, false);
    as_("guest", 0);
    join(&mut c, 0);
    as_("bob", N);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "Betting closed")]
fn no_trading_before_live() {
    let mut c = setup();
    as_("host", N);
    create(&mut c, true);
    as_("bob", N);
    c.buy(0, 0, U128(0));
}

#[test]
#[should_panic(expected = "House can't fund bets right now")]
fn bettable_needs_treasury() {
    as_("arena", 0);
    let mut c = Arena::new(acc("arena"), acc("ref"), acc("mon"));
    as_("host", N);
    create(&mut c, true);
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
    c.report_result(0, winner, None);
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
    c.report_result(0, Some(0), None);
    assert_eq!(c.claimable(0, acc("bob")).0, sh);
    assert_eq!(c.claimable(0, acc("cat")).0, 0);
}

#[test]
fn refund_returns_net_deposit() {
    let mut c = live(N);
    as_("aa", 3 * N);
    c.buy(0, 0, U128(0));
    as_("ref", 0);
    c.report_result(0, None, None);
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
    c.report_result(0, Some(1), None);
    claim_as(&mut c, "guest");
    claim_as(&mut c, "guest");
}

#[test]
fn failed_transfer_restores_claim() {
    let mut c = live(N);
    as_("ref", 0);
    c.report_result(0, Some(1), None);
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
    create(&mut c, true); // id 1, open
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
    create(&mut c, true);
    c.cancel_match(0);
    assert_eq!(c.get_match(0).unwrap().status, "refund");
    assert_eq!(c.claimable(0, acc("host")).0, 0); // already paid
}

#[test]
fn list_newest_first() {
    let mut c = setup();
    for _ in 0..3 {
        as_("host", 0);
        create(&mut c, false);
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
    c.report_result(0, Some(0), None);
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
    c.report_result(0, None, None);
    assert_eq!(c.claimable(0, acc("bob")).0, 5 * N - 5 * N / 1000);
    assert_eq!(c.config().treasury.0 - t0, SEED); // house gets exactly its seed back
}

/* ---------- monsters + tournaments ---------- */

/// Context for a `#[private]` callback whose promise 0 succeeded or failed.
fn cb(ok: bool) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena")).predecessor_account_id(acc("arena"));
    let r = if ok { near_sdk::PromiseResult::Successful(vec![]) } else { near_sdk::PromiseResult::Failed };
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![r]);
}

/// Receipts the last call created: "receiver.method(args)" or "receiver<-yocto".
fn calls() -> Vec<String> {
    use near_sdk::mock::MockAction;
    near_sdk::test_utils::get_created_receipts()
        .iter()
        .flat_map(|r| {
            r.actions.iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, args, .. } => {
                    Some(format!("{}.{}({})", r.receiver_id, String::from_utf8_lossy(method_name), String::from_utf8_lossy(args)))
                }
                MockAction::Transfer { deposit, .. } => Some(format!("{}<-{}", r.receiver_id, deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

/// Callback that follows every bounce refund.
fn refund() -> String {
    format!(r#"arena.on_refund({{"amount":"{N}"}})"#)
}

fn has(call: &str) -> bool {
    let c = calls();
    c.iter().any(|x| x == call) || panic!("{call} not in {c:?}")
}

#[test]
fn monster_match_full_flow() {
    let mut c = setup();
    as_("host", N);
    assert!(matches!(c.create_match(false, Some("1".into())), PromiseOrValue::Promise(_)));
    assert!(calls().iter().any(|x| x.starts_with(r#"mon.lock({"token_id":"1","account_id":"host","until_ms":18000000}"#)));
    assert!(c.get_match(0).is_none()); // nothing until the lock lands
    cb(true);
    assert_eq!(c.on_create(acc("host"), U128(N), false, "1".into(), 7), Some(0));
    as_("guest", N);
    let _ = c.join_match(0, Some("2".into()));
    assert_eq!(c.get_match(0).unwrap().status, "open");
    cb(true);
    assert!(c.on_join(0, acc("guest"), U128(N), "2".into(), 7));
    let m = c.get_match(0).unwrap();
    assert_eq!((m.status.as_str(), m.monsters.clone(), m.tournament), ("live", [Some("1".into()), Some("2".into())], None));
    as_("ref", 0);
    c.report_result(0, Some(1), Some([0, 2]));
    has(r#"mon.record_result({"match_id":0,"tokens":["1","2"],"winner":1,"kos":[0,2],"tournament":null})"#);
    has(r#"mon.unlock({"locks":[["1",7],["2",7]]})"#);
}

#[test]
fn failed_lock_refunds_without_unlock() {
    let mut c = setup();
    cb(false);
    assert_eq!(c.on_create(acc("host"), U128(N), false, "1".into(), 7), None);
    assert_eq!(calls(), vec![format!("host<-{N}"), refund()]);
    assert!(c.get_match(0).is_none());
}

#[test]
fn seed_taken_only_in_callback() {
    let mut c = setup();
    as_("host", N);
    let _ = c.create_match(true, Some("1".into()));
    assert_eq!(c.config().treasury.0, 2 * SEED); // untouched while lock in flight
    create(&mut c, true);
    create(&mut c, true); // treasury drained meanwhile
    cb(true);
    assert_eq!(c.on_create(acc("host"), U128(N), true, "1".into(), 7), None);
    assert_eq!(calls(), vec![format!("host<-{N}"), refund(), r#"mon.unlock({"locks":[["1",7]]})"#.into()]);
}

#[test]
fn join_callback_after_someone_else_joined() {
    let mut c = setup();
    as_("host", N);
    create(&mut c, false);
    as_("g1", N);
    let _ = c.join_match(0, Some("7".into()));
    as_("g2", N);
    join(&mut c, 0);
    cb(true);
    assert!(!c.on_join(0, acc("g1"), U128(N), "7".into(), 7));
    assert_eq!(calls(), vec![format!("g1<-{N}"), refund(), r#"mon.unlock({"locks":[["7",7]]})"#.into()]);
    assert_eq!(c.get_match(0).unwrap().guest, Some(acc("g2")));
}

#[test]
fn cancel_and_expire_unlock() {
    let mut c = setup();
    cb(true);
    c.on_create(acc("host"), U128(0), false, "1".into(), 7);
    as_("host", 0);
    c.cancel_match(0);
    has(r#"mon.unlock({"locks":[["1",7]]})"#);
    cb(true);
    c.on_create(acc("host"), U128(0), false, "2".into(), 7);
    as_at("anyone", 0, EXPIRY_NS + 1);
    c.expire(1);
    has(r#"mon.unlock({"locks":[["2",7]]})"#);
}

fn tourney(size: u8) -> Arena {
    let mut c = setup();
    as_("arena", 1);
    assert_eq!(c.create_tournament(size, U128(N), true), 0);
    c
}

fn enter(c: &mut Arena, who: &str) -> bool {
    as_(who, N);
    let _ = c.enter_tournament(0, format!("m-{who}"));
    assert!(calls()[0].starts_with(&format!(r#"mon.lock({{"token_id":"m-{who}","account_id":"{who}","until_ms":{}}}"#, 72 * 3_600_000)));
    cb(true);
    c.on_enter(0, acc(who), U128(N), format!("m-{who}"), 259200000)
}

fn result(c: &mut Arena, id: u64, w: Option<u8>) {
    as_("ref", 0);
    c.report_result(id, w, None);
}

#[test]
fn tournament_4_full_run() {
    let mut c = tourney(4);
    for p in ["p0", "p1", "p2", "p3"] {
        assert!(enter(&mut c, p));
    }
    let t = c.get_tournament(0).unwrap();
    assert_eq!((t.status.as_str(), t.pot.0, t.rounds.clone()), ("live", 4 * N, vec![vec![Some(0), Some(1)], vec![None]]));
    let m = c.get_match(1).unwrap();
    assert_eq!((m.host, m.guest, m.stake.0, m.status, m.tournament), (acc("p2"), Some(acc("p3")), 0, "live".into(), Some(0)));
    assert_eq!(m.monsters, [Some("m-p2".into()), Some("m-p3".into())]);
    assert!(m.bettable);
    // spectators can still bet on bracket matches
    as_("bob", N);
    c.buy(0, 1, U128(0));
    result(&mut c, 0, Some(1));
    has(r#"mon.record_result({"match_id":0,"tokens":["m-p0","m-p1"],"winner":1,"kos":[0,0],"tournament":0})"#);
    assert_eq!(calls()[1], r#"mon.unlock({"locks":[["m-p0",259200000]]})"#); // loser only
    assert_eq!(c.get_tournament(0).unwrap().rounds[1], vec![None]); // waits for the other semi
    assert!(claim_as(&mut c, "bob") > N / 2);
    assert_eq!(c.claimable(0, acc("p1")).0, 0); // players have no stake
    result(&mut c, 1, Some(0));
    let f = c.get_match(2).unwrap();
    assert_eq!((f.host, f.guest, f.monsters), (acc("p1"), Some(acc("p2")), [Some("m-p1".into()), Some("m-p2".into())]));
    let t0 = c.config().treasury.0;
    result(&mut c, 2, Some(1));
    has(r#"mon.add_title({"token_id":"m-p2","title":"Tournament #0 Champion"})"#);
    has(r#"mon.unlock({"locks":[["m-p2",259200000]]})"#);
    has(r#"mon.unlock({"locks":[["m-p1",259200000]]})"#);
    let t = c.get_tournament(0).unwrap();
    assert_eq!((t.status.as_str(), t.champion), ("done", Some(acc("p2"))));
    let fee = c.config().treasury.0 - t0 - if f.bettable { f.amm[1].0 } else { 0 };
    as_("p2", 0);
    let prize = c.claim_tournament(0).0;
    assert_eq!(prize + fee, 4 * N); // pot = paid out + fee
    assert_eq!(fee, 4 * N / 1000);
    assert_eq!(c.get_tournament(0).unwrap().claimed, vec![false, false, true, false]);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn tournament_loser_cannot_claim() {
    let mut c = tourney(4);
    for p in ["p0", "p1", "p2", "p3"] {
        enter(&mut c, p);
    }
    for id in 0..3 {
        result(&mut c, id, Some(0));
    }
    as_("p1", 0);
    c.claim_tournament(0);
}

#[test]
fn tournament_8_with_voids() {
    let mut c = tourney(8);
    let ps: Vec<String> = (0..8).map(|i| format!("p{i}")).collect();
    for p in &ps {
        assert!(enter(&mut c, p));
    }
    assert_eq!(c.get_tournament(0).unwrap().rounds[0], vec![Some(0), Some(1), Some(2), Some(3)]);
    result(&mut c, 0, Some(1)); // p1
    result(&mut c, 1, None); // void, test random byte 0 -> seat 0: p2
    has(r#"mon.unlock({"locks":[["m-p3",259200000]]})"#);
    result(&mut c, 3, Some(1)); // p7
    as_at("anyone", 0, EXPIRY_NS + 1);
    c.expire(2); // expired, random byte 0 -> seat 0: p4
    let r = c.get_tournament(0).unwrap().rounds;
    assert_eq!(r[1], vec![Some(4), Some(5)]);
    let (a, b) = (c.get_match(4).unwrap(), c.get_match(5).unwrap());
    assert_eq!((a.host, a.guest), (acc("p1"), Some(acc("p2"))));
    assert_eq!((b.host, b.guest), (acc("p4"), Some(acc("p7"))));
    result(&mut c, 5, Some(0)); // p4
    result(&mut c, 4, Some(1)); // p2 (later slot reported first: order still host = even slot)
    let f = c.get_match(6).unwrap();
    assert_eq!((f.host, f.guest, f.tournament), (acc("p2"), Some(acc("p4")), Some(0)));
    result(&mut c, 6, Some(0));
    let t = c.get_tournament(0).unwrap();
    assert_eq!((t.status.as_str(), t.champion, t.rounds[2].clone()), ("done", Some(acc("p2")), vec![Some(6)]));
    as_("p2", 0);
    assert_eq!(c.claim_tournament(0).0, 8 * N - 8 * N / 1000);
}

#[test]
#[should_panic(expected = "Already entered")]
fn duplicate_entry_rejected() {
    let mut c = tourney(4);
    enter(&mut c, "p0");
    as_("p0", N);
    let _ = c.enter_tournament(0, "other".into());
}

#[test]
fn duplicate_or_late_entry_in_flight_bounces() {
    let mut c = tourney(4);
    enter(&mut c, "p0");
    cb(true); // second entry by p0 passed the upfront check before the first landed
    assert!(!c.on_enter(0, acc("p0"), U128(N), "x".into(), 7));
    assert_eq!(calls(), vec![format!("p0<-{N}"), refund(), r#"mon.unlock({"locks":[["x",7]]})"#.into()]);
    for p in ["p1", "p2", "p3"] {
        enter(&mut c, p);
    }
    cb(true); // fifth entry landed after it filled
    assert!(!c.on_enter(0, acc("p4"), U128(N), "y".into(), 7));
    assert_eq!(calls(), vec![format!("p4<-{N}"), refund(), r#"mon.unlock({"locks":[["y",7]]})"#.into()]);
    let mut c = tourney(4);
    cb(false); // lock failed: refund, nothing to unlock
    assert!(!c.on_enter(0, acc("p9"), U128(N), "z".into(), 7));
    assert_eq!(calls(), vec![format!("p9<-{N}"), refund()]);
    assert_eq!(c.get_tournament(0).unwrap().pot.0, 0);
}

#[test]
#[should_panic(expected = "Deposit must equal entry fee")]
fn entry_fee_exact() {
    let mut c = tourney(4);
    as_("p0", N / 2);
    let _ = c.enter_tournament(0, "1".into());
}

#[test]
fn cancel_tournament_refunds() {
    let mut c = tourney(4);
    enter(&mut c, "p0");
    enter(&mut c, "p1");
    as_at("anyone", 0, TOURNEY_CANCEL_NS + 1);
    c.cancel_tournament(0);
    has(r#"mon.unlock({"locks":[["m-p0",259200000],["m-p1",259200000]]})"#);
    assert_eq!(c.get_tournament(0).unwrap().status, "cancelled");
    as_("p0", 0);
    assert_eq!(c.claim_tournament(0).0, N);
    cb(false); // transfer failed -> can retry
    assert!(!c.on_claim_tournament(0, 0));
    as_("p0", 0);
    assert_eq!(c.claim_tournament(0).0, N);
    as_("p1", 0);
    assert_eq!(c.claim_tournament(0).0, N);
    assert_eq!(c.get_tournament(0).unwrap().claimed, vec![true, true]);
}

#[test]
#[should_panic(expected = "Not expired yet")]
fn cancel_tournament_too_early() {
    let mut c = tourney(4);
    as_at("anyone", 0, TOURNEY_CANCEL_NS - 1);
    c.cancel_tournament(0);
}

#[test]
#[should_panic(expected = "Size must be 4 or 8")]
fn tournament_size() {
    let mut c = setup();
    as_("arena", 1);
    c.create_tournament(6, U128(N), false);
}

#[test]
fn list_tournaments_newest_first() {
    let mut c = setup();
    for _ in 0..3 {
        as_("arena", 1);
        c.create_tournament(4, U128(N), false);
    }
    let ids: Vec<u64> = c.list_tournaments(1, 5).iter().map(|t| t.id).collect();
    assert_eq!(ids, vec![1, 0]);
}

/// Void tournament match with the block's random byte `r`: seat `r & 1` advances, the other is unlocked.
fn void_with_seed(r: u8) -> Arena {
    let mut c = tourney(4);
    for p in ["p0", "p1", "p2", "p3"] {
        enter(&mut c, p);
    }
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena")).predecessor_account_id(acc("ref")).random_seed([r; 32]);
    testing_env!(b.build());
    c.report_result(0, None, None);
    c
}

#[test]
fn void_advances_random_seat() {
    for (r, adv, out) in [(0, "p0", "p1"), (1, "p1", "p0"), (2, "p0", "p1"), (255, "p1", "p0")] {
        let mut c = void_with_seed(r);
        has(&format!(r#"mon.unlock({{"locks":[["m-{out}",259200000]]}})"#));
        result(&mut c, 1, Some(0)); // p2; later random seed must not change who advanced
        assert_eq!(c.get_match(2).unwrap().host, acc(adv));
    }
}

#[test]
fn failed_refund_goes_to_treasury() {
    let mut c = setup();
    let t0 = c.config().treasury.0;
    cb(false);
    assert!(!c.on_refund(U128(N)));
    assert_eq!(c.config().treasury.0, t0 + N);
    cb(true);
    assert!(c.on_refund(U128(N)));
    assert_eq!(c.config().treasury.0, t0 + N);
}

#[test]
#[should_panic(expected = "Entry closed")]
fn entry_window_closes() {
    let mut c = tourney(4);
    as_at("p0", N, TOURNEY_CANCEL_NS + 1);
    let _ = c.enter_tournament(0, "1".into());
}

#[test]
#[should_panic(expected = "Attach 150 Tgas")]
fn entry_needs_gas() {
    let mut c = tourney(4);
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena")).predecessor_account_id(acc("p0")).attached_deposit(NearToken::from_yoctonear(N)).prepaid_gas(Gas::from_tgas(100));
    testing_env!(b.build());
    let _ = c.enter_tournament(0, "1".into());
}
