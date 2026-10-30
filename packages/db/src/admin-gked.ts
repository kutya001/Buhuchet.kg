import {
  GKED_GROUP_TARGETS,
  GKED_RULE_LISTS,
  gkedGroupApply,
  gkedGroupSignature,
  gkedRuleCodes,
  gkedRuleKeep,
  toHistoryValue,
  sameHistoryValue,
  type GkedGroupActs,
  type GkedGroupTarget,
  type GkedGroupValue,
  type GkedLevel,
  type GkedRule,
  type AdminValueDict,
  type HistoryChange,
} from '@buhuchet/domain';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import {
  adminDictRecords,
  adminDictSetActive,
  adminDictUpdate,
  getAdminDictValue,
  type AdminDictSaveResult,
  type AdminDictValueRecord,
  type GkedRuleLists,
} from './admin-platform-dicts';
import type { Tx } from './client';
import { writePlatformHistory } from './platform-history';
import { mergeRedueScopes, type RedueScope } from './reports-redue';
import { reportTypes, gkedItems, platformReference, singleTaxRates, taxRegimes } from './schema';
import { checksumOf } from './seed/checksum';
import { socfundDict, socfundStatusCode } from './socfund';

/*
 * Админка → «Справочники платформы» → «ГКЭД» (задача 2.38; ТЗ «ГКЭД»; прототип admin/gked-admin.js):
 * коды для дерева и поиска, «Группы кодов» (раздел `gkedGroups`) с правкой перечней единого налога и
 * СПиНО, «Виды деятельности (ГКЭД)» ставок единого налога. Сами коды правит общий механизм
 * справочников (`adminDictCreate`, `adminDictUpdate` — справочник `gked`). Пишет администратор
 * платформы функциями базы (миграции 0043 и 0068); история — `platform_audit_log`.
 */

/** Код ГКЭД для дерева и поиска: «Используется» — у контрагентов и в перечнях справочников. */
export interface AdminGkedItem {
  code: string;
  name: string;
  level: GkedLevel;
  parentCode: string | null;
  note: string;
  active: boolean;
  used: number;
  contractors: number;
  children: number;
  version: number;
}

/** Все коды в порядке классификатора (новые — в конце). */
export async function adminGkedItems(tx: Tx): Promise<AdminGkedItem[]> {
  return (await adminDictRecords(tx, 'gked')).map((x) => ({
    code: x.code,
    name: x.name,
    level: x.data.level as GkedLevel,
    parentCode: (x.data.parentCode as string | null) ?? null,
    note: (x.data.note as string) ?? '',
    active: x.active,
    used: x.usage.total,
    contractors: x.usage.contractors,
    children: x.children ?? 0,
    version: x.version,
  }));
}

/** Все коды ГКЭД — для перечней «Виды деятельности (ГКЭД)» в загрузке из Excel. */
export async function gkedCodeSet(tx: Tx): Promise<Set<string>> {
  const rows = await tx.select({ code: gkedItems.code }).from(gkedItems);
  return new Set(rows.map((r) => r.code));
}

/* ───────────── Разделы справочника ───────────── */

/** Раздел `platform_reference` с версией; нет раздела — null. */
export async function readReference(
  tx: Tx,
  key: string,
): Promise<{ payload: unknown; version: number } | null> {
  const [row] = await tx
    .select({ payload: platformReference.payload, version: platformReference.version })
    .from(platformReference)
    .where(eq(platformReference.key, key));
  return row ?? null;
}

/**
 * Записать раздел той версии, что видел администратор (`app.admin_set_reference`): новая версия; null
 * — версия устарела, раздела нет или в контексте не администратор.
 */
