import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './client';
import type { DictListOptions } from './platform-dicts';
import { gkedItems, platformReference } from './schema';

/*
 * Справочник платформы «Налоги и ставки» (раздел `taxes` refDB.json; пока в `platform_reference`, свою
 * таблицу ему даст правка справочников в Админке): налог или платёж с формой просмотра — «Что это»,
 * «Кто платит и с чего», «Ставки», «Сроки», «Связи», «Важно знать», «Статья НК», «Сверить» (ТЗ «Форма
 * просмотра налога»; прототип modules/dict-guide.js, taxGuideHtml). Отдаются только поля формы.
 */

const text = z.string().catch('');
const texts = z.array(z.string()).catch([]);

const Tariff = z.object({
  name: text,
  total: text,
  who: text,
  since: text,
  law: text,
  verify: z.boolean().catch(false),
  verifyNote: text,
  parts: z
    .array(
      z.object({
        payer: text,
        rate: text,
        funds: z.array(z.object({ fund: text, rate: text })).catch([]),
      }),
    )
    .catch([]),
  cap: z.object({ amount: text, since: text, note: text }).nullable().catch(null),
});

const Guide = z.object({
  about: text,
  payers: text,
  base: text,
  rates: z.array(z.object({ rate: text, when: text })).catch([]),
  tariffs: z.array(Tariff).catch([]),
  exceptions27: texts,
  admin: z.array(z.object({ organ: text, what: text })).catch([]),
  period: text,
  reportDue: text,
  payDue: text,
  pays: text,
  form: text,
  organ: text,
  art: text,
  reportTypes: texts,
  regimesPay: text,
  regimesFree: text,
  benefits: texts,
  bases: texts,
  gked: texts,
  gkedExclude: texts,
  exemptions: text,
  notes: texts,
  check: z
    .object({
      title: text,
      ways: z.array(z.object({ name: text, steps: texts })).catch([]),
    })
    .nullable()
    .catch(null),
  verifyNote: text,
  sources: z.array(z.object({ title: text, url: text })).catch([]),
});

const Tax = z.object({
  code: z.string(),
  name: z.string(),
  group: text,
  level: text,
  organ: text,
  period: text,
  payers: text,
  base: text,
  rates: text,
  reportDue: text,
  payDue: text,
  form: text,
  art: text,
  reportTypes: texts,
  verify: z.boolean().catch(false),
  active: z.boolean().catch(true),
  guide: Guide.catch(() => Guide.parse({})),
});

export type TaxRecord = z.infer<typeof Tax>;

/**
 * «Налоги и ставки» по порядку справочника; без `all` — только действующие. Запись, которую не
 * разобрать, пропускается: форма просмотра — подсказка, она не должна ронять экран.
 */
export async function listTaxes(db: Db | Tx, options: DictListOptions = {}): Promise<TaxRecord[]> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, 'taxes'));
  const items = Array.isArray(row?.payload) ? (row.payload as unknown[]) : [];
  return items.flatMap((item) => {
    const parsed = Tax.safeParse(item);
    return parsed.success && (options.all || parsed.data.active) ? [parsed.data] : [];
  });
}

/** Названия кодов ГКЭД из связей налогов (код → название); кода нет в ГКЭД — его нет и здесь. */
export async function taxGkedNames(
  db: Db | Tx,
  taxes: readonly TaxRecord[],
): Promise<Record<string, string>> {
  const codes = [...new Set(taxes.flatMap((x) => [...x.guide.gked, ...x.guide.gkedExclude]))];
  if (!codes.length) return {};
  const rows = await db
    .select({ code: gkedItems.code, name: gkedItems.name })
    .from(gkedItems)
    .where(inArray(gkedItems.code, codes));
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}
