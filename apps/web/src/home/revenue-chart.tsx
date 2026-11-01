'use client';

import {
  chartAxisLabel,
  chartStep,
  formatSomWithUnit,
  REVENUE_KINDS,
  type RevenueKind,
  type UiTextKey,
} from '@buhuchet/domain';
import type { RevenueOverview } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';

/*
 * График «Выручка по месяцам» и «Топ-10 контрагентов по выручке» (прототип modules/analytics.js,
 * `monthChart`, `shareChart`): столбики по видам выручки друг на друге, бледный столбик прошлого года
 * рядом, подписи оси в сомах («1,2 млн», «12 тыс.»), подсказки при наведении.
 */

/** Цвета видов выручки (прототип `REV`): обслуживание — синий, проекты — фиолетовый, услуги — оранжевый. */
export const KIND_COLOR: Record<RevenueKind, string> = {
  fee: 'var(--bu-blue)',
  proj: 'var(--bu-purple)',
  svc: 'var(--bu-orange)',
};

const kindName = (t: Translate, k: RevenueKind) => t(`home.an.kind.${k}`);

/** Название месяца: «Октябрь»; строчными — «октябрь»; коротко — «окт» (прототип `MONTHS`). */
const monthName = (t: Translate, i: number) => t(`report.month.${i + 1}` as UiTextKey);

/** Подпись оси (прототип `kSom`). */
function axisText(t: Translate, som: number): string {
  const { n, unit } = chartAxisLabel(som);
  return unit ? t(unit === 'mln' ? 'home.an.mln' : 'home.an.k', { n }) : n;
}

/** Цветной квадратик легенды. */
export function LegendDot({ color, faded = false }: { color: string; faded?: boolean }) {
  return (
    <i
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-[3px]"
      style={{ background: color, opacity: faded ? 0.55 : 1 }}
    />
  );
}

/** Легенда графика: виды выручки и прошлый год при сравнении. */
export function ChartLegend({ t, prevYear }: { t: Translate; prevYear: number | null }) {
  return (
    <span className="flex flex-wrap items-center gap-3 text-[12.5px] font-medium tracking-normal text-muted normal-case">
      {REVENUE_KINDS.map((k) => (
        <span key={k} className="inline-flex items-center gap-[5px]">
          <LegendDot color={KIND_COLOR[k]} />
          {kindName(t, k)}
        </span>
      ))}
      {prevYear !== null ? (
        <span className="inline-flex items-center gap-[5px]">
          <LegendDot color="var(--bu-border-strong)" faded />
          {t('home.an.year', { y: prevYear })}
        </span>
      ) : null}
    </span>
  );
}

const W = 760;
const H = 250;
const L = 56;
const B = 28;
const T = 10;

