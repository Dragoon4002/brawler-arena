//! Brawler relay + lobby + referee. Port of old TS relay.
//! - Pairs 2 players by room code, forwards netplay/signaling (players also go P2P).
//! - Public rooms listed in lobby; spectators get confirmed input tape.
//! - Players mirror confirmed inputs here; referee replays + reports KOs/winner on-chain. 30 s silent = forfeit.
//! Protocol: server sends {t:'hello', nonce} (32 B base64). Client first msg one of
//!   {t:'host', name, dna, stage, pub, view, bettable, matchId|null, stake, account, auth?}
//!   {t:'join', code, name, dna, stage, account, auth?}
//!   {t:'match', matchId, account, name, dna, stage, auth}   on-chain match w/o pre-made room
//!   or {t:'watch', code} / {t:'lobby'} / {t:'peek', code}.
//! On-chain seats need auth = {publicKey, signature}: NEP-413 of `brawler-arena:<matchId>`, recipient CONTRACT_ID,
//!   nonce = hello nonce, FullAccess key of `account`. Skipped when CONTRACT_ID unset (local dev).
//! On-chain match must have game == "brawler".
//! `match`: 1st arrival gets {t:'room', code, seat}, 2nd starts it; seat = on-chain host 0 / guest 1.
//!   Opponent absent NO_SHOW -> present seat wins, {t:'over', winner, reason:'no-show'}.
pub mod referee;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::{extract::State, response::Response, Router};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use brawler_sim::{genes::{sanitize, Dna}, StageId};
use futures_util::{SinkExt, StreamExt};
use near_svc::Near;
use rand::Rng;
use referee::Referee;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Notify};

const LETTERS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
const RELAYED: [&str; 6] = ["in", "hash", "sdp", "ice", "go", "pick"];
const FORFEIT: Duration = Duration::from_secs(30);
const NO_SHOW: Duration = Duration::from_secs(5 * 60);
const GAME: &str = "brawler";

struct Conn { id: u64, tx: mpsc::UnboundedSender<Message>, pong: Notify }
type C = Arc<Conn>;

struct Seat { c: Option<C>, name: String, dna: Dna, account: String, seen: Instant, tape: Vec<i32> }

#[derive(Clone, Copy, PartialEq)]
enum Status { Waiting, Live, Done }

struct Room {
    uid: u64, code: String, public: bool, view: bool, bettable: bool, match_id: Option<u64>, stake: String, stage: StageId,
    seats: Vec<Seat>, spectators: HashMap<u64, C>, status: Status, winner: Option<i32>,
    referee: Option<Referee>, frames: Vec<[i32; 2]>, created: Instant,
    no_show: Option<i32>, // `match` rooms: on-chain seat of 1st arrival (wins if other never shows)
}

#[derive(Deserialize, Clone)]
struct ChainMatch {
    status: String, host: String, guest: Option<String>, stake: String, bettable: bool,
    #[serde(default)] monsters: Option<Vec<Option<String>>>,
    #[serde(default)] game: String,
}

#[derive(Default)]
struct Lobby { subs: HashMap<u64, C>, pending: bool }

#[derive(Default)]
struct St { rooms: HashMap<String, Room>, lobby: Lobby, uid: u64 }

pub struct App { st: Mutex<St>, near: Arc<Near>, monsters: String, ids: AtomicU64 }

