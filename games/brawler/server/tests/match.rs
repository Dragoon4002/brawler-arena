// E2E: host + join + begin free room, golden KO tape -> {t:'over', reason:'ko'}; rematch restarts the same room.
// Room lobby: set, chat, begin guards, leaving while waiting.
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Client: auto-answers pings, other msgs -> rx; send via returned tx (`{t:'__close'}` closes the socket).
async fn client(url: &str) -> (mpsc::UnboundedSender<Value>, mpsc::UnboundedReceiver<Value>) {
    let (ws, _) = connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let (in_tx, in_rx) = mpsc::unbounded_channel();
    let pong = out_tx.clone();
    tokio::spawn(async move {
        while let Some(v) = out_rx.recv().await {
            if v["t"] == "__close" {
                return sink.close().await.unwrap();
            }
            sink.send(Message::Text(v.to_string().into()))
                .await
                .unwrap();
        }
    });
    tokio::spawn(async move {
        while let Some(Ok(Message::Text(t))) = stream.next().await {
            let v: Value = serde_json::from_str(&t).unwrap();
            if v["t"] == "ping" {
                pong.send(json!({ "t": "pong" })).unwrap();
            } else {
                in_tx.send(v).unwrap();
            }
        }
    });
    (out_tx, in_rx)
}

async fn next(rx: &mut mpsc::UnboundedReceiver<Value>) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("closed")
}

async fn until(rx: &mut mpsc::UnboundedReceiver<Value>, t: &str) -> Value {
    loop {
        let v = next(rx).await;
        if v["t"] == t {
            return v;
        }
    }
}

type Tx = mpsc::UnboundedSender<Value>;
type Rx = mpsc::UnboundedReceiver<Value>;

