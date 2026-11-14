use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const N: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
const SEED: u128 = 5 * N;
const G: &str = "brawler";

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

fn bal(c: &Arena, who: &str) -> u128 {
    c.balance_of(acc(who)).0
}

/// Deposit `amt` into `who`'s balance.
fn fund(c: &mut Arena, who: &str, amt: u128) {
    if amt > 0 {
        as_(who, amt);
        c.deposit();
    }
}

fn create_in(c: &mut Arena, game: &str, host: &str, stake: u128, bettable: bool) -> u64 {
    fund(c, host, stake);
    as_(host, 1);
    match c.create_match(game.into(), U128(stake), bettable, None) {
        PromiseOrValue::Value(v) => v.unwrap(),
        _ => panic!("expected value"),
    }
}

fn create(c: &mut Arena, host: &str, stake: u128, bettable: bool) -> u64 {
    create_in(c, G, host, stake, bettable)
}

fn join(c: &mut Arena, who: &str, id: u64) {
    fund(c, who, c.get_match(id).unwrap().stake.0);
    as_(who, 1);
    assert!(matches!(c.join_match(id, None), PromiseOrValue::Value(true)));
}

fn bet(c: &mut Arena, who: &str, side: u8, amt: u128, min_out: u128) -> u128 {
    fund(c, who, amt);
    as_(who, 1);
    c.buy(0, side, U128(amt), U128(min_out)).0
}

fn bet_at(c: &mut Arena, who: &str, side: u8, amt: u128, ts: u64) -> u128 {
    fund(c, who, amt);
    as_at(who, 1, ts);
    c.buy(0, side, U128(amt), U128(0)).0
}

/// Fresh contract, game "brawler" (referee "ref", assets "mon"), treasury seeds 2 matches.
fn setup() -> Arena {
    as_("arena", 0);
    let mut c = Arena::new(acc("arena"));
    as_("arena", 1);
    c.register_game(G.into(), acc("ref"), Some(acc("mon")));
    as_("arena", 2 * SEED);
    c.fund();
    c
}

/// Live bettable match 0, host vs guest, `stake` each.
fn live(stake: u128) -> Arena {
    let mut c = setup();
    assert_eq!(create(&mut c, "host", stake, true), 0);
    join(&mut c, "guest", 0);
    c
}

fn claim_as(c: &mut Arena, who: &str) -> u128 {
    as_(who, 0);
    c.claim(0).0
}