impl App {
    pub fn new(near: Arc<Near>, monsters: String) -> Arc<Self> {
        Arc::new(App { st: Mutex::default(), near, monsters, ids: AtomicU64::new(1) })
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, St> { self.st.lock().unwrap() }
    async fn get_match(&self, id: u64) -> Option<ChainMatch> {
        self.near.view(&self.near.contract, "get_match", json!({ "match_id": id })).await
    }
    async fn monster_dna(&self, token: &str) -> Option<Dna> {
        let m: Option<Value> = self.near.view(&self.monsters, "get_monster", json!({ "token_id": token })).await;
        m.and_then(|m| (!m["dna"].is_null()).then(|| sanitize(&m["dna"])))
    }
}

fn send(c: &Conn, v: Value) { let _ = c.tx.send(Message::Text(v.to_string().into())); }
fn err(c: &Conn, msg: &str) { send(c, json!({ "t": "error", "msg": msg })); }

// JS-ish coercions for untrusted json.
fn truthy(v: &Value) -> bool {
    match v { Value::Null => false, Value::Bool(b) => *b, Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.), Value::String(s) => !s.is_empty(), _ => true }
}
fn s(v: &Value, n: usize) -> String {
    match v { Value::String(s) => s.chars().take(n).collect(), Value::Number(x) => x.to_string().chars().take(n).collect(), Value::Bool(b) => b.to_string(), _ => String::new() }
}
fn int_id(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_f64().filter(|f| f.fract() == 0. && *f >= 0. && *f < 9007199254740992.).map(|f| f as u64))
}
fn stake_ok(s: &str) -> bool { (1..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) }
fn stage_of(v: &Value) -> StageId { v.as_str().and_then(StageId::parse).unwrap_or(StageId::Ember) }
/// JS `Number(v) & 0xffff`.
fn u16_of(v: &Value) -> i32 {
    let f = match v { Value::Number(n) => n.as_f64().unwrap_or(0.), Value::Bool(b) => *b as u8 as f64, Value::String(s) => s.trim().parse().unwrap_or(0.), _ => 0. };
    if f.is_finite() { (f.trunc().rem_euclid(4294967296.) as u64 & 0xffff) as i32 } else { 0 }
}

fn players(r: &Room) -> Value {
    r.seats.iter().map(|s| json!({ "name": s.name, "dna": s.dna, "account": s.account })).collect()
}
fn status_str(s: Status) -> &'static str { match s { Status::Waiting => "waiting", Status::Live => "live", Status::Done => "done" } }
fn lobby_row(r: &Room) -> Value {
    json!({ "code": r.code, "pub": r.public, "status": status_str(r.status), "stage": r.stage.name(), "bettable": r.bettable,
        "matchId": r.match_id, "stake": r.stake, "winner": r.winner, "players": players(r), "watchers": r.spectators.len() })
}
fn spec_msg(r: &Room) -> Value {
    json!({ "t": "spec", "code": r.code, "stage": r.stage.name(), "status": status_str(r.status), "winner": r.winner,
        "matchId": r.match_id, "bettable": r.bettable, "players": players(r), "frames": r.frames })
}
fn lobby_list(rooms: &HashMap<String, Room>) -> Value {
    rooms.values().filter(|r| (r.public || r.view) && r.status != Status::Done).map(lobby_row).collect()
}

fn new_code(rooms: &HashMap<String, Room>) -> String {
    let mut rng = rand::rng();
    loop {
        let c: String = (0..4).map(|_| LETTERS[rng.random_range(0..LETTERS.len())] as char).collect();
        if !rooms.contains_key(&c) { return c; }
    }
}

/// Throttled: max 1 lobby broadcast / 500 ms.
fn push_lobby(app: &Arc<App>, l: &mut Lobby) {
    if l.pending { return; }
    l.pending = true;
    let app = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let mut st = app.lock();
        st.lobby.pending = false;
        let msg = json!({ "t": "lobby", "rooms": lobby_list(&st.rooms) });
        for c in st.lobby.subs.values() { send(c, msg.clone()); }
    });
}

fn finish(app: &Arc<App>, r: &mut Room, lobby: &mut Lobby, winner: Option<i32>, reason: &str) {
    if r.status == Status::Done { return; }
    r.status = Status::Done;
    r.winner = winner;
    if reason != "ko" { if let Some(rf) = &r.referee { rf.result(winner); } } // on KO referee already reported
    let msg = json!({ "t": "over", "winner": winner, "reason": reason });
    r.seats.iter().filter_map(|s| s.c.as_ref()).chain(r.spectators.values()).for_each(|c| send(c, msg.clone()));
    push_lobby(app, lobby);
    let (app, code, uid) = (app.clone(), r.code.clone(), r.uid);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(120)).await;
        let mut st = app.lock();
        if st.rooms.get(&code).is_some_and(|r| r.uid == uid) { st.rooms.remove(&code); }
    });
}

