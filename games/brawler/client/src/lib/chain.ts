'use client';
import { useSyncExternalStore } from 'react';

const KEY = 'brawler.chainDetails';
const subs = new Set<() => void>();
const read = () => typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const unit = () => (read() ? 'NEAR' : 'coins');

export const setChainDetails = (on: boolean) => {
  localStorage.setItem(KEY, on ? '1' : '0');
  subs.forEach((f) => f());
};

export const nick = (a: string | null | undefined, me?: string | null) =>
  !a ? '—' : a === me ? 'You' : /^[0-9a-f]{64}$/.test(a) ? `Player ${a.slice(0, 4)}` : a.replace(/\.(testnet|near)$/, '').split('.')[0];

export function useChainDetails() {
  const on = useSyncExternalStore(sub, read, () => false);
  return { on, u: on ? 'NEAR' : 'coins', who: (a: string | null | undefined, me?: string | null) => (on ? a ?? '—' : nick(a, me)) };
}
