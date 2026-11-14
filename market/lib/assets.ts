"use client";
import { useNearWallet } from "near-connect-hooks";
import { nearToYocto, yoctoToNear } from "near-api-js";
import { demoApi } from "./demo";

export const ASSETS_ID = process.env.NEXT_PUBLIC_ASSETS_ID || "brawler-monsters-5c8e2b.testnet";
export const BRAWLER_URL = process.env.NEXT_PUBLIC_BRAWLER_URL || "https://65-0-237-185.sslip.io";
export const DEMO =
  process.env.NEXT_PUBLIC_DEMO === "1" ||
  (typeof window !== "undefined" &&
    (new URLSearchParams(location.search).has("demo") || sessionStorage.getItem("demo") === "1") &&
    (sessionStorage.setItem("demo", "1"), true));
const GAS = "30000000000000", GAS_X = "100000000000000";
const STORAGE = nearToYocto("0.02"); // contract refunds unused storage deposit

export const STAT_KINDS = ["Power", "Agility", "Durability", "Speed"] as const;
export const EFFECT_KINDS = ["AirJump", "Lifesteal", "QuickDodge", "SecondWind"] as const;
export const KINDS = [...STAT_KINDS, ...EFFECT_KINDS];
export const RARITIES = ["Common", "Rare", "Epic"] as const;
export type Kind = (typeof KINDS)[number];
export type Rarity = (typeof RARITIES)[number];

export interface Skill {
  id: number; collection: number; name: string; kind: Kind; mag: number; rarity: Rarity;
  max_supply: string | null; minted: string; creator: string; royalty_bps: number; media: string;
  floor: string | null; last_price: string | null; listed_qty: string;
}
export interface Collection { id: number; name: string; description: string; media: string; creator: string }
export interface Presale {
  id: number; skill: number; price: string; start_ms: number; end_ms: number | null;
  cap_total: string | null; per_wallet: string | null; sold: string; allowlist: boolean; ended: boolean;
}
export interface SkillListing { seller: string; skill: number; qty: string; price_each: string }
export interface Dna { str: number; dex: number; def: number; spd: number; hue: number; accent: number }
export interface Monster {
  token_id: string; owner_id: string; name: string; gen: number; dna: Dna;
  record: { w: number; l: number; ko: number }; price: string | null; locked_until_ms: number;
  skills: { id: number; kind: Kind; mag: number }[];
}
export interface Holding { skill: number; free: string; listed: string; equipped: number }
export type Point = [number, string];
export interface NewSkill { collection: number; name: string; kind: Kind; mag: number; rarity: Rarity; max_supply: string | null; royalty_bps: number; media: string }
export interface NewPresale { skill: number; price: string; start_ms: number; end_ms: number | null; cap_total: string | null; per_wallet: string | null; allowlist: string[] | null }

export interface Api {
  demo: boolean; account: string | null; signIn(): void; signOut(): void;
  skills(): Promise<Skill[]>;
  collections(): Promise<Collection[]>;
  presales(): Promise<Presale[]>;
  monsters(): Promise<Monster[]>;
  monster(id: string): Promise<Monster | null>;
  history(key: string): Promise<Point[]>;
  skillListings(skill: number): Promise<SkillListing[]>;
  presaleBought(id: number): Promise<string>;
  presaleAllowed(id: number): Promise<boolean>;
  isCreator(): Promise<boolean>;
  holdings(): Promise<Holding[]>;
  myMonsters(): Promise<Monster[]>;
  owed(): Promise<string>;
  buySkill(l: SkillListing, qty: number): Promise<unknown>;
  listSkill(skill: number, qty: number, priceEach: string): Promise<unknown>;
  cancelSkillListing(skill: number): Promise<unknown>;
  buyPresale(p: Presale, qty: number): Promise<unknown>;
  buyMonster(m: Monster): Promise<unknown>;
  listMonster(id: string, price: string): Promise<unknown>;
  delistMonster(id: string): Promise<unknown>;
  createCollection(c: { name: string; description: string; media: string }): Promise<unknown>;
  createSkill(s: NewSkill): Promise<unknown>;
  createPresale(p: NewPresale): Promise<unknown>;
  withdrawOwed(): Promise<unknown>;
}

const cache = new Map<string, { t: number; p: Promise<unknown> }>();
const cached = <T,>(key: string, f: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30_000) return hit.p as Promise<T>;
  const p = f().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { t: Date.now(), p });
  return p;
};