/// Advance referee while both tapes agree on next frame.
fn replay(app: &Arc<App>, r: &mut Room, lobby: &mut Lobby) {
    if r.status != Status::Live { return; }
    let Some(rf) = r.referee.as_mut() else { return };
    let (a, b) = (&r.seats[0].tape, &r.seats[1].tape);
    let mut fresh = vec![];
    let mut end = None;
    while rf.frame < a.len() && rf.frame < b.len() {
        let f = rf.frame;
        if a[f] != b[f] { end = Some((None, "tape mismatch")); break; } // ponytail: tapes packed host<<8|guest
        let ins = [a[f] >> 8, a[f] & 255];
        r.frames.push(ins);
        fresh.push(ins);
        if rf.step(ins) >= 0 { end = Some((Some(rf.state.winner), "ko")); break; }
    }
    if !fresh.is_empty() {
        let msg = json!({ "t": "frames", "f0": r.frames.len() - fresh.len(), "ins": fresh });
        r.spectators.values().for_each(|c| send(c, msg.clone()));
    }
    if let Some((w, why)) = end { finish(app, r, lobby, w, why); }
}

/// Worst of 3 app-level pings, ms (proxies answer protocol pings, read ~0). 300 if no answer in 3 s.
async fn rtt(c: C) -> f64 {
    let mut worst = 0f64;
    let ok = tokio::time::timeout(Duration::from_secs(3), async {
        for _ in 0..3 {
            let t = Instant::now();
            send(&c, json!({ "t": "ping" }));
            c.pong.notified().await;
            worst = worst.max(t.elapsed().as_secs_f64() * 1000.);
        }
    }).await;
    if ok.is_ok() { worst } else { 300. }
}

fn room_mut<'a>(st: &'a mut St, at: &(String, u64)) -> Option<&'a mut Room> {
    st.rooms.get_mut(&at.0).filter(|r| r.uid == at.1)
}

/// Sync part of begin: apply DNA, go live. Some(start info) when rtt + start should follow.
fn go_live(app: &Arc<App>, at: &(String, u64), failed: bool, dna: [Option<Dna>; 2]) -> Option<(Vec<C>, Value, Option<u64>, bool)> {
    let mut st = app.lock();
    let St { rooms, lobby, .. } = &mut *st;
    let Some(r) = rooms.get_mut(&at.0).filter(|r| r.uid == at.1) else { return None };
    if failed { // on-chain match stays playable on retry (or expires)
        let r = rooms.remove(&at.0).unwrap();
        push_lobby(app, lobby);
        for c in r.seats.iter().filter_map(|s| s.c.as_ref()) { err(c, "Could not load monster from chain, try again"); let _ = c.tx.send(Message::Close(None)); }
        return None;
    }
    for (s, d) in r.seats.iter_mut().zip(dna) { if let Some(d) = d { s.dna = d; } }
    if r.status != Status::Waiting { return None; }
    if r.seats.len() < 2 || r.seats.iter().any(|s| s.c.is_none()) { // someone left during lookups
        let mut r = rooms.remove(&at.0).unwrap();
        finish(app, &mut r, lobby, None, "opponent left");
        return None;
    }
    r.referee = Some(Referee::new(app.near.clone(), r.match_id, [r.seats[0].dna, r.seats[1].dna], r.stage));
    r.status = Status::Live;
    let now = Instant::now();
    r.seats.iter_mut().for_each(|s| s.seen = now);
    let spec = spec_msg(r);
    r.spectators.values().for_each(|c| send(c, spec.clone()));
    push_lobby(app, lobby);
    let socks: Vec<C> = r.seats.iter().map(|s| s.c.clone().unwrap()).collect();
    let (players, mid, bettable) = (players(r), r.match_id, r.bettable);
    Some((socks, players, mid, bettable))
}

/// Both seats filled: swap in on-chain monster DNA, create referee, go live, measure rtt, send start.
async fn begin(app: Arc<App>, at: (String, u64), mv: Option<ChainMatch>) {
    let match_id = { let mut st = app.lock(); match room_mut(&mut st, &at) { Some(r) => r.match_id, None => return } };
    let mut dna: [Option<Dna>; 2] = [None, None];
    let mut failed = false;
    if let Some(id) = match_id {
        let mv = match mv { Some(m) => Some(m), None => app.get_match(id).await };
        let mons = mv.and_then(|m| m.monsters).unwrap_or_default();
        for (i, tok) in mons.iter().take(2).enumerate() {
            let Some(tok) = tok else { continue };
            let d = if app.monsters.is_empty() { None } else { app.monster_dna(tok).await };
            if d.is_some() { dna[i] = d; } else { failed = true; } // never fall back to client DNA for chain monster
        }
    }
    let Some((socks, players, mid, bettable)) = go_live(&app, &at, failed, dna) else { return };
    // Input delay covers A -> relay -> B latency + 2 frames jitter. Same for both seats.
    let (a, b) = tokio::join!(rtt(socks[0].clone()), rtt(socks[1].clone()));
    let delay = (((a + b) / 2. / (1000. / 60.)).ceil() + 2.).clamp(3., 15.) as u32;
    for (i, c) in socks.iter().enumerate() {
        send(c, json!({ "t": "start", "seat": i, "delay": delay, "matchId": mid, "bettable": bettable, "players": players }));
    }
}

