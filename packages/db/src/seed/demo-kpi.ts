import { INDICATOR_TOTALS, INDICATOR_TYPES } from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { indicatorMonths, indicators, indicatorTargets, indicatorValues } from '../schema';
import { demoId } from './demo';

/*
 * Показатели демо-организации (задача 2.27): показатели, «Кому вести», значения и статусы месяцев из
 * demoDB.json (`indicators`, `indicatorValues`, `indicatorMonths`). Значения прототипа — числа, в базе —
 * целые сотые. Повторный запуск досоздаёт только недостающее.
 */

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2025-02-14 11:00» — момент по Бишкеку, как `_ca` записей прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);
const Month = z.string().regex(/^\d{4}-\d{2}$/);

const DemoIndicator = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  type: z.enum(INDICATOR_TYPES),
  desc: z.string().default(''),
  main: z.enum(INDICATOR_TOTALS),
  scope: z.enum(['all', 'sel']),
  cps: z.array(z.number().int()).default([]),
  req: z.boolean(),
  dueDay: z.number().int(),
  start: Month,
  archived: z.boolean().default(false),
  order: z.number().int(),
  autoNew: z.boolean().default(true),
  /** Контрагенты, которые были при выборе «Выбранным»: остальные для показателя новые. */
  seen: z.array(z.number().int()).default([]),
  /** Выключен у контрагента с месяца — «Не ведётся с …». */
  off: z.record(z.string(), Month).default({}),
  /** Свой месяц «с …» у контрагента. */
  from: z.record(z.string(), Month).default({}),
  _cb: z.string(),
  _ca: Stamp,
});

const DemoValue = z.object({
  cp: z.number().int(),
  ind: z.string(),
  m: Month,
  v: z.number(),
  note: z.string().default(''),
  by: z.string(),
  at: Stamp,
});

const STATUS = { 'Не заполнено': 'empty', Заполнено: 'filled', Проверено: 'checked' } as const;

const DemoMonth = z.object({
  cp: z.number().int(),
  m: Month,
  status: z.enum(['Не заполнено', 'Заполнено', 'Проверено']),
  _ca: Stamp,
});

const DemoKpiFile = z.object({
  contractors: z.array(z.object({ id: z.number().int(), kind: z.string() })).default([]),
  employees: z.array(z.object({ id: z.string() })).default([]),
  indicators: z.array(DemoIndicator).default([]),
  indicatorValues: z.array(DemoValue).default([]),
  indicatorMonths: z.array(DemoMonth).default([]),
});

export async function seedDemoKpi(db: Db, file: unknown, orgId: string): Promise<void> {
  const demo = DemoKpiFile.parse(file);
  if (demo.indicators.length === 0) return;
  const staff = new Set(demo.employees.map((e) => e.id));
  const user = (protoId: string) => (staff.has(protoId) ? demoId('user', protoId) : null);
  const contractor = (id: number) => demoId('contractor', String(id));
  const indicator = (id: string) => demoId('indicator', id);
  const regular = demo.contractors.filter((c) => c.kind !== 'oneoff').map((c) => c.id);

  await db
    .insert(indicators)
    .values(
      demo.indicators.map((i) => ({
        id: indicator(i.id),
        orgId,
        name: i.name,
        unit: i.unit,
        type: i.type,
        total: i.main,
        description: i.desc,
        required: i.req,
        dueDay: i.dueDay,
        startMonth: i.start,
        scope: i.scope === 'all' ? ('all' as const) : ('selected' as const),
        autoNew: i.scope === 'all' || i.autoNew,
        archived: i.archived,
        sortOrder: i.order,
        createdBy: user(i._cb),
        updatedBy: user(i._cb),
        createdAt: stampOf(i._ca),
        updatedAt: stampOf(i._ca),
      })),
    )
    .onConflictDoNothing();

  // «Кому вести» (прототип kOn): строка — у выключенных, у тех, кому поставили свой месяц «с …», и при
  // «Выбранным» — у всех, кто был при выборе (отмечен — ведётся).
  const targets = demo.indicators.flatMap((i) =>
    regular.flatMap((cp) => {
      const key = String(cp);
      const off = i.off[key] ?? null;
      const from = i.from[key] ?? null;
      const seen = i.scope === 'sel' && i.seen.includes(cp);
      if (!off && !from && !seen) return [];
      const on = !off && (i.scope === 'all' || i.cps.includes(cp) || !seen);
      return [
        {
          orgId,
          indicatorId: indicator(i.id),
          contractorId: contractor(cp),
          enabled: on,
          fromMonth: from,
          offSince: off,
          updatedBy: user(i._cb),
          updatedAt: stampOf(i._ca),
        },
      ];
    }),
  );
  if (targets.length) await db.insert(indicatorTargets).values(targets).onConflictDoNothing();

  const values = demo.indicatorValues.map((v) => ({
    id: demoId('indicator_value', `${v.cp}|${v.ind}|${v.m}`),
    orgId,
    contractorId: contractor(v.cp),
    indicatorId: indicator(v.ind),
    month: v.m,
    value: Math.round(v.v * 100),
    note: v.note,
    createdBy: user(v.by),
    updatedBy: user(v.by),
    createdAt: stampOf(v.at),
    updatedAt: stampOf(v.at),
  }));
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(indicatorValues)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing();
  }

  const months = demo.indicatorMonths.map((m) => ({
    id: demoId('indicator_month', `${m.cp}|${m.m}`),
    orgId,
    contractorId: contractor(m.cp),
    month: m.m,
    status: STATUS[m.status],
    statusAt: stampOf(m._ca),
    createdAt: stampOf(m._ca),
    updatedAt: stampOf(m._ca),
  }));
  if (months.length) await db.insert(indicatorMonths).values(months).onConflictDoNothing();
}