async fn serve() -> String {
    let near = Arc::new(near_svc::Near::new(
        "http://127.0.0.1:9",
        String::new(),
        None,
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    let app = brawler_server::App::new(near, String::new());
    tokio::spawn(async move {
        axum::serve(listener, brawler_server::router(app))
            .await
            .unwrap()
    });
    url
}

fn golden() -> Value {
    let g: Value = serde_json::from_str(include_str!("../../sim/testdata/golden.json")).unwrap();
    g["runs"][4].clone()
}

/// Host + join (optionally on-chain matchId, unchecked w/o CONTRACT_ID), seated in the waiting room.
async fn seated(url: &str, run: &Value, match_id: Value) -> (Tx, Rx, Tx, Rx, Value) {
    let (a, mut ar) = client(url).await;
    let (b, mut br) = client(url).await;
    until(&mut ar, "hello").await;
    until(&mut br, "hello").await;
    a.send(json!({ "t": "host", "name": "A", "dna": run["dna"][0], "stage": run["stage"], "pub": true, "matchId": match_id, "stake": "5" }))
        .unwrap();
    let code = until(&mut ar, "room").await["code"].clone();
    let rs = until(&mut ar, "roomstate").await;
    assert_eq!(
        (rs["status"].as_str(), rs["stake"].as_str()),
        (Some("waiting"), Some("5"))
    );
    assert_eq!(rs["seats"].as_array().unwrap().len(), 1);
    until(&mut ar, "chatlog").await;
    b.send(json!({ "t": "join", "code": code, "name": "B", "dna": run["dna"][1] }))
        .unwrap();
    assert_eq!(until(&mut br, "room").await["seat"], 1);
    until(&mut br, "chatlog").await;
    let rs = until(&mut ar, "roomstate").await;
    assert_eq!(rs["seats"][1]["name"], "B");
    assert_eq!(rs["seats"][1]["connected"], true);
    (a, ar, b, br, code)
}

/// `seated` + host `begin`, both got `start`.
async fn pair(url: &str, run: &Value, match_id: Value) -> (Tx, Rx, Tx, Rx, Value) {
    let (a, mut ar, b, mut br, code) = seated(url, run, match_id).await;
    a.send(json!({ "t": "begin" })).unwrap();
    let (sa, sb) = (until(&mut ar, "start").await, until(&mut br, "start").await);
    assert_eq!(
        (sa["seat"].as_u64(), sb["seat"].as_u64()),
        (Some(0), Some(1))
    );
    assert!((3..=15).contains(&sa["delay"].as_u64().unwrap()));
    (a, ar, b, br, code)
}

async fn play_ko(run: &Value, a: &Tx, ar: &mut Rx, b: &Tx, br: &mut Rx) {
    let tape: Vec<Value> = run["tape"].as_array().unwrap().clone();
    for (i, chunk) in tape.chunks(600).enumerate() {
        let msg = json!({ "t": "tape", "f0": i * 600, "ins": chunk });
        a.send(msg.clone()).unwrap();
        b.send(msg).unwrap();
    }
    let over = until(ar, "over").await;
    assert_eq!(over["reason"], "ko");
    assert_eq!(over["winner"], run["winner"]);
    assert_eq!(until(br, "over").await["winner"], run["winner"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn free_room_to_ko() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar, b, mut br, _) = pair(&url, &run, Value::Null).await;
    play_ko(&run, &a, &mut ar, &b, &mut br).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn rematch_restarts_room() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar, b, mut br, code) = pair(&url, &run, Value::Null).await;
    let (w, mut wr) = client(&url).await;
    w.send(json!({ "t": "watch", "code": code })).unwrap();
    until(&mut wr, "spec").await;
    w.send(json!({ "t": "rematch" })).unwrap();
    assert_eq!(
        until(&mut wr, "error").await["msg"],
        "Spectators can't rematch"
    );
    a.send(json!({ "t": "rematch" })).unwrap();
    assert_eq!(until(&mut ar, "error").await["msg"], "Match is not over");

    play_ko(&run, &a, &mut ar, &b, &mut br).await;
    a.send(json!({ "t": "rematch" })).unwrap();
    until(&mut br, "rematch").await;
    b.send(json!({ "t": "rematch" })).unwrap();
    let (sa, sb) = (until(&mut ar, "start").await, until(&mut br, "start").await);
    assert_eq!(
        (sa["seat"].as_u64(), sb["seat"].as_u64()),
        (Some(0), Some(1))
    );
    let spec = until(&mut wr, "spec").await;
    assert_eq!(spec["status"], "live");
    assert_eq!(spec["frames"].as_array().unwrap().len(), 0);
    play_ko(&run, &a, &mut ar, &b, &mut br).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn on_chain_room_rejected_without_contract() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar) = client(&url).await;
    until(&mut ar, "hello").await;
    a.send(json!({ "t": "host", "name": "A", "dna": run["dna"][0], "stage": run["stage"], "pub": true, "matchId": 7 }))
        .unwrap();
    let msg = until(&mut ar, "error").await["msg"].clone();
    assert!(
        msg.as_str()
            .unwrap()
            .starts_with("This server has no contract configured")
    );
}

async fn err(rx: &mut Rx) -> String {
    until(rx, "error").await["msg"].as_str().unwrap().into()
}

async fn watcher(url: &str, code: &Value, account: &str) -> (Tx, Rx) {
    let (w, mut wr) = client(url).await;
    w.send(json!({ "t": "watch", "code": code, "account": account }))
        .unwrap();
    until(&mut wr, "spec").await;
    until(&mut wr, "roomstate").await;
    (w, wr)
}

#[tokio::test(flavor = "multi_thread")]
async fn set_updates_roomstate() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar, b, mut br, _) = seated(&url, &run, Value::Null).await;
    let dna = run["dna"][0].clone();
    b.send(json!({ "t": "set", "name": "B2", "dna": dna }))
        .unwrap();
    let rs = until(&mut ar, "roomstate").await;
    assert_eq!(rs["seats"][1]["name"], "B2");
    assert_eq!(rs["seats"][1]["dna"], rs["seats"][0]["dna"]);
    b.send(json!({ "t": "set", "stage": "ember" })).unwrap();
    assert_eq!(err(&mut br).await, "Only the host can change the arena");
    a.send(json!({ "t": "set", "stage": "nope" })).unwrap();
    assert_eq!(err(&mut ar).await, "Unknown arena");
    let stage = if run["stage"] == "ember" {
        "grove"
    } else {
        "ember"
    };
    a.send(json!({ "t": "set", "stage": stage })).unwrap();
    assert_eq!(until(&mut br, "roomstate").await["stage"], stage);
    a.send(json!({ "t": "begin" })).unwrap();
    until(&mut ar, "start").await;
    b.send(json!({ "t": "set", "name": "late" })).unwrap();
    assert_eq!(err(&mut br).await, "Match already started");
}