/// 1 s tick: no-show + forfeit (player silent 30 s loses, both silent -> refund).
fn tick(app: &Arc<App>) {
    let now = Instant::now();
    let mut st = app.lock();
    let St { rooms, lobby, .. } = &mut *st;
    for r in rooms.values_mut() {
        if r.status == Status::Waiting && r.seats.len() == 1 && now - r.created >= NO_SHOW && let Some(w) = r.no_show {
            let d = r.seats[0].dna;
            r.referee = Some(Referee::new(app.near.clone(), r.match_id, [d, d], r.stage)); // fresh game: result() reports kos [0,0]
            finish(app, r, lobby, Some(w), "no-show");
            continue;
        }
        if r.status != Status::Live { continue; }
        let gone: Vec<bool> = r.seats.iter().map(|s| now - s.seen > FORFEIT).collect();
        if gone[0] && gone[1] { finish(app, r, lobby, None, "both left"); }
        else if gone[0] || gone[1] { finish(app, r, lobby, Some(if gone[0] { 1 } else { 0 }), "forfeit"); }
    }
}

pub fn router(app: Arc<App>) -> Router {
    let t = app.clone();
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_secs(1));
        loop { iv.tick().await; tick(&t); }
    });
    Router::new().fallback(ws_handler).with_state(app)
}

async fn ws_handler(State(app): State<Arc<App>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(16 * 1024).max_frame_size(16 * 1024).on_upgrade(move |sock| conn(app, sock))
}

async fn conn(app: Arc<App>, sock: WebSocket) {
    let (mut sink, mut stream) = sock.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let c: C = Arc::new(Conn { id: app.ids.fetch_add(1, Ordering::Relaxed), tx, pong: Notify::new() });
    tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close { break; }
        }
    });
    let nonce: [u8; 32] = rand::random();
    send(&c, json!({ "t": "hello", "nonce": B64.encode(nonce) }));
    let mut room: Option<(String, u64)> = None;
    while let Some(Ok(msg)) = stream.next().await {
        let Message::Text(raw) = msg else { if matches!(msg, Message::Close(_)) { break } else { continue } };
        let Ok(m) = serde_json::from_str::<Value>(raw.as_str()) else { continue };
        on_msg(&app, &c, &mut room, nonce, &m, raw.as_str()).await;
    }
    on_close(&app, &c, room);
}

fn seat_of(r: &Room, c: &Conn) -> Option<usize> { r.seats.iter().position(|s| s.c.as_ref().is_some_and(|x| x.id == c.id)) }

fn new_room(st: &mut St, code: String, seat: Seat, f: impl FnOnce(&mut Room)) -> (String, u64) {
    st.uid += 1;
    let mut r = Room {
        uid: st.uid, code: code.clone(), public: false, view: false, bettable: false, match_id: None, stake: "0".into(), stage: StageId::Ember,
        seats: vec![seat], spectators: HashMap::new(), status: Status::Waiting, winner: None, referee: None, frames: vec![],
        created: Instant::now(), no_show: None,
    };
    f(&mut r);
    let at = (code.clone(), r.uid);
    st.rooms.insert(code, r);
    at
}

