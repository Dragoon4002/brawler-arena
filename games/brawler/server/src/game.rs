use crate::protocol::{spec_msg, start_msg};
use crate::referee::Referee;
use crate::room::{Lobby, Room, RoomRef, Status};
use crate::session::{Conn, broadcast};
use crate::{App, ChainMatch};
use brawler_sim::genes::Dna;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};

const FORFEIT: Duration = Duration::from_secs(30);
const NO_SHOW: Duration = Duration::from_secs(5 * 60);
const DONE_TTL: Duration = Duration::from_secs(120);

pub async fn begin(app: Arc<App>, at: RoomRef, chain_match: Option<ChainMatch>) {
    let Some(match_id) = at.get_mut(&mut app.lock().rooms).map(|r| r.match_id) else {
        return;
    };
    let mut dna: [Option<Dna>; 2] = [None, None];
    let mut failed = false;
    if let Some(id) = match_id {
        let chain_match = match chain_match {
            Some(m) => Some(m),
            None => app.get_match(id).await,
        };
        let tokens = chain_match.and_then(|m| m.monsters).unwrap_or_default();
        for (slot, token) in dna.iter_mut().zip(&tokens) {
            let Some(token) = token else { continue };
            *slot = app.monster_dna(token).await;
            failed |= slot.is_none(); // never fall back to client DNA for a chain monster
        }
    }
    let Some((socks, mut start)) = go_live(&app, &at, failed, dna) else {
        return;
    };
    let (a, b) = tokio::join!(rtt(&socks[0]), rtt(&socks[1]));
    start["delay"] = input_delay(a, b).into();
    for (seat, c) in socks.iter().enumerate() {
        start["seat"] = seat.into();
        c.send(&start);
    }
}

/// Frames of input delay: covers A -> relay -> B latency + 2 frames jitter. Same for both seats.
fn input_delay(rtt_a: f64, rtt_b: f64) -> u32 {
    (((rtt_a + rtt_b) / 2. / (1000. / 60.)).ceil() + 2.).clamp(3., 15.) as u32
}

fn go_live(
    app: &Arc<App>,
    at: &RoomRef,
    failed: bool,
    dna: [Option<Dna>; 2],
) -> Option<([Arc<Conn>; 2], Value)> {
    let mut st = app.lock();
    let st = &mut *st;
    let r = at.get_mut(&mut st.rooms)?;
    if failed {
        // on-chain match stays playable on retry (or expires)
        let r = st.rooms.remove(&at.code)?;
        st.lobby.push(app);
        for c in r.players() {
            c.error("Could not load monster from chain, try again");
            c.close();
        }
        return None;
    }
    for (s, d) in r.seats.iter_mut().zip(dna) {
        if let Some(d) = d {
            s.dna = d;
        }
    }
    if r.status != Status::Waiting {
        return None;
    }
    let seated = |i: usize| r.seats.get(i).and_then(|s| s.conn.clone());
    let (Some(host), Some(guest)) = (seated(0), seated(1)) else {
        let mut r = st.rooms.remove(&at.code)?;
        finish(app, &mut r, &mut st.lobby, None, "opponent left");
        return None;
    };
    r.referee = Some(Referee::new(
        app.near.clone(),
        r.match_id,
        [r.seats[0].dna, r.seats[1].dna],
        r.stage,
    ));
    r.status = Status::Live;
    let now = Instant::now();
    r.seats.iter_mut().for_each(|s| s.seen = now);
    broadcast(r.spectators.values(), &spec_msg(r));
    st.lobby.push(app);
    Some(([host, guest], start_msg(r)))
}

/// Worst of 3 app-level pings, ms (proxies answer protocol pings, read ~0). 300 if no answer in 3 s.
async fn rtt(c: &Conn) -> f64 {
    let mut worst = 0f64;
    let pings = async {
        for _ in 0..3 {
            let t = Instant::now();
            c.send(&json!({ "t": "ping" }));
            c.pong.notified().await;
            worst = worst.max(t.elapsed().as_secs_f64() * 1000.);
        }
    };
    match tokio::time::timeout(Duration::from_secs(3), pings).await {
        Ok(()) => worst,
        Err(_) => 300.,
    }
}

pub fn replay(app: &Arc<App>, r: &mut Room, lobby: &mut Lobby) {
    if r.status != Status::Live {
        return;
    }
    let Some(rf) = r.referee.as_mut() else { return };
    let (a, b) = (&r.seats[0].tape, &r.seats[1].tape);
    let f0 = r.frames.len();
    let mut end = None;
    while rf.frame < a.len() && rf.frame < b.len() {
        let f = rf.frame;
        if a[f] != b[f] {
            end = Some((None, "tape mismatch"));
            break;
        }
        let ins = [(a[f] >> 16) & 0xffff, a[f] & 0xffff];
        r.frames.push(ins);
        if rf.step(ins) >= 0 {
            end = Some((Some(rf.state.winner), "ko"));
            break;
        }
    }
    if r.frames.len() > f0 {
        broadcast(
            r.spectators.values(),
            &json!({ "t": "frames", "f0": f0, "ins": &r.frames[f0..] }),
        );
    }
    if let Some((winner, reason)) = end {
        finish(app, r, lobby, winner, reason);
    }
}

pub fn finish(app: &Arc<App>, r: &mut Room, lobby: &mut Lobby, winner: Option<i32>, reason: &str) {
    if r.status == Status::Done {
        return;
    }
    r.status = Status::Done;
    r.winner = winner;
    if reason != "ko"
        && let Some(rf) = &r.referee
    {
        rf.result(winner);
    }
    broadcast(
        r.players().chain(r.spectators.values()),
        &json!({ "t": "over", "winner": winner, "reason": reason }),
    );
    lobby.push(app);
    let (app, at) = (app.clone(), r.handle());
    tokio::spawn(async move {
        tokio::time::sleep(DONE_TTL).await;
        let mut st = app.lock();
        if at.get_mut(&mut st.rooms).is_some() {
            st.rooms.remove(&at.code);
        }
    });
}

pub fn tick(app: &Arc<App>) {
    let mut st = app.lock();
    let st = &mut *st;
    let now = Instant::now();
    for r in st.rooms.values_mut() {
        if r.status == Status::Waiting
            && r.seats.len() == 1
            && now - r.created >= NO_SHOW
            && let Some(winner) = r.no_show
        {
            let d = r.seats[0].dna;
            // fresh game: result() reports kos [0,0]
            r.referee = Some(Referee::new(app.near.clone(), r.match_id, [d, d], r.stage));
            finish(app, r, &mut st.lobby, Some(winner), "no-show");
            continue;
        }
        if r.status != Status::Live {
            continue;
        }
        match [0, 1].map(|i| now - r.seats[i].seen > FORFEIT) {
            [true, true] => finish(app, r, &mut st.lobby, None, "both left"),
            [true, false] => finish(app, r, &mut st.lobby, Some(1), "forfeit"),
            [false, true] => finish(app, r, &mut st.lobby, Some(0), "forfeit"),
            [false, false] => {}
        }
    }
}