export async function saveReference(
  tx: Tx,
  key: 'taxes' | 'propertyRates' | 'gkedGroups',
  payload: unknown,
  version: number,
): Promise<number | null> {
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_reference(${key}, ${JSON.stringify(payload)}::jsonb, ${checksumOf(payload)}, ${version}) as version`,
  );
  return row?.version ?? null;
}

/** Все перечни правила явно: перечень, которого нет, — пустой (убирается при записи). */
const allLists = (r: GkedRule): GkedRuleLists =>
  Object.fromEntries(GKED_RULE_LISTS.map((k) => [k, [...(r[k] ?? [])]]));

/* ───────────── Группы кодов ───────────── */

/** Группа в разделе: ключ — `id`, остальное — поля (вопрос пустой — без поля, как в прототипе). */
interface StoredGroup {
  name: string;
  codes: string[];
  en: GkedGroupActs;
  spino: GkedGroupActs;
  ask?: string;
  why?: string;
}

const groupsOf = (payload: unknown): Record<string, StoredGroup> =>
  payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, StoredGroup>)
    : {};

const groupValue = (id: string, g: StoredGroup): GkedGroupValue => ({
  id,
  name: g.name ?? '',
  codes: g.codes ?? [],
  en: g.en ?? null,
  spino: g.spino ?? null,
  ask: g.ask ?? '',
  why: g.why ?? '',
});

/** Перечень, который меняет группа: режим, вид отчёта, налог или статус. */
export interface GkedGroupTargetRef {
  kind: 'regime' | 'type' | 'tax' | 'status';
  code: string;
  name: string;
}

export interface AdminGkedGroups {
  items: GkedGroupValue[];
  /** Версия раздела: правка группы с устаревшей — «запись изменена другим пользователем». */
  version: number;
  /** Что меняет правка группы: в едином налоге и в тарифе СПиНО. */
  targets: Record<GkedGroupTarget, GkedGroupTargetRef[]>;
}

/** Налог раздела `taxes` как он хранится (поля прототипа). */
type StoredTax = Record<string, unknown> & { code: string; name?: string; gked?: GkedRule | null };

const taxesOf = (payload: unknown): StoredTax[] =>
  Array.isArray(payload) ? (payload as StoredTax[]) : [];

/**
 * Перечни, которые меняет группа (прототип gkGrpTargets): в едином налоге — режим с запретом по
 * основному ГКЭД (`strict: 'main'`) и записи с тем же перечнем «Кроме» и «Предупреждать при ГКЭД»
 * (виды отчётов, налог); в СПиНО — статус тарифа СПиНО (ЛЬГ-29).
 */
async function groupTargets(tx: Tx): Promise<Record<GkedGroupTarget, GkedGroupTargetRef[]>> {
  const [regimes, types, taxes, socfund] = await Promise.all([
    tx
      .select({ code: taxRegimes.code, name: taxRegimes.name, gked: taxRegimes.gked })
      .from(taxRegimes)
      .where(sql`${taxRegimes.gked}->>'strict' = 'main'`)
      .orderBy(asc(taxRegimes.sortOrder), asc(taxRegimes.code)),
    tx
      .select({ code: reportTypes.code, name: reportTypes.shortName, gked: reportTypes.gked })
      .from(reportTypes)
      .where(sql`${reportTypes.gked} is not null`)
      .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code)),
    readReference(tx, 'taxes'),
    socfundDict(tx, []),
  ]);
  const regime = regimes[0];
  const en: GkedGroupTargetRef[] = [];
  if (regime) {
    const sig = gkedGroupSignature(regime.gked);
    en.push({ kind: 'regime', code: regime.code, name: regime.name });
    for (const t of types) {
      if (gkedGroupSignature(t.gked) === sig) en.push({ kind: 'type', ...t });
    }
    for (const x of taxesOf(taxes?.payload)) {
      if (x.gked && gkedGroupSignature(x.gked) === sig) {
        en.push({ kind: 'tax', code: x.code, name: x.name ?? x.code });
      }
    }
  }
  const status = socfund.dict.status;
  const spino: GkedGroupTargetRef[] =
    status && socfundStatusCode(socfund.dict)
      ? [{ kind: 'status', code: status.code, name: status.name }]
      : [];
  return { en, spino };
}

/** «Группы кодов» над деревом ГКЭД (прототип renderGked `adm-gkgrp`). */
export async function adminGkedGroups(tx: Tx): Promise<AdminGkedGroups> {
  const [ref, targets] = await Promise.all([readReference(tx, 'gkedGroups'), groupTargets(tx)]);
  const items = Object.entries(groupsOf(ref?.payload)).map(([id, g]) => groupValue(id, g));
  return { items, version: ref?.version ?? 0, targets };
}

export type GkedGroupSaveResult =
  | { ok: true; group: GkedGroupValue; version: number }
  | { ok: false; reason: 'not_found' | 'changed' }
  /** Кодов нет в справочнике ГКЭД. */
  | { ok: false; reason: 'codes'; unknown: string[] }
  /** Перечень не сохранился (запись изменили между чтением и записью). */
  | { ok: false; reason: 'target'; target: GkedGroupTargetRef; result: AdminDictSaveResult };

/** Поля группы для истории. */
const groupHistory = (g: GkedGroupValue | null): Record<string, unknown> => ({
  name: g?.name ?? null,
  codes: g?.codes ?? null,
  en: g?.en ?? null,
  spino: g?.spino ?? null,
  ask: g?.ask || null,
  why: g?.why || null,
});

/**
 * Правка группы (прототип gkGrpDlg «Сохранить», gkGrpApply): коды — из справочника; раздел той
 * версии, что видел администратор; у перечней, которые меняет группа, коды прежней группы убираются из
 * «Кроме» и «Предупреждать при ГКЭД», коды новой добавляются по действию. Перечни режима, видов
 * отчётов и статуса пишет общий механизм (со своей историей), налогов — раздел `taxes`. Новая группа
 * (загрузка из Excel) — `create`; группа без кодов в перечнях — `remove` (откат загрузки).
 */
export async function adminGkedGroupSave(
  tx: Tx,
  id: string,
  next: Omit<GkedGroupValue, 'id'> | null,
  version: number,
  create = false,
): Promise<GkedGroupSaveResult> {
  const ref = await readReference(tx, 'gkedGroups');
  if (!ref) return { ok: false, reason: 'not_found' };
  if (ref.version !== version) return { ok: false, reason: 'changed' };
  const groups = groupsOf(ref.payload);
  const stored = Object.hasOwn(groups, id) ? groups[id] : undefined;
  if (create ? stored : !stored) return { ok: false, reason: create ? 'changed' : 'not_found' };
  const old = stored ? groupValue(id, stored) : null;
  const value = next && { id, ...next, codes: [...new Set(next.codes)] };
  if (value) {
    const fresh = value.codes.filter((c) => !(old?.codes ?? []).includes(c));
    const known = fresh.length
      ? await tx
          .select({ code: gkedItems.code })
          .from(gkedItems)
          .where(inArray(gkedItems.code, fresh))
      : [];
    const unknown = fresh.filter((c) => !known.some((k) => k.code === c));
    if (unknown.length) return { ok: false, reason: 'codes', unknown };
  }
  const targets = await groupTargets(tx);
  let taxes: { payload: StoredTax[]; version: number } | null = null;
  const taxChanges: { code: string; from: GkedRule | null; to: GkedRule }[] = [];
  for (const k of GKED_GROUP_TARGETS) {
    for (const target of targets[k]) {
      if (target.kind === 'tax') {
        if (!taxes) {
          const t = await readReference(tx, 'taxes');
          taxes = { payload: taxesOf(t?.payload).map((x) => ({ ...x })), version: t?.version ?? 0 };
        }
        const tax = taxes.payload.find((x) => x.code === target.code);
        if (!tax) continue;
        const from = tax.gked ?? null;
        tax.gked = gkedGroupApply(from, old, value, k);
        taxChanges.push({ code: tax.code, from, to: tax.gked });
        continue;
      }
      const dict =
        target.kind === 'regime' ? 'regimes' : target.kind === 'type' ? 'types' : 'benefits';
      const record = await getAdminDictValue(tx, dict, target.code);
      if (!record) continue;
      const rule = gkedGroupApply((record.data.gked as GkedRule | null) ?? null, old, value, k);
      const saved = await adminDictUpdate(
        tx,
        dict,
        target.code,
        { name: record.name, data: { ...record.data, gked: allLists(rule) } },
        record.version,
      );
      if (!saved.ok) return { ok: false, reason: 'target', target, result: saved };
    }
  }
  if (taxes && taxChanges.length) {
    const saved = await saveReference(tx, 'taxes', taxes.payload, taxes.version);
    if (saved === null) return { ok: false, reason: 'changed' };
    await writePlatformHistory(
      tx,
      ...taxChanges
        .filter((c) => !sameHistoryValue(toHistoryValue(c.from), toHistoryValue(c.to)))
        .map((c) => ({
          entity: 'platform_dict' as const,
          entityId: `taxes:${c.code}`,
          action: 'update' as const,
          changes: [{ field: 'gked', from: toHistoryValue(c.from), to: toHistoryValue(c.to) }],
        })),
    );
  }
  const payload: Record<string, StoredGroup> = { ...groups };
  if (value) {
    const { id: _id, ask, why, ...rest } = value;
    payload[id] = { ...stored, ...rest, codes: [...rest.codes], ...(ask ? { ask } : {}), why };
    if (!ask) delete payload[id]!.ask;
  } else delete payload[id];
  const saved = await saveReference(tx, 'gkedGroups', payload, ref.version);
  if (saved === null) return { ok: false, reason: 'changed' };
  const was = groupHistory(old);
  const now = groupHistory(value);
  const changes: HistoryChange[] = Object.keys(now)
    .filter((f) => !sameHistoryValue(toHistoryValue(was[f]), toHistoryValue(now[f])))
    .map((f) => ({ field: f, from: toHistoryValue(was[f]), to: toHistoryValue(now[f]) }));
  if (changes.length) {
    await writePlatformHistory(tx, {
      entity: 'platform_dict',
      entityId: `gkgroups:${id}`,
      action: old ? (value ? 'update' : 'delete') : 'create',
      changes,
    });
  }
  return {
    ok: true,
    group: value ?? groupValue(id, stored!),
    version: saved,
  };
}

/* ───────────── Ставки единого налога ───────────── */

/** Ставка единого налога для окна «Виды деятельности (ГКЭД)» и загрузки. */
export interface AdminEnRateRecord {
  code: string;
  activity: string;
  rate: string;
  rateCashless: string;
  rateCash: string;
  conditions: string;
  article: string;
  explanation: string;
  gked: GkedRule | null;
  addsTo: string[];
  active: boolean;
  version: number;
}

/** Ставки единого налога в порядке справочника. */
export async function adminEnRates(tx: Tx, code?: string): Promise<AdminEnRateRecord[]> {
  const s = singleTaxRates;
  return tx
    .select({
      code: s.code,
      activity: s.activity,
      rate: s.rate,
      rateCashless: s.rateCashless,
      rateCash: s.rateCash,
      conditions: s.conditions,
      article: s.article,
      explanation: s.explanation,
      gked: s.gked,
      addsTo: s.addsTo,
      active: s.active,
      version: s.version,
    })
    .from(s)
    .where(code === undefined ? undefined : eq(s.code, code))
    .orderBy(asc(s.sortOrder), asc(s.code));
}

/** Поля ставки для `app.admin_dict_insert` / `admin_dict_update` (столбцы `platform_dict_specs`). */
export const enRateRow = (x: Omit<AdminEnRateRecord, 'code' | 'active' | 'version'>) => ({
  activity: x.activity.trim(),
  rate: x.rate.trim(),
  rate_cashless: x.rateCashless.trim(),
  rate_cash: x.rateCash.trim(),
  conditions: x.conditions.trim(),
  article: x.article.trim(),
  explanation: x.explanation.trim(),
  gked: x.gked,
  adds_to: x.addsTo,
});

export type EnRateSaveResult =
  | { ok: true; record: AdminEnRateRecord }
  | { ok: false; reason: 'not_found' | 'changed' }
  | { ok: false; reason: 'codes'; unknown: string[] };

/** Коды правила, которых нет в справочнике ГКЭД (уже указанные в `old` не проверяются). */
export async function unknownGkedCodes(
  tx: Tx,
  rule: GkedRule | null,
  old: GkedRule | null,
): Promise<string[]> {
  const was = new Set(gkedRuleCodes(old));
  const fresh = [...new Set(gkedRuleCodes(rule).filter((c) => !was.has(c)))];
  if (!fresh.length) return [];
  const known = await tx
    .select({ code: gkedItems.code })
    .from(gkedItems)
    .where(inArray(gkedItems.code, fresh));
  return fresh.filter((c) => !known.some((k) => k.code === c));
}

/**
 * «Виды деятельности (ГКЭД)» ставки единого налога (прототип enRateDlg): ставка подбирается по
 * основному ГКЭД контрагента (`main`); пустой перечень — без правила. В историю — «было → стало».
 */
export async function adminEnRateGked(
  tx: Tx,
  code: string,
  lists: GkedRuleLists,
  version: number,
): Promise<EnRateSaveResult> {
  const [before] = await adminEnRates(tx, code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  const kept = gkedRuleKeep(before.gked, lists);
  const rule = kept && (kept.in.length || kept.ex.length) ? { ...kept, main: true } : null;
  const unknown = await unknownGkedCodes(tx, rule, before.gked);
  if (unknown.length) return { ok: false, reason: 'codes', unknown };
  if (sameHistoryValue(toHistoryValue(before.gked), toHistoryValue(rule))) {
    return { ok: true, record: before };
  }
  const saved = await updateEnRate(tx, { ...before, gked: rule }, version);
  if (!saved) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `enrates:${code}`,
    action: 'update',
    changes: [{ field: 'gked', from: toHistoryValue(before.gked), to: toHistoryValue(rule) }],
  });
  const [after] = await adminEnRates(tx, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

/** Запись ставки функцией базы: новая версия; null — версия устарела. */
export async function updateEnRate(
  tx: Tx,
  x: Omit<AdminEnRateRecord, 'active' | 'version'>,
  version: number,
): Promise<number | null> {
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_update('enrates', ${x.code}, ${JSON.stringify(enRateRow(x))}::jsonb, ${version}) as version`,
  );
  return row?.version ?? null;
}

