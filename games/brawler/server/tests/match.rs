// E2E: host + join free room, send golden KO tape, expect {t:'over', reason:'ko'} w/ golden winner.
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

#[tokio::test(flavor = "multi_thread")]
async fn free_room_to_ko() {
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

    let g: Value = serde_json::from_str(include_str!("../../sim/testdata/golden.json")).unwrap();
    let run = &g["runs"][4];
    let (a, mut ar) = client(&url).await;
    let (b, mut br) = client(&url).await;
    until(&mut ar, "hello").await;
    until(&mut br, "hello").await;
    a.send(json!({ "t": "host", "name": "A", "dna": run["dna"][0], "stage": run["stage"] }))
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

    let tape: Vec<Value> = run["tape"].as_array().unwrap().clone();
    for (i, chunk) in tape.chunks(600).enumerate() {
        let msg = json!({ "t": "tape", "f0": i * 600, "ins": chunk });
        a.send(msg.clone()).unwrap();
        b.send(msg).unwrap();
    }
    let over = until(&mut ar, "over").await;
    assert_eq!(over["reason"], "ko");
    assert_eq!(over["winner"], run["winner"]);
    assert_eq!(until(&mut br, "over").await["winner"], run["winner"]);
}
