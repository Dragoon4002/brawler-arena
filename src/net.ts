// Delay-based lockstep: frame f runs only when both players' inputs for f are known.
// Local input is scheduled `delay` frames ahead to hide latency (relay picks it from measured ping).
// ponytail: feels laggy above ~120 ms RTT; upgrade path = rollback (sim state is a plain object, snapshot via structuredClone).
export class Netplay {
  frame = 0;
  stalled = false;
  desync = false;
  private local = new Map<number, number>();
  private remote = new Map<number, number>();
  private hashes = new Map<number, number>();
  private remoteHashes = new Map<number, number>();
  private ws: WebSocket;
  readonly seat: number;
  readonly delay: number;

  constructor(ws: WebSocket, seat: number, delay = 4) {
    this.ws = ws; this.seat = seat; this.delay = delay;
    for (let f = 0; f < delay; f++) { this.local.set(f, 0); this.remote.set(f, 0); }
  }

  onMessage(m: { t: string; f: number; b?: number; h?: number }) {
    if (m.t === 'in') this.remote.set(m.f, m.b! | 0);
    if (m.t === 'hash') { this.remoteHashes.set(m.f, m.h!); this.check(m.f); }
  }

  private check(f: number) {
    const a = this.hashes.get(f), b = this.remoteHashes.get(f);
    if (a === undefined || b === undefined) return;
    if (a !== b) this.desync = true;
    this.hashes.delete(f); this.remoteHashes.delete(f);
  }

  // Called at 60 Hz. Advances 0..2 frames (2 = catching up after a stall).
  tick(readLocal: () => number, advance: (inputs: number[]) => void, hashNow: () => number) {
    this.stalled = false;
    for (let n = 0; n < 2; n++) {
      const target = this.frame + this.delay;
      if (!this.local.has(target)) {
        const b = readLocal();
        this.local.set(target, b);
        this.ws.send(JSON.stringify({ t: 'in', f: target, b }));
      }
      const r = this.remote.get(this.frame);
      if (r === undefined) { this.stalled = n === 0; return; }
      const l = this.local.get(this.frame)!;
      advance(this.seat === 0 ? [l, r] : [r, l]);
      this.local.delete(this.frame); this.remote.delete(this.frame);
      this.frame++;
      if (this.frame % 60 === 0) {
        const h = hashNow();
        this.hashes.set(this.frame, h);
        this.ws.send(JSON.stringify({ t: 'hash', f: this.frame, h }));
        this.check(this.frame);
      }
      // Second step only when the peer's sim is ahead of ours (its input `delay` frames out already arrived).
      if (!this.remote.has(this.frame + this.delay)) return;
    }
  }
}