/* ───────────── Виды отчётов: сверка с ГНС ───────────── */

/**
 * «Отметить сверку с ГНС» (прототип markGns): у видов — сегодняшняя дата по Бишкеку и кто сверял. В
 * историю — одной строкой «Виды отчётов: сверено с ГНС — НДС, …» (краткими названиями). Число
 * отмеченных видов.
 */
export async function adminMarkGns(tx: Tx, codes: readonly string[]): Promise<number> {
  const list = [...new Set(codes)];
  if (!list.length) return 0;
  const [row] = await tx.execute<{ n: number | null }>(
    sql`select app.admin_mark_gns(array[${sql.join(
      list.map((c) => sql`${c}`),
      sql`, `,
    )}]::text[]) as n`,
  );
  const n = Number(row?.n ?? 0);
  if (!n) return 0;
  const names = await tx
    .select({ name: reportTypes.shortName })
    .from(reportTypes)
    .where(inArray(reportTypes.code, list))
    .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code));
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: 'types:',
    action: 'update',
    changes: [{ field: 'gns', to: names.map((x) => x.name) }],
  });
  return n;
}

/* ───────────── Массовые действия ───────────── */

export type BulkResult =
  | { ok: true; records: AdminDictValueRecord[]; redue: RedueScope | null }
  | { ok: false; code: string; result: Exclude<AdminDictSaveResult, { ok: true }> };