export function useAssets(): Api {
  const w = useNearWallet();
  if (DEMO) return demoApi;
  const me = w.signedAccountId || null;
  const view = <T,>(method: string, args: Record<string, unknown> = {}) =>
    w.viewFunction({ contractId: ASSETS_ID, method, args }) as Promise<T>;
  const call = (method: string, args: Record<string, unknown>, deposit: bigint | string = "1", gas = GAS) => {
    cache.clear();
    return w.callFunction({ contractId: ASSETS_ID, method, args, gas, deposit: String(deposit) });
  };
  const page = <T,>(method: string, args: Record<string, unknown> = {}) => cached(method, () => view<T[]>(method, { ...args, from: 0, limit: 200 }));
  const mine = () => (me ? view<Monster[]>("monsters_of", { account_id: me, from: 0, limit: 100 }) : Promise.resolve([]));
  return {
    demo: false, account: me, signIn: () => w.signIn(), signOut: () => w.signOut(),
    skills: () => page<Skill>("skill_types"),
    collections: () => page<Collection>("collections"),
    presales: () => page<Presale>("presales"),
    monsters: () => page<Monster>("listings"),
    monster: (id) => view<Monster | null>("get_monster", { token_id: id }),
    history: (key) => cached(`h:${key}`, () => view<Point[]>("price_history", { key })),
    skillListings: (skill) => view<SkillListing[]>("skill_listings", { skill, from: 0, limit: 100 }),
    presaleBought: (id) => (me ? view<string>("presale_bought", { id, account: me }) : Promise.resolve("0")),
    presaleAllowed: (id) => (me ? view<boolean>("presale_allowed", { id, account: me }) : Promise.resolve(false)),
    isCreator: () => (me ? view<boolean>("is_creator", { acct: me }) : Promise.resolve(false)),
    holdings: async () => {
      if (!me) return [];
      const [rows, mons] = await Promise.all([view<[number, string, string][]>("skills_of", { account: me }), mine()]);
      return rows.map(([skill, free, listed]) => ({ skill, free, listed, equipped: mons.flatMap((m) => m.skills).filter((s) => s.id === skill).length }));
    },
    myMonsters: mine,
    owed: () => (me ? view<string>("owed_of", { account_id: me }) : Promise.resolve("0")),
    buySkill: (l, qty) => call("buy_skill", { seller: l.seller, skill: l.skill, qty: String(qty) }, BigInt(l.price_each) * BigInt(qty) + STORAGE, GAS_X),
    listSkill: (skill, qty, priceEach) => call("list_skill", { skill, qty: String(qty), price_each: priceEach }, STORAGE),
    cancelSkillListing: (skill) => call("cancel_skill_listing", { skill }),
    buyPresale: (p, qty) => call("buy_presale", { id: p.id, qty: String(qty) }, BigInt(p.price) * BigInt(qty) + STORAGE, GAS_X),
    buyMonster: (m) => call("buy", { token_id: m.token_id }, m.price ?? "0", GAS_X),
    listMonster: (id, price) => call("list", { token_id: id, price }),
    delistMonster: (id) => call("delist", { token_id: id }),
    createCollection: (c) => call("create_collection", c, STORAGE),
    createSkill: (s) => call("create_skill", { ...s }, STORAGE),
    createPresale: (p) => call("create_presale", { ...p }, STORAGE),
    withdrawOwed: () => call("withdraw_owed", {}, "0", GAS_X),
  };
}

export const toYocto = (n: string | number) => nearToYocto(String(n) as `${number}`).toString();
export const near = (y: string | bigint | null | undefined) => (y == null ? 0 : Number(yoctoToNear(BigInt(y))));
export const fmt = (y: string | bigint | null | undefined) => {
  const n = near(y);
  return n === 0 ? "0" : n < 0.01 ? n.toPrecision(2) : n.toFixed(n < 10 ? 3 : 2).replace(/\.?0+$/, "");
};
export const change24 = (h: Point[]) => {
  if (h.length < 2) return 0;
  const last = near(h[h.length - 1][1]);
  const cut = Date.now() - 86_400_000;
  const prev = near([...h].reverse().find(([t]) => t <= cut)?.[1] ?? h[0][1]);
  return prev ? ((last - prev) / prev) * 100 : 0;
};
export const skillKey = (id: number) => `skill:${id}`;
export const KIND_LABEL: Record<Kind, string> = {
  Power: "Power", Agility: "Agility", Durability: "Durability", Speed: "Speed",
  AirJump: "Air Jump", Lifesteal: "Lifesteal", QuickDodge: "Quick Dodge", SecondWind: "Second Wind",
};
export const KIND_DESC: Record<Kind, string> = {
  Power: "+STR · more damage", Agility: "+DEX · faster startup", Durability: "+DEF · less knockback", Speed: "+SPD · faster run",
  AirJump: "3 air jumps instead of 2", Lifesteal: "Heal 1/5 of damage dealt", QuickDodge: "Dodge cooldown −1/3", SecondWind: "Heal 30 once per stock at ≤50 HP",
};
