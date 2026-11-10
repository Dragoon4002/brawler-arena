// Arena layouts. Pure data: the sim reads geometry, the renderer reads palette/name.
// All layouts are mirror-symmetric around x = 800 so neither spawn is favoured.

export interface Rect { x0: number; x1: number; y: number; y1: number } // solid: land on top, blocked from sides/below
export interface Ledge { x0: number; x1: number; y: number } // soft: land from above, drop through
export interface StageDef {
  name: string;
  blurb: string;
  solids: Rect[];
  soft: Ledge[];
  blast: { x0: number; x1: number; y0: number; y1: number };
  spawns: { x: number; y: number }[];
  cam: { x0: number; x1: number; y0: number; y1: number }; // box always kept in frame
}

export const STAGES = {
  ember: {
    name: 'Ember Ruins',
    blurb: 'A wide island of broken stone. Big stage, two ledges, room to brawl.',
    solids: [{ x0: 380, x1: 1220, y: 600, y1: 700 }],
    soft: [{ x0: 470, x1: 720, y: 430 }, { x0: 880, x1: 1130, y: 430 }],
    blast: { x0: -250, x1: 1850, y0: -450, y1: 1150 },
    spawns: [{ x: 600, y: 300 }, { x: 1000, y: 300 }],
    cam: { x0: 480, x1: 1120, y0: 380, y1: 640 },
  },
  grove: {
    name: 'Skyroot Grove',
    blurb: 'Two treetop islands split by a gap. Branches stacked high for air fights.',
    solids: [{ x0: 330, x1: 690, y: 620, y1: 700 }, { x0: 910, x1: 1270, y: 620, y1: 700 }],
    soft: [{ x0: 440, x1: 620, y: 450 }, { x0: 700, x1: 900, y: 320 }, { x0: 980, x1: 1160, y: 450 }],
    blast: { x0: -250, x1: 1850, y0: -500, y1: 1150 },
    spawns: [{ x: 510, y: 300 }, { x: 1090, y: 300 }],
    cam: { x0: 440, x1: 1160, y0: 300, y1: 660 },
  },
  docks: {
    name: 'Tidecrest Docks',
    blurb: 'A long low pier over the night sea. Hard to knock anyone off the sides.',
    solids: [{ x0: 300, x1: 1300, y: 640, y1: 690 }],
    soft: [{ x0: 520, x1: 640, y: 500 }, { x0: 740, x1: 860, y: 380 }, { x0: 960, x1: 1080, y: 500 }],
    blast: { x0: -300, x1: 1900, y0: -450, y1: 1150 },
    spawns: [{ x: 560, y: 300 }, { x: 1040, y: 300 }],
    cam: { x0: 440, x1: 1160, y0: 400, y1: 680 },
  },
} satisfies Record<string, StageDef>;

export type StageId = keyof typeof STAGES;
export const STAGE_IDS = Object.keys(STAGES) as StageId[];