/**
 * «Включить» / «Отключить» у отмеченных (прототип bulkActive, benActive): у каждого значения — как
 * одной кнопкой, со своей строкой истории; уже в этом состоянии — без изменений. Отказ у одного —
 * отказ всего (вызывающий откатывает транзакцию).
 */
export async function adminDictBulkActive(
  tx: Tx,
  dict: AdminValueDict,
  codes: readonly string[],
  active: boolean,
): Promise<BulkResult> {
  const records: AdminDictValueRecord[] = [];
  const redue: (RedueScope | null | undefined)[] = [];
  for (const code of new Set(codes)) {
    const before = await getAdminDictValue(tx, dict, code);
    if (!before) return { ok: false, code, result: { ok: false, reason: 'not_found' } };
    const saved = await adminDictSetActive(tx, dict, code, active, before.version);
    if (!saved.ok) return { ok: false, code, result: saved };
    records.push(saved.record);
    redue.push(saved.redue);
  }
  return { ok: true, records, redue: mergeRedueScopes(redue.map((x) => x ?? null)) };
}

/** «Изменить срок у N видов»: что менять — пусто, не менять. */
export interface BulkDueChange {
  /** «Срок: число» — от 1 до 31. */
  day?: number;
  /** «Месяцев после периода» — у месячных, квартальных и полугодовых, от 0 до 6. */
  after?: number;
  /** «Месяц следующего года» — у годовых. */
  month?: number;
}

