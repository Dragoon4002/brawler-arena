import { test } from 'node:test';
import assert from 'node:assert/strict';
// nft.ts pulls demo.ts, which reads `location` at load.
(globalThis as any).location = { search: '' };
const { toMonster } = await import('./nft.ts');

test('toMonster maps fields and sanitizes dna', () => {
  const m = toMonster({
    token_id: '7', owner_id: 'a.testnet', name: 'Gro', gen: 2, parents: ['1', '2'], breeder: 'b.testnet', born_ms: 5,
    dna: { str: 99, dex: -4, def: 'x', spd: 6, hue: 900, size: 500 }, record: { w: 1, l: 2, ko: 3 }, titles: ['T'],
    price: '5', rent_offer: { price_per_day: '2', max_days: 3 }, rental: { renter: 'c.testnet', until_ms: 9 },
    locked_until_ms: 1, cooldown_until_ms: 2,
  });
  assert.equal(m.id, '7'); assert.equal(m.owner, 'a.testnet'); assert.equal(m.born, 5);
  assert.deepEqual(m.rentOffer, { pricePerDay: '2', maxDays: 3 });
  assert.deepEqual(m.rental, { renter: 'c.testnet', untilMs: 9 });
  assert.equal(m.dna.str + m.dna.dex + m.dna.def + m.dna.spd, 22);
  assert.ok(m.dna.hue <= 359 && m.dna.size <= 115 && m.dna.dex >= 3);
  const bare = toMonster({ ...({} as any), token_id: '1', dna: null, price: null, rent_offer: null, rental: null });
  assert.equal(bare.price, undefined); assert.equal(bare.rental, undefined); assert.deepEqual(bare.titles, []);
});
