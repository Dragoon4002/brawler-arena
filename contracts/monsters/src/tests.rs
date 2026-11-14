use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::mock::MockAction;
use near_sdk::testing_env;

const N: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
const T0: u64 = 1_700_000_000_000; // ms

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn as_(who: &str, deposit: u128) {
    as_at(who, deposit, T0);
}

fn as_at(who: &str, deposit: u128, ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("monsters"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(1_000))
        .random_seed([7; 32])
        .block_timestamp(ms * 1_000_000);
    testing_env!(b.build());
}

/// (receiver, yocto) for every transfer scheduled in the current call.
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .iter()
        .flat_map(|r| {
            r.actions.iter().filter_map(|a| match a {
                MockAction::Transfer { deposit, .. } => Some((r.receiver_id.to_string(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

fn setup() -> Monsters {
    as_("owner", 0);
    Monsters::new(acc("owner"), acc("arena"))
}

/// alice owns 0,1,2 (gen 0).
fn with_starters() -> Monsters {
    let mut c = setup();
    as_("alice", N);
    c.hatch_starters();
    c
}

fn dna(v: [u16; 11]) -> Dna {
    Dna {
        str: v[0] as u8,
        dex: v[1] as u8,
        def: v[2] as u8,
        spd: v[3] as u8,
        hue: v[4],
        accent: v[5],
        horn: v[6] as u8,
        tail: v[7] as u8,
        pattern: v[8] as u8,
        eye: v[9] as u8,
        size: v[10] as u8,
    }
}

fn give(c: &mut Monsters, from: &str, to: &str, id: &str) {
    as_(from, 1);
    c.nft_transfer(acc(to), id.into(), None, None);
}

fn result(c: &mut Monsters, match_id: u64, a: &str, b: &str, winner: Option<u8>, ms: u64) {
    as_at("arena", 0, ms);
    c.record_result(match_id, [Some(a.into()), Some(b.into())], winner, [2, 1], None);
}

/// Tournament match: the only kind that counts for season wins.
fn t_result(c: &mut Monsters, match_id: u64, a: &str, b: &str, ms: u64) {
    as_at("arena", 0, ms);
    c.record_result(match_id, [Some(a.into()), Some(b.into())], Some(0), [2, 1], Some(1));
}

/// Callback context: arena-free, called by the contract itself with one promise result.
fn as_callback(ok: bool) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("monsters")).predecessor_account_id(acc("monsters")).block_timestamp(T0 * 1_000_000);
    let r = if ok { near_sdk::PromiseResult::Successful(vec![]) } else { near_sdk::PromiseResult::Failed };
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![r]);
}

/* ---------- genes ---------- */

#[test]
fn gene_vectors_match_ts() {
    // from `node --experimental-strip-types` against src/genes.ts
    let rand: [(u32, [u16; 11], &str); 5] = [
        (0, [5, 4, 7, 6, 168, 196, 2, 1, 1, 2, 97], "Tormak"),
        (1, [4, 3, 6, 9, 348, 101, 2, 2, 1, 3, 101], "Rhator"),
        (42, [6, 5, 5, 6, 62, 189, 1, 1, 2, 1, 97], "Bramfen"),
        (0xdeadbeef, [9, 3, 5, 5, 171, 301, 0, 0, 0, 0, 108], "Brammak"),
        (u32::MAX, [6, 3, 7, 6, 304, 194, 2, 1, 0, 3, 110], "Fenbramox"),
    ];
    for (s, d, name) in rand {
        assert_eq!(genes::random_dna(s), dna(d), "randomDna({s})");
        assert_eq!(genes::name_for(s), name, "nameFor({s})");
    }
    // breed(randomDna(1), randomDna(2), seed); covers no mutation + each mutation kind
    let (a, b) = (genes::random_dna(1), genes::random_dna(2));
    let bred: [(u32, [u16; 11], &str); 10] = [
        (0, [6, 3, 6, 7, 339, 101, 2, 2, 1, 0, 106], "Tormak"),
        (6, [6, 4, 3, 9, 282, 101, 1, 2, 2, 3, 102], "Pelveltor"), // hue
        (14, [6, 3, 6, 7, 333, 101, 1, 2, 1, 3, 106], "Zupel"),    // dex
        (18, [5, 4, 6, 7, 335, 227, 1, 2, 2, 2, 107], "Zumak"),    // eye
        (27, [4, 3, 6, 9, 335, 101, 1, 2, 2, 3, 103], "Bramzuqua"), // horn
        (28, [4, 5, 7, 6, 334, 227, 1, 1, 1, 3, 105], "Bramsu"),   // def
        (34, [6, 3, 5, 8, 328, 227, 2, 2, 1, 0, 105], "Rhamakbram"), // str
        (40, [4, 3, 6, 9, 327, 227, 2, 1, 1, 0, 106], "Quasu"),    // pattern
        (58, [7, 4, 4, 7, 332, 227, 1, 2, 2, 3, 105], "Quavel"),   // spd
        (134, [6, 3, 4, 9, 327, 227, 1, 1, 1, 0, 102], "Zubramdra"), // tail
    ];
    for (s, d, name) in bred {
        assert_eq!(genes::breed(&a, &b, s), dna(d), "breed seed {s}");
        assert_eq!(genes::name_for(s), name);
    }
    // hue mix rounding to 360 wraps to 0
    let (x, y) = (genes::random_dna(104), genes::random_dna(111));
    assert_eq!(genes::breed(&x, &y, 104), dna([9, 5, 3, 5, 0, 275, 1, 1, 0, 0, 112]));
}

/* ---------- hatch ---------- */

#[test]
fn hatch_once_and_refund() {
    let mut c = setup();
    as_("alice", N);
    let v = c.hatch_starters();
    assert_eq!(v.iter().map(|m| m.token_id.as_str()).collect::<Vec<_>>(), ["0", "1", "2"]);
    assert!(v.iter().all(|m| m.r#gen == 0 && m.owner_id == acc("alice") && m.parents.is_none()));
    let t = transfers();
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].0, "alice");
    let storage = N - t[0].1;
    assert!(storage > 0 && storage < N / 10, "storage {storage}");
    // seeds base, base+1, base+2 from random_seed[0..4]
    let base = u32::from_le_bytes([7; 4]);
    assert_eq!(v[1].dna, genes::random_dna(base + 1));
    assert_eq!(v[1].name, genes::name_for(base + 1));
    assert!(c.starters_claimed(acc("alice")));
    assert_eq!(c.monsters_of(acc("alice"), 0, 10).len(), 3);
    assert_eq!(c.nft_total_supply().0, 3);
    assert_eq!(c.nft_token("0".into()).unwrap().metadata.unwrap().title, Some(v[0].name.clone()));
    // JSON keeps the spec field name
    let j = serde_json::to_value(&v[0]).unwrap();
    assert_eq!(j["gen"], 0);
}

#[test]
#[should_panic(expected = "Starters already claimed")]
fn hatch_twice() {
    let mut c = with_starters();
    as_("alice", N);
    c.hatch_starters();
}

#[test]
#[should_panic(expected = "Attach at least")]
fn hatch_needs_storage_deposit() {
    let mut c = setup();
    as_("alice", 0);
    c.hatch_starters();
}

/* ---------- breed ---------- */

#[test]
fn breed_child_fee_and_cooldown() {
    let mut c = with_starters();
    as_("alice", N);
    let k = c.breed("0".into(), "1".into());
    assert_eq!(k.token_id, "3");
    assert_eq!(k.r#gen, 1);
    assert_eq!(k.parents, Some(["0".to_string(), "1".to_string()]));
    assert_eq!(k.breeder, acc("alice"));
    let (a, b) = (c.get_monster("0".into()).unwrap(), c.get_monster("1".into()).unwrap());
    assert_eq!(k.dna, genes::breed(&a.dna, &b.dna, u32::from_le_bytes([7; 4])));
    assert_eq!(a.cooldown_until_ms, T0 + HOUR_MS);
    assert_eq!(c.config().treasury.0, N / 10);
    let t = transfers();
    assert_eq!(t.len(), 1);
    assert!(t[0].1 < N - N / 10 && t[0].1 > N - N / 5); // refund = 1 - 0.1 fee - storage

    // grandchild after cooldown: gen = max + 1
    as_at("alice", N, T0 + HOUR_MS);
    let g = c.breed("3".into(), "2".into());
    assert_eq!(g.r#gen, 2);
}

#[test]
#[should_panic(expected = "Monster is on breeding cooldown")]
fn breed_cooldown() {
    let mut c = with_starters();
    as_("alice", N);
    c.breed("0".into(), "1".into());
    as_at("alice", N, T0 + HOUR_MS - 1);
    c.breed("0".into(), "2".into());
}

#[test]
#[should_panic(expected = "Attach at least")]
fn breed_needs_fee() {
    let mut c = with_starters();
    as_("alice", N / 10); // fee only, no storage
    c.breed("0".into(), "1".into());
}

#[test]
#[should_panic(expected = "Pick two different monsters")]
fn breed_same() {
    let mut c = with_starters();
    as_("alice", N);
    c.breed("0".into(), "0".into());
}

#[test]
#[should_panic(expected = "Not your monster")]
fn breed_not_owner() {
    let mut c = with_starters();
    as_("bob", N);
    c.breed("0".into(), "1".into());
}

/* ---------- market ---------- */

#[test]
fn buy_pays_seller_royalty_and_fee() {
    let mut c = with_starters();
    as_("alice", N);
    c.breed("0".into(), "1".into()); // 3: gen 1, breeder alice
    give(&mut c, "alice", "bob", "3");
    as_("bob", 1);
    c.list("3".into(), U128(10 * N));
    assert_eq!(c.listings(0, 10).len(), 1);
    let before = c.config().treasury.0;

    as_("carol", 10 * N);
    c.buy("3".into());
    let mut t = transfers();
    t.sort();
    assert_eq!(t, vec![("alice".into(), N / 2), ("bob".into(), 10 * N - N / 4 - N / 2)]);
    assert_eq!(c.config().treasury.0 - before, N / 4);
    let m = c.get_monster("3".into()).unwrap();
    assert_eq!(m.owner_id, acc("carol"));
    assert!(m.price.is_none());
    assert!(c.listings(0, 10).is_empty());
}

#[test]
fn buy_gen0_or_own_bred_has_no_royalty() {
    let mut c = with_starters();
    as_("alice", 1);
    c.list("0".into(), U128(4 * N));
    as_("bob", 4 * N);
    c.buy("0".into());
    assert_eq!(transfers(), vec![("alice".to_string(), 4 * N - N / 10)]);
}

#[test]
#[should_panic(expected = "Deposit must equal price")]
fn buy_wrong_deposit() {
    let mut c = with_starters();
    as_("alice", 1);
    c.list("0".into(), U128(N));
    as_("bob", N + 1);
    c.buy("0".into());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn list_needs_one_yocto() {
    let mut c = with_starters();
    as_("alice", 0);
    c.list("0".into(), U128(N));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn offer_rent_needs_one_yocto() {
    let mut c = with_starters();
    as_("alice", 0);
    c.offer_rent("0".into(), U128(N), 3);
}

#[test]
#[should_panic(expected = "Not your monster")]
fn list_not_owner() {
    let mut c = with_starters();
    as_("bob", 1);
    c.list("0".into(), U128(N));
}

#[test]
fn transfer_clears_listing_and_offer() {
    let mut c = with_starters();
    as_("alice", 1);
    c.list("0".into(), U128(N));
    c.offer_rent("0".into(), U128(N), 3);
    give(&mut c, "alice", "bob", "0");
    let m = c.get_monster("0".into()).unwrap();
    assert!(m.price.is_none() && m.rent_offer.is_none());
    assert!(c.listings(0, 10).is_empty() && c.rent_offers(0, 10).is_empty());
}

/* ---------- rentals ---------- */

fn rented() -> Monsters {
    let mut c = with_starters();
    as_("alice", 1);
    c.offer_rent("0".into(), U128(N), 3);
    as_("bob", 2 * N);
    c.rent("0".into(), 2);
    c
}

#[test]
fn rent_pays_owner_and_gives_fight_rights() {
    let mut c = rented();
    assert_eq!(transfers(), vec![("alice".to_string(), 2 * N - 2 * N / 40)]);
    assert_eq!(c.config().treasury.0, 2 * N / 40);
    let m = c.get_monster("0".into()).unwrap();
    assert_eq!(m.rental.as_ref().unwrap().until_ms, T0 + 2 * DAY_MS);
    assert!(m.rent_offer.is_some()); // stays for the next renter
    assert_eq!(c.rented_by(acc("bob")).len(), 1);
    as_("arena", 0);
    c.lock("0".into(), acc("bob"), T0 + 1000);
}

#[test]
#[should_panic(expected = "Rental ends before the match")]
fn renter_lock_capped_by_rental() {
    let mut c = rented();
    as_("arena", 0);
    c.lock("0".into(), acc("bob"), T0 + 2 * DAY_MS + 1);
}

#[test]
fn bounced_transfer_call_clears_rental() {
    let mut c = with_starters();
    as_("alice", 1);
    let _ = c.nft_transfer_call(acc("dex"), "0".into(), None, None, "".into());
    // receiver rents it out before nft_on_transfer returns "give it back"
    as_("dex", 1);
    c.offer_rent("0".into(), U128(N), 3);
    as_("bob", N);
    c.rent("0".into(), 1);
    // nft_on_transfer returned true = return the token
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("monsters")).predecessor_account_id(acc("monsters")).block_timestamp(T0 * 1_000_000);
    let ret = near_sdk::PromiseResult::Successful(serde_json::to_vec(&true).unwrap());
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![ret]);
    assert!(!c.nft_resolve_transfer(acc("alice"), acc("dex"), "0".into(), None));
    let m = c.get_monster("0".into()).unwrap();
    assert_eq!(m.owner_id, acc("alice"));
    assert!(m.rental.is_none() && m.rent_offer.is_none());
    give(&mut c, "alice", "carol", "0"); // free again
}

#[test]
#[should_panic(expected = "Monster is rented out")]
fn owner_cannot_fight_while_rented() {
    let mut c = rented();
    as_("arena", 0);
    c.lock("0".into(), acc("alice"), T0 + 1000);
}

#[test]
#[should_panic(expected = "Monster is busy")]
fn owner_cannot_transfer_while_rented() {
    let mut c = rented();
    give(&mut c, "alice", "carol", "0");
}

#[test]
#[should_panic(expected = "Monster is busy")]
fn owner_cannot_list_while_rented() {
    let mut c = rented();
    as_("alice", 1);
    c.list("0".into(), U128(N));
}

#[test]
#[should_panic(expected = "Monster is busy")]
fn owner_cannot_breed_while_rented() {
    let mut c = rented();
    as_("alice", N);
    c.breed("0".into(), "1".into());
}

#[test]
#[should_panic(expected = "Not your monster")]
fn renter_cannot_list() {
    let mut c = rented();
    as_("bob", 1);
    c.list("0".into(), U128(N));
}

#[test]
#[should_panic(expected = "Monster is busy")]
fn no_double_rent() {
    let mut c = rented();
    as_("carol", N);
    c.rent("0".into(), 1);
}

#[test]
#[should_panic(expected = "Bad rental length")]
fn rent_too_long() {
    let mut c = with_starters();
    as_("alice", 1);
    c.offer_rent("0".into(), U128(N), 3);
    as_("bob", 4 * N);
    c.rent("0".into(), 4);
}

#[test]
fn rental_expires() {
    let mut c = rented();
    as_at("alice", 1, T0 + 2 * DAY_MS);
    c.list("0".into(), U128(N));
    assert!(c.get_monster("0".into()).unwrap().rental.is_none());
    assert!(c.rented_by(acc("bob")).is_empty());
}

/* ---------- arena ---------- */

#[test]
fn lock_blocks_transfer_until_unlock() {
    let mut c = with_starters();
    as_("arena", 0);
    let d = c.lock("0".into(), acc("alice"), T0 + 1000);
    assert_eq!(d, c.get_monster("0".into()).unwrap().dna);
    as_("alice", 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.nft_transfer(acc("bob"), "0".into(), None, None)
    }));
    assert!(r.is_err());
    as_("arena", 0);
    c.unlock(vec![("0".into(), T0 + 1000), ("nope".into(), 1)]);
    assert_eq!(c.get_monster("0".into()).unwrap().locked_until_ms, 0);
    give(&mut c, "alice", "bob", "0");
    // expired lock is free again
    as_("arena", 0);
    c.lock("1".into(), acc("alice"), T0 + 1000);
    as_at("arena", 0, T0 + 1000);
    c.lock("1".into(), acc("alice"), T0 + 2000);
}

#[test]
fn stale_unlock_keeps_newer_lock() {
    let mut c = with_starters();
    as_("arena", 0);
    c.lock("0".into(), acc("alice"), T0 + 1000);
    as_at("arena", 0, T0 + 1000); // old lock expired, new match locks it
    c.lock("0".into(), acc("alice"), T0 + 5000);
    c.unlock(vec![("0".into(), T0 + 1000)]); // late unlock from the old match
    assert_eq!(c.get_monster("0".into()).unwrap().locked_until_ms, T0 + 5000);
    c.unlock(vec![("0".into(), T0 + 5000)]);
    assert_eq!(c.get_monster("0".into()).unwrap().locked_until_ms, 0);
}

#[test]
#[should_panic(expected = "Monster is busy")]
fn double_lock() {
    let mut c = with_starters();
    as_("arena", 0);
    c.lock("0".into(), acc("alice"), T0 + 1000);
    c.lock("0".into(), acc("alice"), T0 + 1000);
}

#[test]
#[should_panic(expected = "Monster is listed for sale")]
fn lock_listed() {
    let mut c = with_starters();
    as_("alice", 1);
    c.list("0".into(), U128(N));
    as_("arena", 0);
    c.lock("0".into(), acc("alice"), T0 + 1000);
}

#[test]
#[should_panic(expected = "Only arena")]
fn lock_arena_only() {
    let mut c = with_starters();
    as_("alice", 0);
    c.lock("0".into(), acc("alice"), T0 + 1000);
}

#[test]
#[should_panic(expected = "Only arena")]
fn unlock_arena_only() {
    let mut c = with_starters();
    as_("alice", 0);
    c.unlock(vec![("0".into(), 0)]);
}

#[test]
#[should_panic(expected = "Only arena")]
fn record_arena_only() {
    let mut c = with_starters();
    as_("alice", 0);
    c.record_result(0, [Some("0".into()), None], Some(0), [1, 0], None);
}

#[test]
#[should_panic(expected = "Only arena")]
fn add_title_arena_only() {
    let mut c = with_starters();
    as_("alice", 0);
    c.add_title("0".into(), "x".into());
}

#[test]
fn record_result_and_history_cap() {
    let mut c = with_starters();
    for i in 0..60 {
        result(&mut c, i, "0", "1", Some(0), T0 + i);
    }
    result(&mut c, 60, "0", "1", None, T0 + 60);
    let a = c.get_monster("0".into()).unwrap().record;
    assert_eq!(a, Record { w: 60, l: 0, ko: 122 });
    assert_eq!(c.get_monster("1".into()).unwrap().record, Record { w: 0, l: 60, ko: 61 });
    let h = c.get_history("0".into());
    assert_eq!(h.len(), MAX_HISTORY);
    assert_eq!(h[0], HistoryEntry { match_id: 60, vs: Some("1".into()), won: None, kos: 2, ms: T0 + 60, tournament: None });
    assert_eq!(h[1].won, Some(true));
    assert_eq!(h[49].match_id, 11);
    // unknown tokens are ignored, not a panic
    as_("arena", 0);
    c.record_result(61, [Some("zzz".into()), None], Some(0), [0, 0], Some(4));
    c.add_title("0".into(), "Tournament #4 Champion".into());
    assert_eq!(c.get_monster("0".into()).unwrap().titles, ["Tournament #4 Champion"]);
}

/* ---------- seasons ---------- */

#[test]
fn season_leaderboard_and_titles() {
    let mut c = with_starters();
    as_("owner", 1);
    c.start_season("S1".into(), T0 + DAY_MS);
    for (i, (w, l)) in [("1", "0"), ("1", "0"), ("2", "0"), ("1", "2"), ("2", "0"), ("2", "1"), ("0", "1")]
        .into_iter()
        .enumerate()
    {
        t_result(&mut c, i as u64, w, l, T0 + 1);
    }
    t_result(&mut c, 99, "0", "1", T0 + DAY_MS); // after ends_ms: not counted
    result(&mut c, 100, "0", "1", Some(0), T0 + 1); // free match: record only, no season win
    assert_eq!(c.get_monster("0".into()).unwrap().record.w, 3);
    assert_eq!(c.get_leaderboard(10), vec![("1".into(), 3), ("2".into(), 3), ("0".into(), 1)]);
    as_("owner", 1);
    c.end_season();
    assert!(!c.get_season().unwrap().active);
    assert_eq!(c.get_monster("1".into()).unwrap().titles, ["S1 Champion"]);
    assert_eq!(c.get_monster("2".into()).unwrap().titles, ["S1 Runner-up"]);
    assert_eq!(c.get_monster("0".into()).unwrap().titles, ["S1 Third"]);

    as_("owner", 1);
    c.start_season("S2".into(), T0 + 2 * DAY_MS);
    assert_eq!(c.get_season().unwrap().id, 2);
    assert!(c.get_leaderboard(10).is_empty());
}

#[test]
#[should_panic(expected = "A season is already active")]
fn one_season_at_a_time() {
    let mut c = setup();
    as_("owner", 1);
    c.start_season("S1".into(), T0 + DAY_MS);
    c.start_season("S2".into(), T0 + DAY_MS);
}

#[test]
#[should_panic(expected = "Only owner")]
fn season_owner_only() {
    let mut c = setup();
    as_("alice", 1);
    c.start_season("S1".into(), T0 + DAY_MS);
}

#[test]
fn season_top3_tracks_overtakes() {
    let mut c = with_starters();
    as_("alice", N);
    c.breed("0".into(), "1".into()); // 3
    as_("owner", 1);
    c.start_season("S1".into(), T0 + DAY_MS);
    // 0:2, 1:1, 2:1, then 3 climbs to 3 and pushes 2 (reached 1 later than 1) out
    for (i, w) in ["0", "0", "1", "2", "3", "3", "3"].into_iter().enumerate() {
        t_result(&mut c, i as u64, w, "0", T0 + 1);
    }
    assert_eq!(c.get_leaderboard(10), vec![("3".into(), 3), ("0".into(), 2), ("1".into(), 1), ("2".into(), 1)]);
    as_("owner", 1);
    c.end_season();
    assert_eq!(c.get_monster("3".into()).unwrap().titles, ["S1 Champion"]);
    assert_eq!(c.get_monster("1".into()).unwrap().titles, ["S1 Third"]);
    assert!(c.get_monster("2".into()).unwrap().titles.is_empty());
}

/* ---------- payouts ---------- */

#[test]
fn failed_payout_is_owed_not_treasury() {
    let mut c = rented(); // alice paid 2 NEAR - fee
    let treasury = c.config().treasury.0;
    as_callback(false);
    assert!(!c.on_pay(acc("alice"), U128(N)));
    assert_eq!(c.owed_of(acc("alice")).0, N);
    assert_eq!(c.config().treasury.0, treasury);
    as_callback(true);
    assert!(c.on_pay(acc("alice"), U128(N)));
    assert_eq!(c.owed_of(acc("alice")).0, N);

    as_("alice", 0);
    assert_eq!(c.withdraw_owed().0, N);
    assert_eq!(transfers(), vec![("alice".to_string(), N)]);
    assert_eq!(c.owed_of(acc("alice")).0, 0);
    as_callback(false); // withdrawal bounced: restored
    c.on_pay(acc("alice"), U128(N));
    assert_eq!(c.owed_of(acc("alice")).0, N);
}

#[test]
#[should_panic(expected = "Nothing owed")]
fn withdraw_owed_empty() {
    let mut c = setup();
    as_("alice", 0);
    c.withdraw_owed();
}

/* ---------- owner ---------- */

#[test]
fn withdraw_treasury() {
    let mut c = with_starters();
    as_("alice", N);
    c.breed("0".into(), "1".into());
    as_("owner", 1);
    c.withdraw_treasury(U128(N / 10));
    assert_eq!(transfers(), vec![("owner".to_string(), N / 10)]);
    assert_eq!(c.config().treasury.0, 0);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn owner_needs_one_yocto() {
    let mut c = setup();
    as_("owner", 0);
    c.set_arena(acc("arena2"));
}
