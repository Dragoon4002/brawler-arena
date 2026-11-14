use crate::protocol::{
    int_id, lobby_msg, room_row, spec_msg, stage_of, stake_ok, str_of, tape_of, truthy,
};
use crate::room::{RoomRef, Seat, Status};
use crate::{App, GAME, game};
use axum::extract::State;
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use brawler_sim::genes::sanitize;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Instant;
use tokio::sync::{Notify, mpsc};

/// Netplay/signaling messages forwarded verbatim to the other seat.
const RELAYED: [&str; 6] = ["in", "hash", "sdp", "ice", "go", "pick"];
const MAX_MSG: usize = 16 * 1024;
const TAPE_BATCH: usize = 600;
const DENIED: &str = "Wallet signature check failed";
const OTHER_GAME: &str = "Match is for another game";

pub struct Conn {
    pub id: u64,
    tx: mpsc::UnboundedSender<Message>,
    pub pong: Notify,
}

impl Conn {
    pub fn send(&self, v: &Value) {
        self.send_text(v.to_string().into());
    }

    pub fn error(&self, msg: &str) {
        self.send(&json!({ "t": "error", "msg": msg }));
    }

    pub fn close(&self) {
        let _ = self.tx.send(Message::Close(None));
    }

    fn send_text(&self, text: Utf8Bytes) {
        let _ = self.tx.send(Message::Text(text));
    }
}

pub fn broadcast<'a>(conns: impl IntoIterator<Item = &'a Arc<Conn>>, v: &Value) {
    let text: Utf8Bytes = v.to_string().into();
    for c in conns {
        c.send_text(text.clone());
    }
}

pub async fn ws_handler(State(app): State<Arc<App>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(MAX_MSG)
        .max_frame_size(MAX_MSG)
        .on_upgrade(move |sock| run(app, sock))
}

async fn run(app: Arc<App>, sock: WebSocket) {
    let (mut sink, mut stream) = sock.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let conn = Arc::new(Conn {
        id: app.conn_ids.fetch_add(1, Ordering::Relaxed),
        tx,
        pong: Notify::new(),
    });
    tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close {
                break;
            }
        }
    });
    let nonce: [u8; 32] = rand::random();
    conn.send(&json!({ "t": "hello", "nonce": B64.encode(nonce) }));
    let mut session = Session {
        app,
        conn,
        nonce,
        room: None,
    };
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(raw) => {
                let Ok(m) = serde_json::from_str::<Value>(&raw) else {
                    continue;
                };
                session.on_msg(&m, &raw).await;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    session.close();
}

struct Session {
    app: Arc<App>,
    conn: Arc<Conn>,
    /// Sent in `hello`; NEP-413 seat auth must sign it (no replay across sockets).
    nonce: [u8; 32],
    room: Option<RoomRef>,
}

type Reply = Result<(), &'static str>;

impl Session {
    async fn on_msg(&mut self, m: &Value, raw: &Utf8Bytes) {
        self.touch();
        let joined = self.room.is_some();
        let res = match m["t"].as_str().unwrap_or("") {
            "host" if !joined => self.host(m).await,
            "join" if !joined => self.join(m).await,
            "match" if !joined => self.join_match(m).await,
            "watch" if !joined => self.watch(m),
            "peek" => {
                self.peek(m);
                Ok(())
            }
            "lobby" => {
                self.subscribe_lobby();
                Ok(())
            }
            "tape" => {
                self.tape(m);
                Ok(())
            }
            "pong" => {
                self.conn.pong.notify_one();
                Ok(())
            }
            t if RELAYED.contains(&t) => {
                self.relay(raw);
                Ok(())
            }
            _ => Ok(()),
        };
        if let Err(msg) = res {
            self.conn.error(msg);
        }
    }

    /// Any message from a seated player counts as alive (seat can shift when a match room fills).
    fn touch(&self) {
        let Some(at) = &self.room else { return };
        let mut st = self.app.lock();
        if let Some(r) = at.get_mut(&mut st.rooms)
            && let Some(i) = r.seat_of(&self.conn)
        {
            r.seats[i].seen = Instant::now();
        }
    }

