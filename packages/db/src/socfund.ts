import {
  SOCFUND_TARIFFS,
  socfundShort,
  socfundState,
  type ContractorKind,
  type SocfundChoice,
  type SocfundDict,
  type SocfundFlags,
  type SocfundPenalty,
  type SocfundTariffId,
} from '@buhuchet/domain';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from './client';
import { gkedIndexOf } from './gked';
import type { ListTexts } from './list';
import {
  assignments,
  contractorBases,
  contractorBenefits,
  contractors,
  gkedItems,
  ownershipForms,
  platformReference,
  taxBenefits,
} from './schema';

/*
 * Справочные данные тарифа Соцфонда (ТЗ «Тариф страховых взносов в Соцфонд (СПиНО)»; прототип
 * core/socfund.js, sfTax и sfSpBen): налог-взнос «Налогов и ставок» с тарифами (guide.tariffs — ставки,
 * предельная база, статусы; guide.exceptionsGked, guide.gnpf, guide.penalty, guide.reportTypes) и статус
 * СПиНО в «Налоговых льготах и особых статусах» (ЛЬГ-29: запрещающие коды ГКЭД, коды с предупреждением,
 * формы для напоминания о госфинансировании). Записи справочника, которые не разобрать, пропускаются:
 * тариф — подсказка, она не должна ронять карточку.
 */

const text = z.string().catch('');
const texts = z.array(z.string()).catch([]);

const Tariff = z.object({
  id: text,
  name: text,
  short: text,
  total: text,
  status: text,
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
  cap: z.object({ base: text, amount: text, since: text, note: text }).nullable().catch(null),
});

const Guide = z.object({
  tariffs: z.array(Tariff).catch([]),
  exceptionsGked: z.array(z.object({ text, gked: texts, gkedBlock: texts })).catch([]),
  reportTypes: texts,
  gnpf: z.object({ text, verifyNote: text }).nullable().catch(null),
  penalty: z.object({ start: text, rate: text, cap: text }).nullable().catch(null),
});

const Tax = z.object({
  active: z.boolean().catch(true),
  guide: Guide.catch(() => Guide.parse({})),
});

type TaxGuide = z.infer<typeof Guide>;

/** Тариф для экрана: ставки по сторонам и фондам, предельная база, «сверить». */
export type SocfundTariffInfo = z.infer<typeof Tariff> & { id: SocfundTariffId };

/** Действующие налоги справочника — их формы просмотра. */
async function taxGuides(tx: Tx): Promise<TaxGuide[]> {
  const [row] = await tx
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, 'taxes'));
  const items = Array.isArray(row?.payload) ? (row.payload as unknown[]) : [];
  return items.flatMap((item) => {
    const parsed = Tax.safeParse(item);
    return parsed.success && parsed.data.active ? [parsed.data.guide] : [];
  });
}

const codesOf = (s: string) => s.split(/[,;\s]+/).filter(Boolean);

/** Налог-взнос с тарифом СПиНО (ПЛТ-01). */
const socfundGuideOf = (guides: readonly TaxGuide[]) =>
  guides.find((g) => g.tariffs.some((t) => t.id === 'spino')) ?? null;

/** Тарифы контрагента по порядку: СПиНО, базовый, ПВТ / ПКИ — какие есть в справочнике. */
function tariffsOf(g: TaxGuide | null): SocfundTariffInfo[] {
  if (!g) return [];
  return SOCFUND_TARIFFS.flatMap((id) => {
    const t = g.tariffs.find((x) => x.id === id);
    return t ? [{ ...t, id }] : [];
  });
}

/** Данные тарифа для экрана: тарифы со ставками по фондам и пояснение о ГНПФ. */
export interface SocfundGuide {
  tariffs: SocfundTariffInfo[];
  gnpf: { text: string; verifyNote: string } | null;
}

/**
 * Справочные данные тарифа для контрагентов с основными ГКЭД `gkedCodes` (предки кодов — для правил
 * «секция буквой») и данные для экрана.
 */
export async function socfundDict(
  tx: Tx,
  gkedCodes: readonly string[],
): Promise<{ dict: SocfundDict; guide: SocfundGuide }> {
  const g = socfundGuideOf(await taxGuides(tx));
  const tariffs = tariffsOf(g);
  const statusCode = codesOf(tariffs.find((t) => t.id === 'spino')?.status ?? '')[0];
  const residentCodes = codesOf(tariffs.find((t) => t.id === 'pvtpki')?.status ?? '');
  const statusCodes = [statusCode, ...residentCodes].filter((c): c is string => !!c);
  const [statuses, index] = await Promise.all([
    statusCodes.length
      ? tx
          .select({
            code: taxBenefits.code,
            name: taxBenefits.name,
            gked: taxBenefits.gked,
            suggest: taxBenefits.suggest,
          })
          .from(taxBenefits)
          .where(inArray(taxBenefits.code, statusCodes))
      : Promise.resolve([]),
    gkedIndexOf(tx, gkedCodes),
  ]);
  const status = statuses.find((s) => s.code === statusCode) ?? null;
  const listed = [...(status?.gked?.ex ?? []), ...(status?.gked?.warn ?? [])];
  const names = listed.length
    ? await tx
        .select({ code: gkedItems.code, name: gkedItems.name })
        .from(gkedItems)
        .where(inArray(gkedItems.code, listed))
    : [];
  return {
    dict: {
      tariffs: tariffs.map((t) => ({
        id: t.id,
        name: t.name,
        short: t.short,
        total: t.total,
        statuses: codesOf(t.status),
        parts: t.parts.map((p) => ({ payer: p.payer, rate: p.rate })),
        cap: t.cap && { base: t.cap.base, amount: t.cap.amount, since: t.cap.since },
        verify: t.verify,
      })),
      status: status && {
        code: status.code,
        name: status.name,
        ex: status.gked?.ex ?? [],
        warn: status.gked?.warn ?? [],
        warnForms: status.suggest?.warnForms ?? [],
      },
      statusNames: new Map(
        statuses.filter((s) => residentCodes.includes(s.code)).map((s) => [s.code, s.name]),
      ),
      exceptions: (g?.exceptionsGked ?? []).map((e) => ({
        text: e.text,
        codes: [...e.gkedBlock, ...e.gked],
      })),
      gkedNames: new Map(names.map((n) => [n.code, n.name])),
      index,
      reportTypes: g?.reportTypes ?? [],
    },
    guide: { tariffs, gnpf: g?.gnpf ?? null },
  };
}

