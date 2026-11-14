import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import { verifyAuth, CONTRACT_ID } from './referee.ts';

test('NEP-413 seat auth: valid passes, tampered / wrong nonce / limited key fail', async () => {
  const kp = KeyPair.fromRandom('ed25519');
  const nonce = randomBytes(32);
  const s = await new KeyPairSigner(kp).signNep413Message('alice.testnet', { message: 'brawler-arena:7', recipient: CONTRACT_ID, nonce });
  const auth = { publicKey: s.publicKey.toString(), signature: Buffer.from(s.signature).toString('base64') };
  const full = { viewAccessKey: async () => ({ permission: 'FullAccess' }) } as any;
  const fnKey = { viewAccessKey: async () => ({ permission: { FunctionCall: {} } }) } as any;
  assert.equal(await verifyAuth(auth, 'alice.testnet', 7, nonce, full), true);
  assert.equal(await verifyAuth(auth, 'alice.testnet', 8, nonce, full), false); // other match
  assert.equal(await verifyAuth(auth, 'alice.testnet', 7, randomBytes(32), full), false); // replayed on another connection
  const bad = Buffer.from(s.signature); bad[0] ^= 1;
  assert.equal(await verifyAuth({ ...auth, signature: bad.toString('base64') }, 'alice.testnet', 7, nonce, full), false);
  assert.equal(await verifyAuth(auth, 'alice.testnet', 7, nonce, fnKey), false); // not FullAccess
  assert.equal(await verifyAuth(null, 'alice.testnet', 7, nonce, full), false);
});
