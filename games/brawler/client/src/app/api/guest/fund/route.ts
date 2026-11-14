import { Account, actions, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { FASTAUTH } from '@/lib/fastauth.ts';

// Testnet faucet for guest implicit accounts: new accounts only, 3 per IP per day, 100 per process.
const ID = process.env.FASTAUTH_RELAYER_ID;
const KEY = process.env.FASTAUTH_RELAYER_KEY as KeyPairString | undefined;
const GRANT = 2n * 10n ** 23n; // 0.2 NEAR
const PER_IP = 3, CAP = 100, DAY = 86_400_000;
const rpc = new JsonRpcProvider({ url: FASTAUTH.rpc });
const hits = new Map<string, number[]>(); // ponytail: in-memory, resets on restart and per instance
let total = 0;

export async function POST(req: Request) {
  if (!ID || !KEY) return Response.json({ error: 'relayer not configured' }, { status: 503 });
  const { accountId } = await req.json().catch(() => ({}));
  if (typeof accountId !== 'string' || !/^[0-9a-f]{64}$/.test(accountId)) return Response.json({ error: 'bad account id' }, { status: 400 });
  try {
    if (await rpc.viewAccount({ accountId, blockQuery: { finality: 'optimistic' } }).then(() => true, () => false)) return Response.json({ accountId, funded: false });
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < DAY);
    if (recent.length >= PER_IP || total >= CAP) return Response.json({ error: 'guest faucet limit reached, use a wallet' }, { status: 429 });
    hits.set(ip, [...recent, now]);
    total++;
    await new Account(ID, rpc, KEY).signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(GRANT)] });
    return Response.json({ accountId, funded: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