#[tokio::test(flavor = "multi_thread")]
async fn chat_reaches_room_and_late_watcher() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar, b, mut br, code) = seated(&url, &run, Value::Null).await;
    let (w, mut wr) = watcher(&url, &code, "bob.near").await;
    a.send(json!({ "t": "chat", "text": "  hi  " })).unwrap();
    for rx in [&mut ar, &mut br, &mut wr] {
        let c = until(rx, "chat").await;
        assert_eq!(
            (c["from"].as_str(), c["seat"].as_i64(), c["text"].as_str()),
            (Some("A"), Some(0), Some("hi"))
        );
        assert!(c["ts"].as_u64().unwrap() > 0);
    }
    w.send(json!({ "t": "chat", "text": "go B" })).unwrap();
    let c = until(&mut ar, "chat").await;
    assert_eq!(
        (c["from"].as_str(), c["seat"].as_i64()),
        (Some("bob.near"), Some(-1))
    );
    // 2nd msg inside 500 ms dropped; the `set` after it on the same socket proves it was processed
    b.send(json!({ "t": "chat", "text": "x".repeat(300) }))
        .unwrap();
    b.send(json!({ "t": "chat", "text": "spam" })).unwrap();
    b.send(json!({ "t": "chat", "text": "   " })).unwrap();
    b.send(json!({ "t": "set", "name": "B2" })).unwrap();
    let mut chats = vec![];
    loop {
        let v = next(&mut ar).await;
        if v["t"] == "chat" {
            chats.push(v["text"].as_str().unwrap().to_string());
        } else if v["t"] == "roomstate" && v["seats"][1]["name"] == "B2" {
            break;
        }
    }
    assert_eq!(chats, ["x".repeat(200)]);
    let (l, mut lr) = watcher(&url, &code, "").await;
    let log = until(&mut lr, "chatlog").await;
    let texts: Vec<&str> = log["lines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, ["hi", "go B", &"x".repeat(200)]);
    l.send(json!({ "t": "chat", "text": "anon" })).unwrap();
    assert_eq!(until(&mut ar, "chat").await["from"], "Spectator");
}

#[tokio::test(flavor = "multi_thread")]
async fn begin_guards() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar) = client(&url).await;
    a.send(json!({ "t": "host", "name": "A" })).unwrap();
    let code = until(&mut ar, "room").await["code"].clone();
    a.send(json!({ "t": "begin" })).unwrap();
    assert_eq!(err(&mut ar).await, "Waiting for a challenger");
    let (b, mut br) = client(&url).await;
    b.send(json!({ "t": "join", "code": code, "dna": run["dna"][1] }))
        .unwrap();
    until(&mut br, "room").await;
    b.send(json!({ "t": "begin" })).unwrap();
    assert_eq!(err(&mut br).await, "Only the host can start");
}

#[tokio::test(flavor = "multi_thread")]
async fn guest_leave_frees_seat() {
    let url = serve().await;
    let run = golden();
    let (_a, mut ar, b, _br, code) = seated(&url, &run, Value::Null).await;
    b.send(json!({ "t": "__close" })).unwrap();
    let rs = until(&mut ar, "roomstate").await;
    assert_eq!(rs["status"], "waiting");
    assert_eq!(rs["seats"].as_array().unwrap().len(), 1);
    let (c, mut cr) = client(&url).await;
    c.send(json!({ "t": "join", "code": code, "name": "C" }))
        .unwrap();
    assert_eq!(until(&mut cr, "room").await["seat"], 1);
    assert_eq!(until(&mut ar, "roomstate").await["seats"][1]["name"], "C");
}

#[tokio::test(flavor = "multi_thread")]
async fn host_leave_closes_room() {
    let url = serve().await;
    let run = golden();
    let (a, _ar, b, mut br, code) = seated(&url, &run, Value::Null).await;
    a.send(json!({ "t": "__close" })).unwrap();
    until(&mut br, "left").await;
    b.send(json!({ "t": "peek", "code": code })).unwrap();
    assert!(until(&mut br, "peek").await["room"].is_null());
}