async fn on_msg(app: &Arc<App>, c: &C, room: &mut Option<(String, u64)>, nonce: [u8; 32], m: &Value, raw: &str) {
    const DENIED: &str = "Wallet signature check failed";
    let chain = !app.near.contract.is_empty();
    let authed = |acct: String, id: u64| async move { !chain || app.near.verify_auth(&m["auth"], &acct, &format!("brawler-arena:{id}"), nonce).await };
    if let Some(at) = room.as_ref() { // seat can shift when match room fills
        let mut st = app.lock();
        if let Some(r) = room_mut(&mut st, at) && let Some(i) = seat_of(r, c) { r.seats[i].seen = Instant::now(); }
    }
    let seat = |name: &str, acct: String| Seat { c: Some(c.clone()), name: name.into(), dna: sanitize(&m["dna"]), account: acct, seen: Instant::now(), tape: vec![] };
    let name = s(&m["name"], 24);
    let t = m["t"].as_str().unwrap_or("");

    match t {
        "host" if room.is_none() => {
            let match_id = int_id(&m["matchId"]);
            let acct = s(&m["account"], 64);
            if let Some(id) = match_id && chain { // staked/bettable: must be on-chain host
                let mv = app.get_match(id).await;
                if !mv.as_ref().is_some_and(|mv| mv.status == "open" && mv.host == acct) { return err(c, "Not the host of this on-chain match"); }
                if mv.is_some_and(|mv| mv.game != GAME) { return err(c, "Match is for another game"); }
                if !authed(acct.clone(), id).await { return err(c, DENIED); }
                if app.lock().rooms.values().any(|x| x.match_id == Some(id) && x.status != Status::Done) { return err(c, "Room for this match already exists"); }
            }
            let mut st = app.lock();
            let code = new_code(&st.rooms);
            let stake = m["stake"].as_str().filter(|x| stake_ok(x)).unwrap_or("0").to_string();
            let s0 = seat(if name.is_empty() { "Host" } else { &name }, acct);
            *room = Some(new_room(&mut st, code.clone(), s0, |r| {
                r.public = truthy(&m["pub"]); r.view = r.public || truthy(&m["view"]); r.bettable = truthy(&m["bettable"]);
                r.match_id = match_id; r.stake = stake; r.stage = stage_of(&m["stage"]);
            }));
            send(c, json!({ "t": "room", "code": code }));
            push_lobby(app, &mut st.lobby);
        }
        "join" if room.is_none() => {
            let code = s(&m["code"], 8).to_uppercase();
            let acct = s(&m["account"], 64);
            let Some((at, match_id)) = ({
                let st = app.lock();
                st.rooms.get(&code).filter(|r| r.status == Status::Waiting && r.seats.len() == 1).map(|r| ((code.clone(), r.uid), r.match_id))
            }) else { return err(c, "Room not found or already full") };
            let mut mv = None;
            if let Some(id) = match_id { // staked/bettable: guest must have joined on-chain first, and prove account
                mv = app.get_match(id).await;
                match &mv {
                    None if chain => return err(c, "Match not found on-chain"),
                    Some(x) if x.game != GAME => return err(c, "Match is for another game"),
                    Some(x) if x.status != "live" => return err(c, "Join the match on-chain first (stake not paid yet)"),
                    Some(x) if x.guest.as_deref() != Some(acct.as_str()) => return err(c, "Another account paid for this seat"),
                    _ => {}
                }
                if !authed(acct.clone(), id).await { return err(c, DENIED); }
            }
            {
                let mut st = app.lock();
                let Some(r) = room_mut(&mut st, &at).filter(|r| r.seats.len() == 1 && r.status == Status::Waiting) else { return err(c, "Room already full") };
                r.seats.push(seat(if name.is_empty() { "Guest" } else { &name }, acct));
            }
            *room = Some(at.clone());
            tokio::spawn(begin(app.clone(), at, mv));
        }
        "match" if room.is_none() => {
            let acct = s(&m["account"], 64);
            let Some(id) = int_id(&m["matchId"]) else { return err(c, "Bad matchId") };
            let Some(mv) = app.get_match(id).await else { return err(c, "Match not found") };
            if mv.game != GAME { return err(c, "Match is for another game"); }
            if mv.status != "live" { return err(c, "Match is not live on-chain"); }
            let me = if acct == mv.host { 0 } else if mv.guest.as_deref() == Some(acct.as_str()) { 1 } else { return err(c, "Not a player in this match") };
            if !authed(acct.clone(), id).await { return err(c, DENIED); }
            let mine = seat(if !name.is_empty() { &name } else if me == 1 { "Guest" } else { "Host" }, acct);
            let mut st = app.lock();
            let open = st.rooms.values().find(|x| x.match_id == Some(id) && x.status == Status::Waiting).map(|r| (r.code.clone(), r.uid));
            match open {
                None => {
                    let code = new_code(&st.rooms);
                    let stake = if stake_ok(&mv.stake) { mv.stake.clone() } else { "0".into() };
                    *room = Some(new_room(&mut st, code.clone(), mine, |r| {
                        r.public = mv.bettable; r.view = true; r.bettable = mv.bettable; r.match_id = Some(id);
                        r.stake = stake; r.stage = stage_of(&m["stage"]); r.no_show = Some(me);
                    }));
                    send(c, json!({ "t": "room", "code": code, "seat": me }));
                    push_lobby(app, &mut st.lobby);
                }
                Some(at) => {
                    let r = room_mut(&mut st, &at).unwrap();
                    let other = if me == 1 { Some(mv.host.as_str()) } else { mv.guest.as_deref() };
                    if r.seats.len() != 1 || Some(r.seats[0].account.as_str()) != other { return err(c, "Room already taken"); }
                    if me == 1 { r.seats.push(mine) } else { r.seats.insert(0, mine) }
                    *room = Some(at.clone());
                    drop(st);
                    tokio::spawn(begin(app.clone(), at, Some(mv)));
                }
            }
        }
        "peek" => { // room info by code (private rooms too: code is the secret)
            let st = app.lock();
            send(c, json!({ "t": "peek", "room": st.rooms.get(&s(&m["code"], 8).to_uppercase()).map(lobby_row) }));
        }
        "watch" if room.is_none() => {
            let mut st = app.lock();
            let St { rooms, lobby, .. } = &mut *st;
            let Some(r) = rooms.get_mut(&s(&m["code"], 8).to_uppercase()) else { return err(c, "Room not found") };
            if !r.view { return err(c, "This private room is closed to spectators"); }
            r.spectators.insert(c.id, c.clone());
            *room = Some((r.code.clone(), r.uid));
            send(c, spec_msg(r));
            push_lobby(app, lobby);
        }
        "lobby" => {
            let mut st = app.lock();
            st.lobby.subs.insert(c.id, c.clone());
            send(c, json!({ "t": "lobby", "rooms": lobby_list(&st.rooms) }));
        }
        "tape" => {
            let (Some(at), Some(f0), Some(ins)) = (room.as_ref(), m["f0"].as_u64(), m["ins"].as_array()) else { return };
            let mut st = app.lock();
            let St { rooms, lobby, .. } = &mut *st;
            let Some(r) = rooms.get_mut(&at.0).filter(|r| r.uid == at.1) else { return };
            let Some(i) = seat_of(r, c) else { return };
            let tape = &mut r.seats[i].tape;
            if f0 as usize != tape.len() { return; } // batches in order on one socket; drop dupes
            tape.extend(ins.iter().take(600).map(u16_of));
            replay(app, r, lobby);
        }
        "pong" => c.pong.notify_one(),
        t if RELAYED.contains(&t) => {
            let Some(at) = room.as_ref() else { return };
            let mut st = app.lock();
            let Some(r) = room_mut(&mut st, at) else { return };
            let Some(i) = seat_of(r, c) else { return };
            if let Some(o) = r.seats.get(1 - i).and_then(|s| s.c.as_ref()) { let _ = o.tx.send(Message::Text(raw.to_string().into())); }
        }
        _ => {}
    }
}

fn on_close(app: &Arc<App>, c: &C, room: Option<(String, u64)>) {
    let mut st = app.lock();
    let St { rooms, lobby, .. } = &mut *st;
    lobby.subs.remove(&c.id);
    let Some(at) = room else { return };
    let Some(r) = rooms.get_mut(&at.0).filter(|r| r.uid == at.1) else { return };
    let Some(i) = seat_of(r, c) else { r.spectators.remove(&c.id); return push_lobby(app, lobby); };
    r.seats[i].c = None;
    if let Some(o) = r.seats.get(1 - i).and_then(|s| s.c.as_ref()) { send(o, json!({ "t": "left" })); }
    if r.status == Status::Waiting { rooms.remove(&at.0); push_lobby(app, lobby); } // host left before anyone joined
    // live: 30 s forfeit timer decides
}
