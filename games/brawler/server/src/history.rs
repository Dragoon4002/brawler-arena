//! Finished-match log for player profiles. Appended to HISTORY_FILE (JSON lines) so it survives restarts.
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    sync::Mutex,
};

const KEEP: usize = 20_000;

#[derive(Clone, Serialize, Deserialize)]
pub struct Player {
    pub account: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Rec {
    pub at: u64,
    pub match_id: Option<u64>,
    pub stake: String,
    pub winner: Option<i32>,
    pub reason: String,
    pub players: [Player; 2],
}

pub struct History {
    path: String,
    recs: Mutex<Vec<Rec>>,
}

impl History {
    pub fn load(path: String) -> Self {
        let recs = std::fs::File::open(&path)
            .map(|f| {
                BufReader::new(f)
                    .lines()
                    .map_while(Result::ok)
                    .filter_map(|l| serde_json::from_str(&l).ok())
                    .collect()
            })
            .unwrap_or_default();
        History {
            path,
            recs: Mutex::new(recs),
        }
    }

    pub fn push(&self, r: Rec) {
        if !self.path.is_empty()
            && let Ok(mut f) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
        {
            let _ = writeln!(f, "{}", serde_json::to_string(&r).unwrap_or_default());
        }
        // ponytail: in-memory window + full scan per query; move to SQLite when the log outgrows this
        let mut recs = self.recs.lock().unwrap();
        recs.push(r);
        if recs.len() > KEEP {
            let cut = recs.len() - KEEP;
            recs.drain(..cut);
        }
    }

    /// Newest first.
    pub fn of(&self, account: &str, limit: usize) -> Vec<Rec> {
        let recs = self.recs.lock().unwrap();
        recs.iter()
            .rev()
            .filter(|r| r.players.iter().any(|p| p.account == account))
            .take(limit)
            .cloned()
            .collect()
    }
}
