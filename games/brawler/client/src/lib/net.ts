// Every packet re-sends all local inputs the peer hasn't acked, so a lossy/unreliable channel never stalls for good.
// ponytail: still delay-based; upgrade path = rollback (sim state is a plain object, snapshot via structuredClone).
export type Send = (m: object) => void;

export class Netplay {
  frame = 0;
  stalled = false; // this tick couldn't advance (peer input late)
  stallTicks = 0; // consecutive stalled ticks
  desync = false;
  private local = new Map<number, number>();
  private remote = new Map<number, number>();
  private hashes = new Map<number, number>();
  private remoteHashes = new Map<number, number>();
  private peerNeed = 0; // first local frame the peer hasn't received yet
  private peerFrame = 0; // peer's sim frame, as of its last packet
  private peerAdv = 0; // peer's (its frame - our frame as it last saw it)
  private sinceSkip = 0;
  private send: Send;
  readonly seat: number;
  readonly delay: number;

  // Show 'waiting' only for a real hold-up. 1-3 tick micro-stalls from jitter/frame hitches are invisible in play
  // but used to flash the banner on every one of them.
  get lagging() { return this.stallTicks >= 15; } // 250 ms

  constructor(send: Send, seat: number, delay = 4) {
    this.send = send; this.seat = seat; this.delay = delay;
    for (let f = 0; f < delay; f++) { this.local.set(f, 0); this.remote.set(f, 0); }
  }

  onMessage(m: { t: string; f: number; b?: unknown; a?: number; h?: number; fr?: number; v?: number }) {
    if (m.t === 'in' && Array.isArray(m.b) && Number.isInteger(m.f)) {
      m.b.slice(0, 64).forEach((b, i) => { if (m.f + i >= this.frame) this.remote.set(m.f + i, Number(b) & 255); });
      if (Number.isInteger(m.a) && m.a! > this.peerNeed) this.peerNeed = m.a!;
      if (Number.isInteger(m.fr) && m.fr! > this.peerFrame) this.peerFrame = m.fr!;
      if (Number.isFinite(m.v)) this.peerAdv = m.v!;
    }
    if (m.t === 'hash') { this.remoteHashes.set(m.f, m.h!); this.check(m.f); }
  }

  private check(f: number) {
    const a = this.hashes.get(f), b = this.remoteHashes.get(f);
    if (a === undefined || b === undefined) return;
    if (a !== b) this.desync = true;
    this.hashes.delete(f); this.remoteHashes.delete(f);
  }

  // Called at 60 Hz. Advances 0..2 frames (2 = catching up after a stall), then sends one input packet.
  tick(readLocal: () => number, advance: (inputs: number[]) => void, hashNow: () => number) {
    // Time sync: both sides see the other `latency` frames behind; half the difference is how far we're truly ahead.
    // The side that's ahead would sit at the edge of the delay budget and stall on every timing wobble, so it
    // skips at most 1 tick in 10 (invisible) until both sides share the margin. Timing only, sim stays deterministic.
    const adv = this.frame - this.peerFrame;
    if ((adv - this.peerAdv) / 2 > 1 && ++this.sinceSkip >= 10) { this.sinceSkip = 0; if (!this.remote.has(this.frame)) this.stallTicks++; }
    else this.run(readLocal, advance, hashNow);
    for (const f of this.local.keys()) if (f < this.peerNeed && f < this.frame) this.local.delete(f);
    let need = this.frame;
    while (this.remote.has(need)) need++;
    const b: number[] = [];
    for (let f = this.peerNeed; this.local.has(f) && b.length < 64; f++) b.push(this.local.get(f)!);
    this.send({ t: 'in', f: this.peerNeed, b, a: need, fr: this.frame, v: adv });
  }

