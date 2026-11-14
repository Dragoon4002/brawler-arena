// E2E: host + join free room, golden KO tape -> {t:'over', reason:'ko'}; rematch restarts the same room.
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Client: auto-answers pings, other msgs -> rx; send via returned tx.
async fn client(url: &str) -> (mpsc::UnboundedSender<Value>, mpsc::UnboundedReceiver<Value>) {
    let (ws, _) = connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let (in_tx, in_rx) = mpsc::unbounded_channel();
    let pong = out_tx.clone();
    tokio::spawn(async move {
        while let Some(v) = out_rx.recv().await {
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

async fn until(rx: &mut mpsc::UnboundedReceiver<Value>, t: &str) -> Value {
    loop {
        let v = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
            .await
            .expect("timeout")
            .expect("closed");
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

/// Host + join (optionally on-chain matchId, unchecked w/o CONTRACT_ID), both got `start`.
async fn pair(url: &str, run: &Value, match_id: Value) -> (Tx, Rx, Tx, Rx, Value) {
    let (a, mut ar) = client(url).await;
    let (b, mut br) = client(url).await;
    until(&mut ar, "hello").await;
    until(&mut br, "hello").await;
    a.send(json!({ "t": "host", "name": "A", "dna": run["dna"][0], "stage": run["stage"], "pub": true, "matchId": match_id }))
        .unwrap();
    let code = until(&mut ar, "room").await["code"].clone();
    b.send(json!({ "t": "join", "code": code, "name": "B", "dna": run["dna"][1] }))
        .unwrap();
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
async fn rematch_rejected_on_chain_room() {
    let url = serve().await;
    let run = golden();
    let (a, mut ar, ..) = pair(&url, &run, json!(7)).await;
    a.send(json!({ "t": "rematch" })).unwrap();
    assert_eq!(
        until(&mut ar, "error").await["msg"],
        "On-chain matches need a new match"
    );
}