/**
 * «Изменить срок у N видов» (прототип bulkDueDlg): число — у всех, месяцев после периода — у
 * не годовых, месяц — у годовых; каждый вид — как окном вида (`adminDictUpdate`: история, пересчёт
 * сроков его несданных отчётов).
 */
export async function adminTypesBulkDue(
  tx: Tx,
  codes: readonly string[],
  change: BulkDueChange,
): Promise<BulkResult> {
  const records: AdminDictValueRecord[] = [];
  const redue: (RedueScope | null | undefined)[] = [];
  for (const code of new Set(codes)) {
    const before = await getAdminDictValue(tx, 'types', code);
    if (!before) return { ok: false, code, result: { ok: false, reason: 'not_found' } };
    const yearly = before.data.period === 'Y';
    const data = {
      ...before.data,
      ...(change.day !== undefined ? { dueDay: change.day } : {}),
      ...(!yearly && change.after !== undefined ? { dueAfter: change.after } : {}),
      ...(yearly && change.month !== undefined ? { dueMonth: change.month } : {}),
    };
    const saved = await adminDictUpdate(
      tx,
      'types',
      code,
      { name: before.name, data },
      before.version,
    );
    if (!saved.ok) return { ok: false, code, result: saved };
    records.push(saved.record);
    redue.push(saved.redue);
  }
  return { ok: true, records, redue: mergeRedueScopes(redue.map((x) => x ?? null)) };
}
