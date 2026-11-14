// Replays confirmed input tape w/ same sim as players, reports KOs + winner to platform contract.
use brawler_sim::{
    GameState, StageId,
    genes::{Dna, stats_of},
    new_game, step,
};
use near_svc::Near;
use serde_json::json;
use std::sync::Arc;

pub struct Referee {
    pub state: GameState,
    pub frame: usize,
    kos: u8,
    match_id: Option<u64>,
    near: Arc<Near>,
}

impl Referee {
    pub fn new(near: Arc<Near>, match_id: Option<u64>, dna: [Dna; 2], stage: StageId) -> Self {
        Referee {
            state: new_game([stats_of(&dna[0]), stats_of(&dna[1])], stage),
            frame: 0,
            kos: 0,
            match_id,
            near,
        }
    }

    /// Step one confirmed frame. Winner seat once decided, else -1.
    pub fn step(&mut self, ins: [i32; 2]) -> i32 {
        if self.state.winner >= 0 {
            return self.state.winner;
        }
        step(&mut self.state, ins);
        self.frame += 1;
        let kos = 6 - self
            .state
            .fighters
            .iter()
            .map(|f| f.stocks as u8)
            .sum::<u8>();
        if kos > self.kos {
            self.kos = kos;
            if let Some(id) = self.match_id {
                self.near
                    .call(id, "report_kos", json!({ "match_id": id, "kos": kos }), 30);
            }
        }
        if self.state.winner >= 0 {
            self.result(Some(self.state.winner));
        }
        self.state.winner
    }

    /// kos[i] = KOs scored BY seat i = 3 - opponent stocks.
    pub fn result(&self, winner: Option<i32>) {
        let Some(id) = self.match_id else { return };
        let [a, b] = &self.state.fighters;
        let kos = [3 - b.stocks as u8, 3 - a.stocks as u8];
        self.near.call(
            id,
            "report_result",
            json!({ "match_id": id, "winner": winner, "kos": kos }),
            100,
        );
    }
}
