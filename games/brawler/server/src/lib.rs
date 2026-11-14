//! Brawler relay + lobby + referee. Port of old TS relay.
//! - Pairs 2 players by room code, forwards netplay/signaling (players also go P2P).
//! - Public rooms listed in lobby; spectators get confirmed input tape.
//! - Players mirror confirmed inputs here; referee replays + reports KOs/winner on-chain. 30 s silent = forfeit.
//!
//! Protocol: server sends {t:'hello', nonce} (32 B base64). Client first msg one of
//!   {t:'host', name, dna, stage, pub, view, bettable, matchId|null, stake, account, auth?}
//!   {t:'join', code, name, dna, stage, account, auth?}
//!   {t:'match', matchId, account, name, dna, stage, auth}   on-chain match w/o pre-made room
//!   or {t:'watch', code} / {t:'lobby'} / {t:'peek', code}.
//! On-chain seats need auth = {publicKey, signature}: NEP-413 of `brawler-arena:<matchId>`, recipient CONTRACT_ID,
//!   nonce = hello nonce, FullAccess key of `account`. Skipped when CONTRACT_ID unset (local dev).
//! On-chain match must have game == "brawler".
//! Room lobby (host/join): `host` -> {t:'room', code}; `join` -> {t:'room', code, seat:1}. Nothing starts until the host
//!   sends {t:'begin'} (seat 0, waiting, both seats connected). While waiting: {t:'set', name?, dna?, stage?}
//!   (stage host only). {t:'chat', text} from seats/spectators (<=200 chars, 1 per 500 ms) -> {t:'chat', from, seat, text, ts}
//!   (seat -1 = spectator); last 50 kept, sent as {t:'chatlog', lines} on entering (host/join/match/watch).
//!   {t:'roomstate', code, status, stage, stake, matchId, bettable, pub, view, seats:[{name,dna,account,connected}],
//!   spectators} to everyone in the room on enter/set/leave/begin/finish/rematch.
//!   Waiting + host leaves -> room closed, rest get {t:'left'}; guest leaves -> seat freed.
//! `match`: 1st arrival gets {t:'room', code, seat}, 2nd too and the fight auto-begins (tournaments have no host to
//!   press Start); seat = on-chain host 0 / guest 1. Either leaving while waiting closes the room.
//!   Opponent absent NO_SHOW -> present seat wins, {t:'over', winner, reason:'no-show'}.
//! {t:'rematch'} after `over` (free rooms, seats only): opponent gets {t:'rematch'}; once both asked the room
//!   restarts (fresh `start`/`spec`). Opponent gone -> {t:'left'}; else rejected with `error`.

mod game;
mod protocol;
pub mod referee;
mod room;
mod session;

use axum::Router;
use brawler_sim::genes::{Dna, sanitize};
use near_svc::Near;
use room::Shared;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex, MutexGuard, atomic::AtomicU64};
use std::time::Duration;

const GAME: &str = "brawler";

pub struct App {
    shared: Mutex<Shared>,
    near: Arc<Near>,
    /// Monsters NFT contract; empty = no on-chain DNA lookups.
    monsters: String,
    conn_ids: AtomicU64,
}

#[derive(Deserialize)]
struct ChainMatch {
    status: String,
    host: String,
    guest: Option<String>,
    stake: String,
    bettable: bool,
    #[serde(default)]
    monsters: Option<Vec<Option<String>>>,
    #[serde(default)]
    game: String,
}

impl App {
    pub fn new(near: Arc<Near>, monsters: String) -> Arc<Self> {
        Arc::new(App {
            shared: Mutex::default(),
            near,
            monsters,
            conn_ids: AtomicU64::new(1),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock().unwrap()
    }

    fn on_chain(&self) -> bool {
        !self.near.contract.is_empty()
    }

    async fn get_match(&self, id: u64) -> Option<ChainMatch> {
        self.near
            .view(&self.near.contract, "get_match", json!({ "match_id": id }))
            .await
    }

    async fn monster_dna(&self, token: &str) -> Option<Dna> {
        let m: Value = self
            .near
            .view(&self.monsters, "get_monster", json!({ "token_id": token }))
            .await?;
        (!m["dna"].is_null()).then(|| sanitize(&m["dna"]))
    }
}

pub fn router(app: Arc<App>) -> Router {
    let ticker = app.clone();
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_secs(1));
        loop {
            iv.tick().await;
            game::tick(&ticker);
        }
    });
    Router::new().fallback(session::ws_handler).with_state(app)
}