/** Код статуса СПиНО (ЛЬГ-29): он стоит у контрагента, пока у него тариф СПиНО. */
export function socfundStatusCode(dict: SocfundDict): string | null {
  return dict.status?.code ?? null;
}

/**
 * Пеня по виду отчёта (прототип sfPeniNote): налог справочника с пеней, у которого вид — в «Видах
 * отчётов»; null — у вида пени нет.
 */
export async function penaltyOf(tx: Tx, reportTypeCode: string): Promise<SocfundPenalty | null> {
  const g = (await taxGuides(tx)).find((x) => x.penalty && x.reportTypes.includes(reportTypeCode));
  return g?.penalty ?? null;
}

/** Виды отчётов действующих назначений контрагента (без даты окончания). */
export async function activeReportTypes(tx: Tx, contractorId: string): Promise<string[]> {
  const rows = await tx
    .select({ code: assignments.reportTypeCode })
    .from(assignments)
    .where(and(eq(assignments.contractorId, contractorId), isNull(assignments.endedOn)));
  return rows.map((r) => r.code);
}

/** Форма собственности кодом и названием (для предупреждения о госфинансировании); null — нет такой. */
export async function ownershipFormOf(
  tx: Tx,
  code: string,
): Promise<{ code: string; name: string } | null> {
  const [row] = await tx
    .select({ code: ownershipForms.code, name: ownershipForms.name })
    .from(ownershipForms)
    .where(eq(ownershipForms.code, code));
  return row ?? null;
}

/** Столбцы таблицы тарифа для списка контрагентов (`socfundListTable`). */
export const SOCFUND_LIST = {
  id: sql.raw('"sf"."id"'),
  tariff: sql.raw('"sf"."tariff"'),
  name: sql.raw('"sf"."name"'),
  total: sql.raw('"sf"."total"'),
  ask: sql.raw('"sf"."ask"'),
};

/**
 * Тариф Соцфонда контрагентов организации для списка (прототип cpCols: «Тариф Соцфонда» — sfName,
 * «Тариф под вопросом», плашка nSfq): правило — в `@buhuchet/domain`, поэтому тарифы считаются здесь и
 * подставляются в запрос таблицей `sf` (id, tariff — код выбранного или `none`, name, total, ask —
 * `yes`/`no`). Контрагента, которому тариф не нужен, в таблице нет.
 */
export async function socfundListTable(tx: Tx, t: ListTexts): Promise<SQL> {
  const rows = await tx
    .select({
      id: contractors.id,
      kind: contractors.kind,
      gked: contractors.gked,
      formCode: contractors.formCode,
      formName: ownershipForms.name,
      flags: contractors.socfundFlags,
      tariff: contractors.socfundTariff,
      bases: sql<
        string[]
      >`coalesce((select array_agg(${contractorBases.baseCode}) from ${contractorBases} where ${contractorBases.contractorId} = ${contractors.id}), '{}')`,
      benefits: sql<
        string[]
      >`coalesce((select array_agg(${contractorBenefits.benefitCode}) from ${contractorBenefits} where ${contractorBenefits.contractorId} = ${contractors.id}), '{}')`,
      types: sql<
        string[]
      >`coalesce((select array_agg(${assignments.reportTypeCode}) from ${assignments} where ${assignments.contractorId} = ${contractors.id} and ${assignments.endedOn} is null), '{}')`,
    })
    .from(contractors)
    .innerJoin(ownershipForms, eq(ownershipForms.code, contractors.formCode));
  const gked = [...new Set(rows.flatMap((r) => (r.gked ? [r.gked] : [])))];
  const { dict } = await socfundDict(tx, gked);
  const none = t('cp.socfund.list_none');
  const out = rows.flatMap((r) => {
    const st = socfundState(
      {
        kind: r.kind as ContractorKind,
        bases: r.bases,
        activeTypes: r.types,
        gked: r.gked,
        form: { code: r.formCode, name: r.formName },
        benefits: r.benefits,
        flags: r.flags as SocfundFlags,
      },
      r.tariff as SocfundChoice | null,
      dict,
    );
    if (!st) return [];
    const cur = st.choice && dict.tariffs.find((x) => x.id === st.choice!.id);
    return [
      {
        id: r.id,
        tariff: cur ? cur.id : 'none',
        name: cur ? socfundShort(cur) : none,
        total: cur?.total ?? '',
        ask: st.ask ? 'yes' : 'no',
      },
    ];
  });
  return sql`jsonb_to_recordset(${JSON.stringify(out)}::jsonb) as sf(id uuid, tariff text, name text, total text, ask text)`;
}
