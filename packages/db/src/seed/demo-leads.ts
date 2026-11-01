import { LEAD_STATUSES, type LeadEventKind, type LeadStatus } from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { platformLeadEvents, platformLeads } from '../schema';
import type { DemoIdOf } from './demo';

/** «2026-10-31 09:30» — момент по Бишкеку, как `at` и `_ua` записей прототипа. */
const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Статус заявки в demoDB.json — словами, как в прототипе (`DB.ref.statuses.lead`). */
const STATUS: Readonly<Record<string, LeadStatus>> = {
  Новая: 'new',
  'В работе': 'in_progress',
  Подключена: 'connected',
  Отказ: 'rejected',
};

const DemoLeads = z.object({
  leads: z
    .array(
      z.object({
        id: z.string(),
        at: Stamp,
        name: z.string(),
        firm: z.string(),
        phone: z.object({ digits: z.string().regex(/^\d{4,15}$/) }),
        size: z.string(),
        tg: z.string().default(''),
        note: z.string().default(''),
        status: z.string(),
        prevSt: z.string().optional(),
        adminNote: z.string().default(''),
        hist: z.array(z.object({ at: Stamp, who: z.string(), what: z.string() })).default([]),
        _ua: Stamp,
      }),
    )
    .default([]),
});

/** «Статус: В работе → Отказ (причина)» — смена статуса в истории заявки прототипа (`leadSet`). */
const STATUS_LINE = /^Статус: (.+?) → ([^(,]+?)\s*(?:\((.*)\))?$/;

type EventRow = typeof platformLeadEvents.$inferInsert;

/** Запись истории заявки прототипа — запись истории продукта; непонятная — пропускается. */
function eventOf(leadId: string, h: { at: string; what: string }): EventRow | null {
  const at = stampOf(h.at);
  if (h.what.startsWith('Заявка с сайта')) return { leadId, at, kind: 'created', toStatus: 'new' };
  if (h.what === 'Заметка администратора изменена') return { leadId, at, kind: 'note' };
  const m = STATUS_LINE.exec(h.what);
  const from = m && STATUS[m[1]!];
  const to = m && STATUS[m[2]!.trim()];
  if (!from || !to) return null;
  const reason = m[3] ?? null;
  const rollback = reason?.startsWith('откат: ') ?? false;
  const kind: LeadEventKind = rollback ? 'rollback' : 'status';
  return {
    leadId,
    at,
    kind,
    fromStatus: from,
    toStatus: to,
    text: rollback ? reason!.slice('откат: '.length) : reason,
  };
}

/**
 * Заявки с сайта демо-данных (`leads` в demoDB.json, прототип v65): видны администратору платформы в
 * Админке → «Организации» → «Заявки» на стенде. Автора-администратора в наполнении нет, поэтому у
 * записей истории администратора автор пуст (на экране — «Администратор платформы»). В Telegram они
 * не уходят. Повторный запуск ничего не дублирует: у заявки постоянный id, история пишется только
 * вместе с новой заявкой.
 */
export async function seedDemoLeads(db: Db, file: unknown, demoId: DemoIdOf): Promise<void> {
  const leads = DemoLeads.parse(file).leads.flatMap((l) => {
    const status = STATUS[l.status];
    if (!status || !LEAD_STATUSES.includes(status)) return [];
    const before = l.prevSt ? (STATUS[l.prevSt] ?? null) : null;
    return [{ ...l, status, before, uuid: demoId('lead', l.id) }];
  });
  if (leads.length === 0) return;
  const inserted = await db
    .insert(platformLeads)
    .values(
      leads.map((l) => ({
        id: l.uuid,
        createdAt: stampOf(l.at),
        name: l.name,
        firm: l.firm,
        phone: `+${l.phone.digits}`,
        size: l.size,
        telegram: l.tg || null,
        note: l.note || null,
        status: l.status,
        statusBefore: l.status === 'rejected' ? l.before : null,
        adminNote: l.adminNote || null,
        updatedAt: stampOf(l._ua),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: platformLeads.id });
  const fresh = new Set(inserted.map((r) => r.id));
  const events = leads
    .filter((l) => fresh.has(l.uuid))
    .flatMap((l) => l.hist.map((h) => eventOf(l.uuid, h)).filter((e) => e !== null));
  if (events.length > 0) await db.insert(platformLeadEvents).values(events);
}
