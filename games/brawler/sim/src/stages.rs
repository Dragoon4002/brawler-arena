// Stage geometry. Port of client src/stages.ts (sim fields only).
pub struct Rect { pub x0: f64, pub x1: f64, pub y: f64, pub y1: f64 }
pub struct Ledge { pub x0: f64, pub x1: f64, pub y: f64 }
pub struct Blast { pub x0: f64, pub x1: f64, pub y0: f64, pub y1: f64 }
pub struct StageDef { pub solids: &'static [Rect], pub soft: &'static [Ledge], pub blast: Blast, pub spawns: [(f64, f64); 2] }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StageId { Ember, Grove, Docks }
pub const STAGE_IDS: [&str; 3] = ["ember", "grove", "docks"];

impl StageId {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s { "ember" => Self::Ember, "grove" => Self::Grove, "docks" => Self::Docks, _ => return None })
    }
    pub fn name(self) -> &'static str { STAGE_IDS[self as usize] }
    pub fn def(self) -> &'static StageDef {
        static EMBER: StageDef = StageDef {
            solids: &[Rect { x0: 380., x1: 1220., y: 600., y1: 700. }],
            soft: &[Ledge { x0: 470., x1: 720., y: 430. }, Ledge { x0: 880., x1: 1130., y: 430. }],
            blast: Blast { x0: -250., x1: 1850., y0: -450., y1: 1150. },
            spawns: [(600., 300.), (1000., 300.)],
        };
        static GROVE: StageDef = StageDef {
            solids: &[Rect { x0: 330., x1: 690., y: 620., y1: 700. }, Rect { x0: 910., x1: 1270., y: 620., y1: 700. }],
            soft: &[Ledge { x0: 440., x1: 620., y: 450. }, Ledge { x0: 700., x1: 900., y: 320. }, Ledge { x0: 980., x1: 1160., y: 450. }],
            blast: Blast { x0: -250., x1: 1850., y0: -500., y1: 1150. },
            spawns: [(510., 300.), (1090., 300.)],
        };
        static DOCKS: StageDef = StageDef {
            solids: &[Rect { x0: 300., x1: 1300., y: 640., y1: 690. }],
            soft: &[Ledge { x0: 520., x1: 640., y: 500. }, Ledge { x0: 740., x1: 860., y: 380. }, Ledge { x0: 960., x1: 1080., y: 500. }],
            blast: Blast { x0: -300., x1: 1900., y0: -450., y1: 1150. },
            spawns: [(560., 300.), (1040., 300.)],
        };
        match self { Self::Ember => &EMBER, Self::Grove => &GROVE, Self::Docks => &DOCKS }
    }
}
