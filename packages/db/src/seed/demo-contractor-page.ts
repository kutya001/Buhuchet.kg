import { PAGE_SECTIONS, type HistoryAction, type HistoryValue } from '@buhuchet/domain';
import { z } from 'zod';
import type { Db } from '../client';
import { auditLog, contractorPages } from '../schema';
import type { DemoIdOf } from './demo';

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2026-10-20 11:05» — момент по Бишкеку, как в записях прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Страница контрагента демо-организации (`contractors[].page` в demoDB.json, прототип c.page). */
const DemoPage = z.object({
  on: z.boolean(),
  code: z.string().regex(/^\d{6}$/),
  at: Stamp,
  by: z.string(),
  codeAt: Stamp,
  hide: z.array(z.enum(PAGE_SECTIONS)).default([]),
});

const DemoFile = z.object({
  contractors: z
    .array(z.object({ id: z.number().int(), page: DemoPage.optional() }).passthrough())
    .default([]),
  history: z
    .array(
      z
        .object({
          at: Stamp,
          who: z.string(),
          ent: z.string(),
          id: z.union([z.string(), z.number()]),
          what: z.string(),
        })
        .passthrough(),
    )
    .default([]),
});

/** Названия разделов прототипа (PG_SECS) → ключи разделов. */
const SECTION_OF: Readonly<Record<string, (typeof PAGE_SECTIONS)[number]>> = {
  'Как оплатить': 'pay',
  Отчёты: 'reports',
  'Деньги на налоги': 'money',
  'Оплата за обслуживание': 'fee',
  Показатели: 'kpi',
  Контакты: 'contacts',
};

interface PageHistoryRow {
  action: HistoryAction;
  changes: { field: string; from?: HistoryValue; to?: HistoryValue }[];
}

/** Запись истории прототипа о странице (`log('cp', …)`, pubSeen) → действие и изменения продукта. */
function historyOf(what: string): PageHistoryRow | null {
  if (what.startsWith('Страница контрагента включена')) return { action: 'page_on', changes: [] };
  if (what.startsWith('Страница контрагента выключена')) return { action: 'page_off', changes: [] };
  if (what === 'Код доступа страницы контрагента изменён') {
    return { action: 'page_code', changes: [] };
  }
  if (what === 'Скопирована ссылка на страницу контрагента') {
    return { action: 'page_copy', changes: [] };
  }
  if (what.startsWith('Ссылка на страницу контрагента с кодом отправлена')) {
    return { action: 'page_send', changes: [] };
  }
  const open = /^Страница контрагента открыта: (.+)$/.exec(what);
  if (open) return { action: 'page_open', changes: [{ field: 'device', to: open[1]! }] };
  const section = /^Страница контрагента: раздел «(.+)» (скрыт|показывается)$/.exec(what);
  if (section && SECTION_OF[section[1]!]) {
    const key = SECTION_OF[section[1]!]!;
    const hidden = section[2] === 'скрыт';
    return {
      action: 'update',
      changes: [{ field: 'hiddenSections', from: hidden ? [] : [key], to: hidden ? [key] : [] }],
    };
  }
  return null;
}

/**
 * Страницы контрагентов демо-организации (задача 2.42): включённые страницы с кодами из demoDB.json
 * (ОсОО «Бишкек Стройсервис» — 730 264 со скрытой «Оплатой за обслуживание», ОсОО «Укс» — 482 915) и
 * записи истории о них. История пишется вместе с новой страницей, поэтому повторный запуск её не
 * задваивает. Запомненных браузеров у демо-страниц нет: их выдаёт только ввод кода.
 */
export async function seedDemoContractorPages(
  db: Db,
  file: unknown,
  ids: { orgId: string; demoId: DemoIdOf; employees: readonly string[] },
): Promise<number> {
  const { contractors, history } = DemoFile.parse(file);
  const { orgId, demoId } = ids;
  const user = (protoId: string) =>
    ids.employees.includes(protoId) ? demoId('user', protoId) : null;
  const pages = contractors.flatMap((c) => (c.page ? [{ id: c.id, page: c.page }] : []));
  if (pages.length === 0) return 0;
  const inserted = await db
    .insert(contractorPages)
    .values(
      pages.map(({ id, page }) => ({
        contractorId: demoId('contractor', String(id)),
        orgId,
        enabled: page.on,
        code: page.code,
        hiddenSections: page.hide,
        createdBy: user(page.by),
        updatedBy: user(page.by),
        createdAt: stampOf(page.at),
        updatedAt: stampOf(page.codeAt),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: contractorPages.contractorId });
  const created = new Set(inserted.map((r) => r.id));

  const rows = history.flatMap((h) => {
    if (h.ent !== 'cp') return [];
    const contractorId = demoId('contractor', String(h.id));
    const row = created.has(contractorId) ? historyOf(h.what) : null;
    if (!row) return [];
    return [
      {
        orgId,
        entity: 'contractor_page',
        entityId: contractorId,
        action: row.action,
        changes: row.changes,
        contractorId,
        actorUserId: user(h.who),
        at: stampOf(h.at),
      },
    ];
  });
  if (rows.length) await db.insert(auditLog).values(rows);
  return inserted.length;
}
