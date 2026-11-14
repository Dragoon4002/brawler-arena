import { useEffect, useState } from 'react';
import { useMonsters, type NftMonster } from '@/lib/nft.ts';

export function useMons(ids: string[]) {
  const api = useMonsters();
  const key = [...new Set(ids)].sort().join(',');
  const [m, setM] = useState<Record<string, NftMonster>>({});
  useEffect(() => {
    let dead = false;
    Promise.all(key ? key.split(',').map((id) => api.get(id).catch(() => null)) : []).then((r) => {
      if (!dead) setM(Object.fromEntries(r.filter((x): x is NftMonster => !!x).map((x) => [x.id, x])));
    });
    return () => { dead = true; };
  }, [key]);
  return m;
}
