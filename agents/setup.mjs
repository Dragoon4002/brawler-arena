// Creates ai-<persona>.<FUNDER> testnet subaccounts, funds them, deposits into the platform. Keys -> CREDENTIALS_DIR.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Account, JsonRpcProvider, KeyPair, nearToYocto, yoctoToNear } from 'near-api-js';

const env = process.env;
const FUNDER = env.FUNDER ?? 'brawler-platform-5c8e2b.testnet';
const CONTRACT = env.CONTRACT_ID ?? 'brawler-platform-5c8e2b.testnet';
const DIR = env.CREDENTIALS_DIR ?? `${homedir()}/.near-credentials/testnet`;
const FUND = Number(env.AGENT_FUND ?? 1); // NEAR per agent
const DEPOSIT = Number(env.AGENT_DEPOSIT ?? FUND - 0.1); // into the platform, rest pays gas
const RESERVE = 1; // funder keeps this much spendable
const PERSONAS = ['Momentum', 'Underdog', 'Quant'];

const rpc = new JsonRpcProvider({ url: env.NEAR_RPC ?? 'https://test.rpc.fastnear.com' });
const keyOf = (id) => JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8')).private_key;
const exists = (id) => rpc.viewAccount({ accountId: id }).then(() => true, () => false);
const near = (y) => Number(yoctoToNear(BigInt(y)));

const a = await rpc.viewAccount({ accountId: FUNDER });
const free = near(BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n);
const todo = [];
for (const p of PERSONAS) { const id = `ai-${p.toLowerCase()}.${FUNDER}`; if (!(await exists(id))) todo.push([p, id]); }
const need = todo.length * FUND + RESERVE;
console.log(`funder ${FUNDER}: ${free.toFixed(3)} NEAR spendable, need ${need} for ${todo.length} new account(s)`);
if (free < need) { console.error('Not enough funder balance; lower AGENT_FUND or top up the funder. Nothing done.'); process.exit(1); }

const funder = new Account(FUNDER, rpc, keyOf(FUNDER));
mkdirSync(DIR, { recursive: true });
for (const [p, id] of todo) {
  const kp = KeyPair.fromRandom('ed25519');
  const file = `${DIR}/${id}.json`;
  if (existsSync(file)) throw new Error(`${file} exists but account does not; remove it first`);
  writeFileSync(file, JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  await funder.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(String(FUND)) });
  console.log(`created ${p} = ${id}, funded ${FUND} NEAR`);
}
const balOf = async (id) => near((await rpc.callFunction({ contractId: CONTRACT, method: 'balance_of', args: { account_id: id } }).catch(() => '0')) ?? '0');
const retry = async (f, n = 5) => { for (;;) try { return await f(); } catch (e) { if (--n <= 0) throw e; await new Promise((r) => setTimeout(r, 3000)); } };
for (const p of PERSONAS) {
  const id = `ai-${p.toLowerCase()}.${FUNDER}`;
  if (!existsSync(`${DIR}/${id}.json`) || (await balOf(id)) > 0) continue;
  const acct = new Account(id, rpc, keyOf(id)); // fresh key may lag on RPC nodes -> retry
  await retry(() => acct.callFunction({ contractId: CONTRACT, methodName: 'deposit', args: {}, deposit: nearToYocto(DEPOSIT.toFixed(3)), gas: 30_000_000_000_000n }));
  console.log(`${p} deposited ${DEPOSIT.toFixed(3)} NEAR`);
}
for (const p of PERSONAS) {
  const id = `ai-${p.toLowerCase()}.${FUNDER}`;
  console.log(`${p}: ${id} platform balance ${await balOf(id)} NEAR`);
}
console.log(`AGENT_ACCOUNTS='${JSON.stringify(Object.fromEntries(PERSONAS.map((p) => [p, `ai-${p.toLowerCase()}.${FUNDER}`])))}'`);