    async fn authed(&self, m: &Value, account: &str, match_id: u64) -> bool {
        let near = &self.app.near;
        !self.app.on_chain()
            || near
                .verify_auth(
                    &m["auth"],
                    account,
                    &format!("brawler-arena:{match_id}"),
                    self.nonce,
                )
                .await
    }

    fn seat(&self, m: &Value, default_name: &str, account: String) -> Seat {
        let name = str_of(&m["name"], 24);
        let name = if name.is_empty() {
            default_name.into()
        } else {
            name
        };
        Seat::new(self.conn.clone(), name, sanitize(&m["dna"]), account)
    }

    async fn host(&mut self, m: &Value) -> Reply {
        let match_id = int_id(&m["matchId"]);
        let account = str_of(&m["account"], 64);
        if let Some(id) = match_id
            && self.app.on_chain()
        {
            let Some(mv) = self
                .app
                .get_match(id)
                .await
                .filter(|mv| mv.status == "open" && mv.host == account)
            else {
                return Err("Not the host of this on-chain match");
            };
            if mv.game != GAME {
                return Err(OTHER_GAME);
            }
            if !self.authed(m, &account, id).await {
                return Err(DENIED);
            }
            if self
                .app
                .lock()
                .rooms
                .values()
                .any(|r| r.match_id == Some(id) && r.status != Status::Done)
            {
                return Err("Room for this match already exists");
            }
        }
        let stake = m["stake"]
            .as_str()
            .filter(|s| stake_ok(s))
            .unwrap_or("0")
            .to_string();
        let seat = self.seat(m, "Host", account);
        let mut st = self.app.lock();
        let at = st.open_room(seat, |r| {
            r.public = truthy(&m["pub"]);
            r.view = r.public || truthy(&m["view"]);
            r.bettable = truthy(&m["bettable"]);
            r.match_id = match_id;
            r.stake = stake;
            r.stage = stage_of(&m["stage"]);
        });
        self.conn.send(&json!({ "t": "room", "code": at.code }));
        st.lobby.push(&self.app);
        self.room = Some(at);
        Ok(())
    }

    async fn join(&mut self, m: &Value) -> Reply {
        let code = str_of(&m["code"], 8).to_uppercase();
        let account = str_of(&m["account"], 64);
        let (at, match_id) = self
            .app
            .lock()
            .rooms
            .get(&code)
            .filter(|r| r.status == Status::Waiting && r.seats.len() == 1)
            .map(|r| (r.handle(), r.match_id))
            .ok_or("Room not found or already full")?;
        let mut chain_match = None;
        if let Some(id) = match_id {
            chain_match = self.app.get_match(id).await;
            match &chain_match {
                None if self.app.on_chain() => return Err("Match not found on-chain"),
                Some(x) if x.game != GAME => return Err(OTHER_GAME),
                Some(x) if x.status != "live" => {
                    return Err("Join the match on-chain first (stake not paid yet)");
                }
                Some(x) if x.guest.as_deref() != Some(account.as_str()) => {
                    return Err("Another account paid for this seat");
                }
                _ => {}
            }
            if !self.authed(m, &account, id).await {
                return Err(DENIED);
            }
        }
        {
            let mut st = self.app.lock();
            let r = at
                .get_mut(&mut st.rooms)
                .filter(|r| r.seats.len() == 1 && r.status == Status::Waiting)
                .ok_or("Room already full")?;
            r.seats.push(self.seat(m, "Guest", account));
        }
        self.room = Some(at.clone());
        tokio::spawn(game::begin(self.app.clone(), at, chain_match));
        Ok(())
    }