/** Столбики выручки по месяцам (прототип `monthChart`); суммы — в тыйынах, ось — в сомах. */
export function MonthChart({
  t,
  v,
  compare,
}: {
  t: Translate;
  v: Pick<RevenueOverview, 'months' | 'prevMonths' | 'lastMonth'>;
  compare: boolean;
}) {
  const som = (tyiyn: number) => tyiyn / 100;
  const cw = (W - L - 8) / 12;
  const sums = v.months.map((m) => som(m[0] + m[1] + m[2]));
  const prev = v.prevMonths.map(som);
  const max = Math.max(1, ...sums, ...(compare ? prev : [0]));
  const step = chartStep(max);
  const top = Math.ceil(max / step) * step;
  const yv = (x: number) => H - B - (x / top) * (H - B - T);
  const ticks: number[] = [];
  for (let x = 0; x <= top + 0.1; x += step) ticks.push(x);
  const money = (tyiyn: number) => formatSomWithUnit(tyiyn);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={t('home.an.months')}
      data-home-chart=""
      style={{ display: 'block', maxHeight: 280 }}
    >
      {ticks.map((x) => (
        <g key={x}>
          <line x1={L} x2={W - 8} y1={yv(x)} y2={yv(x)} stroke="var(--bu-border)" strokeWidth={1} />
          <text x={L - 8} y={yv(x) + 4} textAnchor="end" fontSize={11} fill="var(--bu-muted)">
            {axisText(t, x)}
          </text>
        </g>
      ))}
      <line x1={L} x2={W - 8} y1={yv(0)} y2={yv(0)} stroke="var(--bu-border-strong)" />
      {v.months.map((m, i) => {
        const x0 = L + i * cw;
        const bw = Math.min(30, cw * 0.46);
        const bx = x0 + (cw - bw) / 2 + (compare ? bw * 0.28 : 0);
        const name = monthName(t, i);
        const total = m[0] + m[1] + m[2];
        let acc = 0;
        const bars = REVENUE_KINDS.map((k, n) => {
          const value = m[n]!;
          if (value <= 0) return null;
          const y1 = yv(som(acc + value));
          const y0 = yv(som(acc));
          const h = Math.max(1, y0 - y1 - (acc > 0 ? 2 : 0));
          const isTop = acc + value === total;
          acc += value;
          return (
            <rect
              key={k}
              x={bx}
              y={y1}
              width={bw}
              height={h}
              rx={isTop ? 4 : 0}
              fill={KIND_COLOR[k]}
            >
              <title>
                {t('home.an.bar', {
                  month: name.toLowerCase(),
                  kind: kindName(t, k).toLowerCase(),
                  amount: money(value),
                })}
              </title>
            </rect>
          );
        });
        const p = v.prevMonths[i]!;
        return (
          <g key={i}>
            {compare && p > 0 ? (
              <rect
                x={bx - bw * 0.62}
                y={yv(som(p))}
                width={bw * 0.5}
                height={yv(0) - yv(som(p))}
                rx={3}
                fill="var(--bu-border-strong)"
                opacity={0.55}
              >
                <title>
                  {t('home.an.bar_prev', { month: name.toLowerCase(), amount: money(p) })}
                </title>
              </rect>
            ) : null}
            {bars}
            {total > 0 ? (
              <rect x={x0} y={T} width={cw} height={H - B - T} fill="transparent">
                <title>
                  {[
                    compare
                      ? t('home.an.bar_total_cmp', {
                          month: name,
                          amount: money(total),
                          prev: money(p),
                        })
                      : t('home.an.bar_total', { month: name, amount: money(total) }),
                    ...REVENUE_KINDS.map((k, n) => `${kindName(t, k)}: ${money(m[n]!)}`),
                  ].join('\n')}
                </title>
              </rect>
            ) : null}
            <text
              x={x0 + cw / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              fill={i > v.lastMonth ? 'var(--bu-faint)' : 'var(--bu-muted)'}
            >
              {name.toLowerCase().slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Пустой график организации без начислений (прототип: «Данные появятся после первых начислений»). */
export function EmptyChart({ t }: { t: Translate }) {
  return (
    <>
      <svg
        viewBox="0 0 600 180"
        width="100%"
        height={180}
        role="img"
        aria-label={t('home.an.empty_chart')}
        style={{ display: 'block' }}
      >
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={40}
            x2={590}
            y1={20 + i * 45}
            y2={20 + i * 45}
            stroke="var(--bu-border)"
          />
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <text
            key={i}
            x={62 + i * 45}
            y={176}
            textAnchor="middle"
            fontSize={11}
            fill="var(--bu-faint)"
          >
            {monthName(t, i).toLowerCase().slice(0, 3)}
          </text>
        ))}
      </svg>
      <div className="flex flex-col items-center gap-2 px-0 pt-1.5 pb-1 text-center text-muted">
        <span>{t('home.an.empty')}</span>
      </div>
    </>
  );
}

/** «Топ-10 контрагентов по выручке» (прототип `shareChart`): полоса из видов выручки, нажатие — операции. */
export function TopChart({
  t,
  top,
  onOpen,
}: {
  t: Translate;
  top: RevenueOverview['top'];
  onOpen: (id: string) => void;
}) {
  if (!top.length) return <span className="text-faint">{t('home.an.top_empty')}</span>;
  const max = top[0]!.total;
  return (
    <div data-home-top="" className="flex flex-col gap-[7px]">
      {top.map((r) => {
        const shown = REVENUE_KINDS.filter((k) => r[k] > 0);
        return (
          <button
            key={r.id}
            type="button"
            data-home-top-row={r.id}
            title={`${r.name}: ${formatSomWithUnit(r.total)}`}
            onClick={() => onOpen(r.id)}
            className="grid cursor-pointer grid-cols-[minmax(90px,170px)_1fr_auto] items-center gap-2 border-0 bg-transparent p-0 text-left text-[12.5px] text-ink"
          >
            <span className="truncate">{r.name}</span>
            <span className="flex h-3 gap-0.5">
              {shown.map((k, n) => (
                <i
                  key={k}
                  title={`${kindName(t, k)}: ${formatSomWithUnit(r[k])}`}
                  className="block h-3"
                  style={{
                    width: `${(r[k] / max) * 100}%`,
                    background: KIND_COLOR[k],
                    borderRadius: n === shown.length - 1 ? '0 4px 4px 0' : 0,
                  }}
                />
              ))}
            </span>
            <span className="text-muted tabular-nums">{axisText(t, r.total / 100)}</span>
          </button>
        );
      })}
    </div>
  );
}
