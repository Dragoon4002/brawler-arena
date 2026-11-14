"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { change24, fmt, near, skillKey, useAssets, type Point } from "@/lib/assets";
import { Loading, MonsterArt, Panel, Pct, prices, SearchBar, SkillArt, SkillRow, Sparkline, useLoad } from "@/components/ui";

function Card({ label, href, chart, icon, name, value, delta }: { label: string; href: string; chart: number[]; icon: ReactNode; name: string; value: string; delta: ReactNode }) {
  return (
    <Link href={href} className="group block rounded-3xl border-3 border-ink bg-panel p-5 shadow-drop transition hover:-translate-y-1 hover:bg-panel-2">
      <p className="text-sm font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <Sparkline data={chart} className="my-4 h-16 sm:h-24" />
      <div className="flex items-center gap-3 border-t-2 border-ink/60 pt-4">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xl leading-tight">{name}</span>
          <span className="text-sm font-bold text-muted tabular-nums">{value}</span>
        </span>
        {delta}
      </div>
    </Link>
  );
}

export default function Home() {
  const a = useAssets();
  const [d] = useLoad(async () => {
    const [skills, presales, monsters, mh] = await Promise.all([a.skills(), a.presales(), a.monsters(), a.history("monsters")]);
    const hist: Record<number, Point[]> = Object.fromEntries(await Promise.all(skills.map(async (s) => [s.id, await a.history(skillKey(s.id))])));
    return { skills, presales, monsters, mh, hist };
  }, [a.account]);

  const now = Date.now();
  const top = d?.skills.filter((s) => d.hist[s.id].length > 1).sort((x, y) => change24(d.hist[y.id]) - change24(d.hist[x.id]))[0];
  const hot = d?.monsters.slice().sort((x, y) => y.record.w - x.record.w)[0];
  const live = d?.presales.filter((p) => !p.ended && p.start_ms <= now && (!p.end_ms || p.end_ms > now)).sort((x, y) => Number(!!y.cap_total) - Number(!!x.cap_total))[0];
  const liveSkill = live && d?.skills.find((s) => s.id === live.skill);
  const soldCurve = live && d ? d.hist[live.skill].filter(([t]) => t >= live.start_ms).map((_, i) => i + 1) : [];
  const movers = d?.skills.filter((s) => d.hist[s.id].length > 1 && s.rarity !== "Common").sort((x, y) => Math.abs(change24(d.hist[y.id])) - Math.abs(change24(d.hist[x.id]))).slice(0, 6);

  return (
    <>
      <section className="mx-auto max-w-3xl pb-10 pt-6 text-center sm:pt-14">
        <p className="mb-4 inline-block rounded-full border-3 border-ink bg-panel px-3 py-1 text-xs font-extrabold uppercase tracking-widest text-gold shadow-drop-sm">Skills · Monsters · Presales</p>
        <h1 className="text-[44px] drop-shadow-[0_5px_0_var(--color-ink)] sm:text-7xl md:text-8xl">Trade in the <span className="text-ember">Arena</span></h1>
        <p className="mx-auto mt-4 max-w-xl text-lg font-bold text-muted">Buy skills, gear up your monster, win more fights. Everything settles on NEAR.</p>
        <div className="mt-8"><SearchBar big /></div>
      </section>

      <div className="grid gap-5 md:grid-cols-3">
        {!d ? [0, 1, 2].map((i) => <Loading key={i} />) : <>
          {top ? <Card label="Top Skill (24H)" href={`/item?id=skill:${top.id}`} chart={prices(d.hist[top.id])}
            icon={<SkillArt kind={top.kind} rarity={top.rarity} mag={top.mag} size={44} />} name={top.name} value={`${fmt(top.last_price)} Ⓝ`} delta={<Pct v={change24(d.hist[top.id])} />} /> : <Loading />}
          {hot ? <Card label="Hottest Monster" href={`/item?id=monster:${hot.token_id}`} chart={prices(d.mh)}
            icon={<MonsterArt dna={hot.dna} size={44} />} name={hot.name} value={`${fmt(hot.price)} Ⓝ · ${hot.record.w}W`} delta={<Pct v={change24(d.mh)} />} /> : <Loading />}
          {live && liveSkill ? <Card label="Live Presale" href={`/collection?id=${liveSkill.collection}`} chart={soldCurve.length > 1 ? soldCurve : [0, Number(live.sold)]}
            icon={<SkillArt kind={liveSkill.kind} rarity={liveSkill.rarity} mag={liveSkill.mag} size={44} />} name={liveSkill.name}
            value={live.cap_total ? `${live.sold}/${live.cap_total} sold · ${fmt(live.price)} Ⓝ` : `${live.sold} sold · ${fmt(live.price)} Ⓝ`}
            delta={live.cap_total ? <span className="font-extrabold text-up">{Math.round((Number(live.sold) / Number(live.cap_total)) * 100)}%</span> : <span className="font-extrabold text-up">Open</span>} /> : <Loading />}
        </>}
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="p-3 sm:p-4">
          <div className="flex items-baseline justify-between px-3 pb-2 pt-1">
            <h2 className="text-2xl">Top movers</h2>
            <Link href="/search?type=skill&sort=change" className="text-sm font-extrabold text-gold hover:underline">See all →</Link>
          </div>
          {movers ? movers.map((s) => <SkillRow key={s.id} s={s} h={d!.hist[s.id]} />) : <Loading />}
        </Panel>
        <Panel className="p-3 sm:p-4">
          <div className="flex items-baseline justify-between px-3 pb-2 pt-1">
            <h2 className="text-2xl">Monsters for sale</h2>
            <Link href="/search?type=monster" className="text-sm font-extrabold text-gold hover:underline">See all →</Link>
          </div>
          {d ? d.monsters.slice(0, 6).map((m) => (
            <Link key={m.token_id} href={`/item?id=monster:${m.token_id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-panel-2">
              <MonsterArt dna={m.dna} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-lg leading-tight">{m.name} <span className="text-muted">#{m.token_id}</span></span>
                <span className="text-xs font-extrabold text-muted">Gen {m.gen} · {m.record.w}W {m.record.l}L</span>
              </span>
              <span className="font-extrabold tabular-nums">{near(m.price).toFixed(2)} Ⓝ</span>
            </Link>
          )) : <Loading />}
        </Panel>
      </div>
    </>
  );
}