  private run(readLocal: () => number, advance: (inputs: number[]) => void, hashNow: () => number) {
    this.stalled = false;
    this.stallTicks++; // reset below once a frame advances
    for (let n = 0; n < 2; n++) {
      const target = this.frame + this.delay;
      if (!this.local.has(target)) this.local.set(target, readLocal());
      const r = this.remote.get(this.frame);
      if (r === undefined) { this.stalled = n === 0; return; }
      const l = this.local.get(this.frame)!;
      advance(this.seat === 0 ? [l, r] : [r, l]);
      this.stallTicks = 0;
      this.remote.delete(this.frame);
      this.frame++;
      if (this.frame % 60 === 0) {
        const h = hashNow();
        this.hashes.set(this.frame, h);
        this.send({ t: 'hash', f: this.frame, h });
        this.check(this.frame);
      }
      // Second step only when the peer's sim is ahead of ours (its input `delay` frames out already arrived).
      if (!this.remote.has(this.frame + this.delay)) return;
    }
  }
}

const FRAME_MS = 1000 / 60;
const P2P_TIMEOUT = 4000;

// WebRTC DataChannel setup, signaled through the relay. Host (seat 0) decides the transport and delay and tells the
// guest with a reliable 'go' over the relay, so both sides always agree. No answer within 4 s -> relay fallback.
// ponytail: STUN only; players behind symmetric NAT fall back to relay. Add a TURN server if that's common.
export function linkPeer(
  relay: WebSocket, seat: number, relayDelay: number, forceRelay: boolean,
  onData: (m: any) => void,
  ready: (send: Send, delay: number, label: string) => void,
) {
  const rsend: Send = (m) => relay.readyState === WebSocket.OPEN && relay.send(JSON.stringify(m));
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let dc: RTCDataChannel | null = null;
  let done = false;
  const pongs: number[] = [];

  const finish = (p2p: boolean, delay: number) => {
    if (done) return;
    done = true;
    if (!p2p) pc.close();
    const send: Send = p2p ? (m) => dc?.readyState === 'open' && dc.send(JSON.stringify(m)) : rsend;
    ready(send, delay, p2p ? 'P2P' : 'RELAY');
  };

  const measure = () => { // host: 3 app-level pings over the channel, worst RTT -> delay (covers jitter seen at connect)
    const iv = setInterval(() => {
      if (done) return clearInterval(iv);
      if (pongs.length < 3) return dc!.send(JSON.stringify({ t: 'p', s: performance.now() }));
      clearInterval(iv);
      const rtt = Math.max(...pongs);
      const delay = Math.min(15, Math.max(2, Math.ceil(rtt / 2 / FRAME_MS) + 2));
      rsend({ t: 'go', p2p: true, delay });
      finish(true, delay);
    }, 100);
  };

  const wire = (ch: RTCDataChannel) => {
    dc = ch;
    ch.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'p') ch.send(JSON.stringify({ t: 'q', s: m.s }));
      else if (m.t === 'q') pongs.push(performance.now() - m.s);
      else onData(m);
    };
    if (seat === 0) ch.onopen = measure;
  };

  pc.onicecandidate = (e) => { if (e.candidate) rsend({ t: 'ice', c: e.candidate }); };
  pc.ondatachannel = (e) => wire(e.channel);

  if (seat === 0) {
    const fallback = () => { if (!done) { rsend({ t: 'go', p2p: false, delay: relayDelay }); finish(false, relayDelay); } };
    if (forceRelay) fallback();
    else {
      setTimeout(fallback, P2P_TIMEOUT);
      wire(pc.createDataChannel('g', { ordered: false, maxRetransmits: 0 }));
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => rsend({ t: 'sdp', d: pc.localDescription }));
    }
  }

  // Signaling messages must apply in order (ICE can't be added before the remote description).
  let chain = Promise.resolve();
  const signal = (m: any) => {
    if (m.t === 'go') return finish(!!m.p2p, m.delay); // outside the chain: a stuck WebRTC call must not block fallback
    chain = chain.then(async () => {
      if (m.t === 'sdp' && !done) {
        await pc.setRemoteDescription(m.d);
        if (m.d.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          rsend({ t: 'sdp', d: pc.localDescription });
        }
      } else if (m.t === 'ice' && !done) await pc.addIceCandidate(m.c);
    }).catch(() => {});
  };
  return { signal, close: () => { done = true; pc.close(); } };
}