#[test]
fn escrow_and_join() {
    let mut c = setup();
    create(&mut c, "host", N, false);
    assert_eq!((c.get_match(0).unwrap().status.as_str(), bal(&c, "host")), ("open", 0));
    assert_eq!(c.get_match(0).unwrap().game, G);
    join(&mut c, "guest", 0);
    let m = c.get_match(0).unwrap();
    assert_eq!((m.status.as_str(), m.guest, bal(&c, "guest")), ("live", Some(acc("guest")), 0));
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn join_insufficient_balance() {
    let mut c = setup();
    create(&mut c, "host", N, false);
    fund(&mut c, "guest", N / 2);
    as_("guest", 1);
    let _ = c.join_match(0, None);
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn create_insufficient_balance() {
    let mut c = setup();
    as_("host", 1);
    let _ = c.create_match(G.into(), U128(N), false, None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn spend_needs_one_yocto() {
    let mut c = setup();
    fund(&mut c, "host", N);
    as_("host", 0);
    let _ = c.create_match(G.into(), U128(N), false, None);
}

#[test]
#[should_panic(expected = "Unknown game")]
fn unknown_game() {
    let mut c = setup();
    create_in(&mut c, "nope", "host", 0, false);
}

#[test]
#[should_panic(expected = "Game has no assets")]
fn monster_needs_assets() {
    let mut c = setup();
    as_("arena", 1);
    c.register_game("plain".into(), acc("ref"), None);
    as_("host", 1);
    let _ = c.create_match("plain".into(), U128(0), false, Some("1".into()));
}

#[test]
#[should_panic(expected = "Host cannot join own match")]
fn host_cannot_join() {
    let mut c = setup();
    create(&mut c, "host", N, false);
    join(&mut c, "host", 0);
}

#[test]
#[should_panic(expected = "Players cannot bet on their own match")]
fn player_cannot_bet() {
    let mut c = live(N);
    bet(&mut c, "guest", 0, N, 0);
}

#[test]
#[should_panic(expected = "Bet below minimum")]
fn bet_min() {
    let mut c = live(N);
    bet(&mut c, "bob", 0, N / 1000, 0);
}

#[test]
#[should_panic(expected = "Bet above maximum")]
fn bet_max() {
    let mut c = live(N);
    bet(&mut c, "bob", 0, 101 * N, 0);
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn bet_needs_balance() {
    let mut c = live(N);
    as_("bob", 1);
    c.buy(0, 0, U128(N), U128(0));
}

#[test]
#[should_panic(expected = "Match not bettable")]
fn unbettable() {
    let mut c = setup();
    create(&mut c, "host", 0, false);
    join(&mut c, "guest", 0);
    bet(&mut c, "bob", 0, N, 0);
}

#[test]
#[should_panic(expected = "Betting closed")]
fn no_trading_before_live() {
    let mut c = setup();
    create(&mut c, "host", N, true);
    bet(&mut c, "bob", 0, N, 0);
}

#[test]
#[should_panic(expected = "House can't fund bets right now")]
fn bettable_needs_treasury() {
    as_("arena", 0);
    let mut c = Arena::new(acc("arena"));
    as_("arena", 1);
    c.register_game(G.into(), acc("ref"), None);
    create(&mut c, "host", N, true);
}

#[test]
fn long_moves_price_and_quote_matches() {
    let mut c = live(N);
    assert_eq!(c.get_match(0).unwrap().price_bps, 5000);
    let q = c.quote_buy(0, 0, U128(N)).0;
    assert_eq!(bet(&mut c, "bob", 0, N, q), q);
    let up = c.get_match(0).unwrap().price_bps;
    assert!(up > 5000, "long A raises A's price: {up}");
    bet(&mut c, "cat", 1, 2 * N, 0); // short A
    assert!(c.get_match(0).unwrap().price_bps < up);
    assert_eq!(c.get_prices(0).len(), 3); // live start + 2 trades
}

#[test]
#[should_panic(expected = "Price moved, try again")]
fn slippage_guard() {
    let mut c = live(N);
    let q = c.quote_buy(0, 0, U128(N)).0;
    bet(&mut c, "cat", 0, N, 0); // front-run
    bet(&mut c, "bob", 0, N, q);
}

const ACTORS: [&str; 6] = ["host", "guest", "aa", "bb", "cc", "dd"];

/// balances + treasury: everything the contract owes outside open escrow.
fn ledger(c: &Arena) -> u128 {
    ACTORS.iter().map(|w| bal(c, w)).sum::<u128>() + c.config().treasury.0
}

/// Everyone deposits first; play, settle, claim all; ledger must return to start (dust only, never over).
fn conserve(winner: Option<u8>) {
    let stake = 3 * N;
    let mut c = setup();
    let bets = [("aa", 0, 2 * N), ("bb", 1, 5 * N), ("cc", 0, N + 7), ("aa", 1, N / 3), ("dd", 1, 40 * N)];
    fund(&mut c, "host", stake);
    fund(&mut c, "guest", stake);
    for (who, _, amt) in bets {
        fund(&mut c, who, amt);
    }
    let l0 = ledger(&c);
    as_("host", 1);
    let _ = c.create_match(G.into(), U128(stake), true, None);
    as_("guest", 1);
    let _ = c.join_match(0, None);
    for (who, side, amt) in bets {
        as_(who, 1);
        c.buy(0, side, U128(amt), U128(0));
    }
    assert!(ledger(&c) < l0); // escrowed
    as_("ref", 0);
    c.report_result(0, winner, None);
    for who in ACTORS {
        if c.claimable(0, acc(who)).0 > 0 {
            claim_as(&mut c, who);
        }
        assert_eq!(c.claimable(0, acc(who)).0, 0);
    }
    let l1 = ledger(&c);
    assert!(l1 <= l0, "overpaid by {}", l1 - l0);
    assert!(l0 - l1 < 100, "dust only: {}", l0 - l1);
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
    let sh = bet(&mut c, "bob", 0, 2 * N, 0);
    bet(&mut c, "cat", 1, N, 0);
    as_("ref", 0);
    c.report_result(0, Some(0), None);
    assert_eq!(c.claimable(0, acc("bob")).0, sh);
    assert_eq!(c.claimable(0, acc("cat")).0, 0);
    claim_as(&mut c, "bob");
    assert_eq!(bal(&c, "bob"), sh);
}

#[test]
fn refund_returns_net_deposit() {
    let mut c = live(N);
    bet(&mut c, "aa", 0, 3 * N, 0);
    as_("ref", 0);
    c.report_result(0, None, None);
    assert_eq!(claim_as(&mut c, "host"), N);
    assert_eq!(claim_as(&mut c, "guest"), N);
    assert_eq!(claim_as(&mut c, "aa"), 3 * N - 3 * N / 1000); // fee kept
    assert_eq!((bal(&c, "host"), bal(&c, "guest")), (N, N));
}

#[test]
fn history_capped() {
    let mut c = live(0);
    for i in 0..(MAX_HISTORY + 5) {
        bet_at(&mut c, "bob", (i % 2) as u8, N / 10, i as u64 * 1_000_000);
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

/// Context for a `#[private]` callback whose promise 0 succeeded or failed.
fn cb(ok: bool) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena")).predecessor_account_id(acc("arena"));
    let r = if ok { near_sdk::PromiseResult::Successful(vec![]) } else { near_sdk::PromiseResult::Failed };
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![r]);
}

#[test]
fn withdraw_and_failed_transfer_recredits() {
    let mut c = setup();
    fund(&mut c, "bob", 3 * N);
    as_("bob", 0);
    let _ = c.withdraw(U128(2 * N));
    assert_eq!(bal(&c, "bob"), N);
    has(&format!("bob<-{}", 2 * N));
    cb(false);
    assert!(!c.on_withdraw(acc("bob"), U128(2 * N)));
    assert_eq!(bal(&c, "bob"), 3 * N);
    cb(true);
    assert!(c.on_withdraw(acc("bob"), U128(2 * N)));
    assert_eq!(bal(&c, "bob"), 3 * N);
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn withdraw_over_balance() {
    let mut c = setup();
    fund(&mut c, "bob", N);
    as_("bob", 0);
    let _ = c.withdraw(U128(N + 1));
}

#[test]
fn expire_live_and_open() {
    let mut c = live(N);
    create(&mut c, "host", N, true); // id 1, open
    as_at("anyone", 0, EXPIRY_NS + 1);
    c.expire(0);
    c.expire(1);
    assert_eq!(c.get_match(0).unwrap().status, "refund");
    assert_eq!(claim_as(&mut c, "host"), N); // match 0 stake
    as_("host", 0);
    assert_eq!(c.claim(1).0, N);
    assert_eq!(bal(&c, "host"), 2 * N);
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
    create(&mut c, "host", N, true);
    as_("host", 0);
    c.cancel_match(0);
    assert_eq!(c.get_match(0).unwrap().status, "refund");
    assert_eq!(c.claimable(0, acc("host")).0, 0); // already credited
    assert_eq!(bal(&c, "host"), N);
}

#[test]
fn list_newest_first_and_game_filter() {
    let mut c = setup();
    as_("arena", 1);
    c.register_game("other".into(), acc("ref2"), None);
    for g in [G, "other", G] {
        create_in(&mut c, g, "host", 0, false);
    }
    let ids = |v: Vec<MatchView>| v.iter().map(|m| m.id).collect::<Vec<u64>>();
    assert_eq!(ids(c.list_matches(0, 10, None)), vec![2, 1, 0]);
    assert_eq!(ids(c.list_matches(1, 1, None)), vec![1]);
    assert_eq!(ids(c.list_matches(0, 10, Some(G.into()))), vec![2, 0]);
    assert_eq!(ids(c.list_matches(1, 10, Some("other".into()))), vec![1]);
    assert_eq!(c.list_games().len(), 2);
    assert_eq!(c.get_game("other".into()).unwrap().referee_id, acc("ref2"));
}

#[test]
fn per_game_referee() {
    let mut c = setup();
    as_("arena", 1);
    c.register_game("other".into(), acc("ref2"), None);
    create_in(&mut c, "other", "host", 0, false);
    join(&mut c, "guest", 0);
    as_("ref2", 0);
    c.report_result(0, Some(0), None);
    assert_eq!(c.get_match(0).unwrap().status, "settled");
}

#[test]
#[should_panic(expected = "Only referee")]
fn other_game_referee_rejected() {
    let mut c = live(N);
    as_("arena", 1);
    c.register_game("other".into(), acc("ref2"), None);
    as_("ref2", 0);
    c.report_result(0, Some(0), None);
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
    c.register_game("evil".into(), acc("evil"), None);
}

#[test]
#[should_panic(expected = "Only owner")]
fn register_game_owner_only() {
    let mut c = setup();
    as_("evil", 1);
    c.register_game(G.into(), acc("evil"), None);
}

#[test]
fn bets_are_recorded_one_by_one() {
    let mut c = live(N);
    let a1 = bet_at(&mut c, "bob", 0, 45 * N / 10, 1_000_000);
    let b = bet_at(&mut c, "bob", 1, 25 * N / 10, 2_000_000);
    bet_at(&mut c, "cat", 1, N, 3_000_000);
    let a2 = bet_at(&mut c, "bob", 0, 15 * N / 10, 4_000_000);
    let mine: Vec<(u32, u8, u128, u128, u64)> = c.get_bets_of(0, acc("bob")).iter().map(|x| (x.id, x.side, x.amount.0, x.shares.0, x.ms)).collect();
    assert_eq!(mine, vec![(0, 0, 45 * N / 10, a1, 1), (1, 1, 25 * N / 10, b, 2), (3, 0, 15 * N / 10, a2, 4)]);
    let feed: Vec<u32> = c.get_recent_bets(0, 3).iter().map(|x| x.id).collect();
    assert_eq!(feed, vec![3, 2, 1]);
    assert_eq!(c.get_recent_bets(0, 99).len(), 4);
    as_("ref", 0);
    c.report_result(0, Some(0), None);
    assert_eq!(c.claimable(0, acc("bob")).0, a1 + a2);
}

#[test]
fn void_refunds_every_bet_after_fee() {
    let mut c = live(N);
    bet(&mut c, "bob", 0, 2 * N, 0);
    bet(&mut c, "bob", 1, 3 * N, 0);
    let t0 = c.config().treasury.0;
    as_("ref", 0);
    c.report_result(0, None, None);
    assert_eq!(c.claimable(0, acc("bob")).0, 5 * N - 5 * N / 1000);
    assert_eq!(c.config().treasury.0 - t0, SEED);
}

/* ---------- monsters + tournaments ---------- */

/// Receipts of last call: "receiver.method(args)" or "receiver<-yocto".
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

fn has(call: &str) -> bool {
    let c = calls();
    c.iter().any(|x| x == call) || panic!("{call} not in {c:?}")
}

/// create_match w/ monster: stake debited now, match only after lock lands.
fn create_mon(c: &mut Arena, host: &str, stake: u128, bettable: bool, mon: &str) {
    fund(c, host, stake);
    as_(host, 1);
    assert!(matches!(c.create_match(G.into(), U128(stake), bettable, Some(mon.into())), PromiseOrValue::Promise(_)));
}

#[test]
fn monster_match_full_flow() {
    let mut c = setup();
    create_mon(&mut c, "host", N, false, "1");
    assert!(calls().iter().any(|x| x.starts_with(r#"mon.lock({"token_id":"1","account_id":"host","until_ms":18000000}"#)));
    assert!(c.get_match(0).is_none());
    assert_eq!(bal(&c, "host"), 0);
    cb(true);
    assert_eq!(c.on_create(G.into(), acc("host"), U128(N), false, "1".into(), 7), Some(0));
    fund(&mut c, "guest", N);
    as_("guest", 1);
    let _ = c.join_match(0, Some("2".into()));
    assert_eq!((c.get_match(0).unwrap().status.as_str(), bal(&c, "guest")), ("open", 0));
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
fn failed_lock_recredits_without_unlock() {
    let mut c = setup();
    create_mon(&mut c, "host", N, false, "1");
    cb(false);
    assert_eq!(c.on_create(G.into(), acc("host"), U128(N), false, "1".into(), 7), None);
    assert!(calls().is_empty());
    assert!(c.get_match(0).is_none());
    assert_eq!(bal(&c, "host"), N);
}

#[test]
fn seed_taken_only_in_callback() {
    let mut c = setup();
    create_mon(&mut c, "host", N, true, "1");
    assert_eq!(c.config().treasury.0, 2 * SEED); // untouched while lock in flight
    create(&mut c, "h2", 0, true);
    create(&mut c, "h2", 0, true); // treasury drained meanwhile
    cb(true);
    assert_eq!(c.on_create(G.into(), acc("host"), U128(N), true, "1".into(), 7), None);
    assert_eq!(calls(), vec![r#"mon.unlock({"locks":[["1",7]]})"#.to_string()]);
    assert_eq!(bal(&c, "host"), N);
}

#[test]
fn join_callback_after_someone_else_joined() {
    let mut c = setup();
    create(&mut c, "host", N, false);
    fund(&mut c, "g1", N);
    as_("g1", 1);
    let _ = c.join_match(0, Some("7".into()));
    join(&mut c, "g2", 0);
    cb(true);
    assert!(!c.on_join(0, acc("g1"), U128(N), "7".into(), 7));
    assert_eq!(calls(), vec![r#"mon.unlock({"locks":[["7",7]]})"#.to_string()]);
    assert_eq!(c.get_match(0).unwrap().guest, Some(acc("g2")));
    assert_eq!(bal(&c, "g1"), N);
}

#[test]
fn cancel_and_expire_unlock() {
    let mut c = setup();
    cb(true);
    c.on_create(G.into(), acc("host"), U128(0), false, "1".into(), 7);
    as_("host", 0);
    c.cancel_match(0);
    has(r#"mon.unlock({"locks":[["1",7]]})"#);
    cb(true);
    c.on_create(G.into(), acc("host"), U128(0), false, "2".into(), 7);
    as_at("anyone", 0, EXPIRY_NS + 1);
    c.expire(1);
    has(r#"mon.unlock({"locks":[["2",7]]})"#);
}

fn tourney(size: u8) -> Arena {
    let mut c = setup();
    as_("arena", 1);
    assert_eq!(c.create_tournament(G.into(), size, U128(N), true), 0);
    c
}

fn enter(c: &mut Arena, who: &str) -> bool {
    fund(c, who, N);
    as_(who, 1);
    let _ = c.enter_tournament(0, format!("m-{who}"));
    assert!(calls()[0].starts_with(&format!(r#"mon.lock({{"token_id":"m-{who}","account_id":"{who}","until_ms":{}}}"#, 72 * 3_600_000)));
    assert_eq!(bal(c, who), 0);
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
    assert_eq!((t.status.as_str(), t.pot.0, t.rounds.clone(), t.game.as_str()), ("live", 4 * N, vec![vec![Some(0), Some(1)], vec![None]], G));
    let m = c.get_match(1).unwrap();
    assert_eq!((m.host, m.guest, m.stake.0, m.status, m.tournament, m.game), (acc("p2"), Some(acc("p3")), 0, "live".into(), Some(0), G.into()));
    assert_eq!(m.monsters, [Some("m-p2".into()), Some("m-p3".into())]);
    assert!(m.bettable);
    bet(&mut c, "bob", 1, N, 0);
    result(&mut c, 0, Some(1));
    has(r#"mon.record_result({"match_id":0,"tokens":["m-p0","m-p1"],"winner":1,"kos":[0,0],"tournament":0})"#);
    assert_eq!(calls()[1], r#"mon.unlock({"locks":[["m-p0",259200000]]})"#); // loser only
    assert_eq!(c.get_tournament(0).unwrap().rounds[1], vec![None]);
    assert!(claim_as(&mut c, "bob") > N / 2);
    assert_eq!(c.claimable(0, acc("p1")).0, 0);
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
    assert_eq!(prize + fee, 4 * N);
    assert_eq!(fee, 4 * N / 1000);
    assert_eq!(bal(&c, "p2"), prize);
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
    result(&mut c, 1, None); // void, random byte 0 -> seat 0: p2
    has(r#"mon.unlock({"locks":[["m-p3",259200000]]})"#);
    result(&mut c, 3, Some(1)); // p7
    as_at("anyone", 0, EXPIRY_NS + 1);
    c.expire(2); // random byte 0 -> p4
    let r = c.get_tournament(0).unwrap().rounds;
    assert_eq!(r[1], vec![Some(4), Some(5)]);
    let (a, b) = (c.get_match(4).unwrap(), c.get_match(5).unwrap());
    assert_eq!((a.host, a.guest), (acc("p1"), Some(acc("p2"))));
    assert_eq!((b.host, b.guest), (acc("p4"), Some(acc("p7"))));
    result(&mut c, 5, Some(0)); // p4
    result(&mut c, 4, Some(1)); // p2, later slot first: host still even slot
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
    fund(&mut c, "p0", N);
    as_("p0", 1);
    let _ = c.enter_tournament(0, "other".into());
}

#[test]
fn duplicate_or_late_entry_in_flight_bounces() {
    let mut c = tourney(4);
    enter(&mut c, "p0");
    cb(true); // 2nd p0 entry passed upfront check before 1st landed
    assert!(!c.on_enter(0, acc("p0"), U128(N), "x".into(), 7));
    assert_eq!(calls(), vec![r#"mon.unlock({"locks":[["x",7]]})"#.to_string()]);
    assert_eq!(bal(&c, "p0"), N);
    for p in ["p1", "p2", "p3"] {
        enter(&mut c, p);
    }
    cb(true); // 5th entry landed after fill
    assert!(!c.on_enter(0, acc("p4"), U128(N), "y".into(), 7));
    assert_eq!(calls(), vec![r#"mon.unlock({"locks":[["y",7]]})"#.to_string()]);
    let mut c = tourney(4);
    cb(false); // lock failed: re-credit, nothing to unlock
    assert!(!c.on_enter(0, acc("p9"), U128(N), "z".into(), 7));
    assert!(calls().is_empty());
    assert_eq!((c.get_tournament(0).unwrap().pot.0, bal(&c, "p9")), (0, N));
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn entry_needs_balance() {
    let mut c = tourney(4);
    fund(&mut c, "p0", N / 2);
    as_("p0", 1);
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
    for p in ["p0", "p1"] {
        as_(p, 0);
        assert_eq!(c.claim_tournament(0).0, N);
        assert_eq!(bal(&c, p), N);
    }
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
    c.create_tournament(G.into(), 6, U128(N), false);
}

#[test]
fn list_tournaments_newest_first() {
    let mut c = setup();
    as_("arena", 1);
    c.register_game("other".into(), acc("ref2"), None);
    for g in [G, "other", G] {
        as_("arena", 1);
        c.create_tournament(g.into(), 4, U128(N), false);
    }
    let ids = |v: Vec<TournamentView>| v.iter().map(|t| t.id).collect::<Vec<u64>>();
    assert_eq!(ids(c.list_tournaments(1, 5, None)), vec![1, 0]);
    assert_eq!(ids(c.list_tournaments(0, 5, Some(G.into()))), vec![2, 0]);
}

/// Void tournament match w/ random byte `r`: seat `r & 1` advances, other unlocked.
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
        result(&mut c, 1, Some(0));
        assert_eq!(c.get_match(2).unwrap().host, acc(adv));
    }
}

#[test]
#[should_panic(expected = "Entry closed")]
fn entry_window_closes() {
    let mut c = tourney(4);
    as_at("p0", 1, TOURNEY_CANCEL_NS + 1);
    let _ = c.enter_tournament(0, "1".into());
}

#[test]
#[should_panic(expected = "Attach 150 Tgas")]
fn entry_needs_gas() {
    let mut c = tourney(4);
    fund(&mut c, "p0", N);
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("arena")).predecessor_account_id(acc("p0")).attached_deposit(NearToken::from_yoctonear(1)).prepaid_gas(Gas::from_tgas(100));
    testing_env!(b.build());
    let _ = c.enter_tournament(0, "1".into());
}