    /// On-chain match without a pre-made room: 1st arrival opens it, 2nd takes the other seat and starts.
    async fn join_match(&mut self, m: &Value) -> Reply {
        let account = str_of(&m["account"], 64);
        let id = int_id(&m["matchId"]).ok_or("Bad matchId")?;
        let mv = self.app.get_match(id).await.ok_or("Match not found")?;
        if mv.game != GAME {
            return Err(OTHER_GAME);
        }
        if mv.status != "live" {
            return Err("Match is not live on-chain");
        }
        let me: i32 = if account == mv.host {
            0
        } else if mv.guest.as_deref() == Some(account.as_str()) {
            1
        } else {
            return Err("Not a player in this match");
        };
        if !self.authed(m, &account, id).await {
            return Err(DENIED);
        }
        let mine = self.seat(m, if me == 1 { "Guest" } else { "Host" }, account);
        let mut st = self.app.lock();
        match st
            .rooms
            .values_mut()
            .find(|r| r.match_id == Some(id) && r.status == Status::Waiting)
        {
            None => {
                let stake = if stake_ok(&mv.stake) {
                    mv.stake
                } else {
                    "0".into()
                };
                let at = st.open_room(mine, |r| {
                    r.public = mv.bettable;
                    r.view = true;
                    r.bettable = mv.bettable;
                    r.match_id = Some(id);
                    r.stake = stake;
                    r.stage = stage_of(&m["stage"]);
                    r.no_show = Some(me);
                });
                self.conn
                    .send(&json!({ "t": "room", "code": at.code, "seat": me }));
                st.lobby.push(&self.app);
                self.room = Some(at);
            }
            Some(r) => {
                let other = if me == 1 {
                    Some(mv.host.as_str())
                } else {
                    mv.guest.as_deref()
                };
                if r.seats.len() != 1 || Some(r.seats[0].account.as_str()) != other {
                    return Err("Room already taken");
                }
                if me == 1 {
                    r.seats.push(mine);
                } else {
                    r.seats.insert(0, mine);
                }
                let at = r.handle();
                drop(st);
                self.room = Some(at.clone());
                tokio::spawn(game::begin(self.app.clone(), at, Some(mv)));
            }
        }
        Ok(())
    }

    fn watch(&mut self, m: &Value) -> Reply {
        let mut st = self.app.lock();
        let st = &mut *st;
        let r = st
            .rooms
            .get_mut(&str_of(&m["code"], 8).to_uppercase())
            .ok_or("Room not found")?;
        if !r.view {
            return Err("This private room is closed to spectators");
        }
        r.spectators.insert(self.conn.id, self.conn.clone());
        self.room = Some(r.handle());
        self.conn.send(&spec_msg(r));
        st.lobby.push(&self.app);
        Ok(())
    }

    /// Room info by code (private rooms too: code is the secret).
    fn peek(&self, m: &Value) {
        let st = self.app.lock();
        let row = st
            .rooms
            .get(&str_of(&m["code"], 8).to_uppercase())
            .map(room_row);
        self.conn.send(&json!({ "t": "peek", "room": row }));
    }

    fn subscribe_lobby(&self) {
        let mut st = self.app.lock();
        st.lobby.subs.insert(self.conn.id, self.conn.clone());
        self.conn.send(&lobby_msg(&st.rooms));
    }

    fn tape(&self, m: &Value) {
        let (Some(at), Some(f0), Some(ins)) = (&self.room, m["f0"].as_u64(), m["ins"].as_array())
        else {
            return;
        };
        let mut st = self.app.lock();
        let st = &mut *st;
        let Some(r) = at.get_mut(&mut st.rooms) else {
            return;
        };
        let Some(i) = r.seat_of(&self.conn) else {
            return;
        };
        let tape = &mut r.seats[i].tape;
        if f0 != tape.len() as u64 {
            return; // batches arrive in order on one socket; drop dupes
        }
        tape.extend(ins.iter().take(TAPE_BATCH).map(tape_of));
        game::replay(&self.app, r, &mut st.lobby);
    }

    fn relay(&self, raw: &Utf8Bytes) {
        let Some(at) = &self.room else { return };
        let mut st = self.app.lock();
        let Some(r) = at.get_mut(&mut st.rooms) else {
            return;
        };
        if let Some(other) = r.seat_of(&self.conn).and_then(|i| r.opponent(i)) {
            other.send_text(raw.clone());
        }
    }

    fn close(self) {
        let mut st = self.app.lock();
        let st = &mut *st;
        st.lobby.subs.remove(&self.conn.id);
        let Some(at) = self.room else { return };
        let Some(r) = at.get_mut(&mut st.rooms) else {
            return;
        };
        let Some(i) = r.seat_of(&self.conn) else {
            r.spectators.remove(&self.conn.id);
            return st.lobby.push(&self.app);
        };
        r.seats[i].conn = None;
        if let Some(other) = r.opponent(i) {
            other.send(&json!({ "t": "left" }));
        }
        if r.status == Status::Waiting {
            st.rooms.remove(&at.code);
            st.lobby.push(&self.app);
        }
    }
}
