import {
  auditActorName,
  calendarAdminYears,
  gkedRuleEmpty,
  isEveryYear,
  propertyRateTyiyn,
  sameHistoryValue,
  toHistoryValue,
  weekdayMondayFirst,
  type CalendarDayKind,
  type GkedGroupActs,
  type GkedRule,
  type HistoryChange,
  type IoSectionDict,
  type IoValue,
  type IsoDate,
  type UiTextKey,
} from '@buhuchet/domain';
import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { adminCalendarDelete, calendarDays } from './admin-calendar';
import type { IoRecord } from './admin-dict-io';
import {
  adminEnRates,
  adminGkedGroups,
  adminGkedGroupSave,
  enRateRow,
  readReference,
  saveReference,
  unknownGkedCodes,
  updateEnRate,
} from './admin-gked';
import type { AdminDictHistoryItem } from './admin-platform-dicts';
import type { Tx } from './client';
import { writePlatformHistory } from './platform-history';
import type { RedueScope } from './reports-redue';
import { gkedItems, platformAuditLog, productionCalendar, reportTypes } from './schema';

/*
 * Админка → «Справочники платформы» → «Выгрузить» и «Загрузить» у календаря, «Налогов и ставок» и групп
 * кодов ГКЭД (задачи 2.37, часть 3, и 2.38; прототип admin/platform-dicts-io.js: DX.calendar,
 * DX.taxes, DX.enrates, DX.proprates, DX.gkgroups). Эти справочники правятся не общим механизмом
 * значений: у каждого — свои значения для файла, запись строки и её откат. Разбор и сравнение — те же
 * (`parseIoRows`, `ioChanges`); всё — в `withUserContext` администратора платформы.
 */

/** Отказ записи строки: текст словаря с подстановками; `changed` — запись изменили между чтением и записью. */
export type SectionFail = { key: UiTextKey; params?: Record<string, string> } | 'changed';

export type SectionSaveResult =
  { ok: true; record: IoRecord; redue?: RedueScope | null } | { ok: false; fail: SectionFail };

export interface SectionWriter {
  /** Значения для файла и сравнения — в порядке справочника. */
  records(tx: Tx, today: IsoDate): Promise<IoRecord[]>;
  /** Записать строку файла: новое значение (`base` нет) или правку. */
  save(
    tx: Tx,
    value: IoValue,
    base: IoRecord | undefined,
    today: IsoDate,
  ): Promise<SectionSaveResult>;
  /** Откат загрузки: убрать значение, которое она добавила. */
  remove(tx: Tx, record: IoRecord, today: IsoDate): Promise<SectionSaveResult | { ok: true }>;
}

const fail = (key: UiTextKey, params?: Record<string, string>): SectionSaveResult => ({
  ok: false,
  fail: { key, ...(params ? { params } : {}) },
});
const CHANGED: SectionSaveResult = { ok: false, fail: 'changed' };

/** «Было → стало» по полям значения (название — `name`). */
function changesOf(before: IoValue | null, after: IoValue): HistoryChange[] {
  const was: Record<string, unknown> = before ? { name: before.name, ...before.data } : {};
  const now: Record<string, unknown> = { name: after.name, ...after.data };
  return Object.keys(now)
    .filter((f) => !sameHistoryValue(toHistoryValue(was[f]), toHistoryValue(now[f])))
    .map((f) =>
      before
        ? { field: f, from: toHistoryValue(was[f]), to: toHistoryValue(now[f]) }
        : { field: f, to: toHistoryValue(now[f]) },
    )
    .filter(
      (c) => before || (c.to !== null && c.to !== '' && !(Array.isArray(c.to) && !c.to.length)),
    );
}

async function history(
  tx: Tx,
  dict: IoSectionDict,
  code: string,
  action: 'create' | 'update' | 'delete',
  changes: HistoryChange[],
) {
  if (!changes.length) return;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `${dict}:${code}`,
    action,
    changes,
  });
}

/* ───────────── Производственный календарь ───────────── */

const CALENDAR_REDUE: RedueScope = { kind: 'calendar' };

/**
 * Календарь (прототип DX.calendar): строки — дни текущего и следующего года, код — дата. Праздник
 * «каждый год» — строка в каждом году; у него меняется только название (ОТКЛОНЕНИЕ:
 * docs/deviations.md#Д-19).
 */
const calendarWriter: SectionWriter = {
  async records(tx, today) {
    return (await calendarDays(tx, today)).map((x) => ({
      code: x.date,
      name: x.name,
      active: true,
      data: { kind: x.kind, rule: x.everyYear ? 'yearly' : 'once', key: x.key },
      version: x.version,
    }));
  },
  async save(tx, value, base, today) {
    const [y1, y2] = calendarAdminYears(today);
    const date = value.code;
    const kind = value.data.kind as CalendarDayKind;
    const rule = value.data.rule as 'once' | 'yearly';
    const name = kind === 'workday' ? '' : value.name.trim();
    if (![y1, y2].includes(Number(date.slice(0, 4)))) {
      return fail('pdicts.io.err.cal_year', { y1: String(y1), y2: String(y2) });
    }
    if (kind === 'workday' && weekdayMondayFirst(date) !== 5)
      return fail('pdicts.io.err.cal_saturday');
    if (kind !== 'workday' && !name) return fail('pdicts.io.err.cal_name');
    const yearly = base?.data.rule === 'yearly';
    // ОТКЛОНЕНИЕ: docs/deviations.md#Д-19
    if (rule === 'yearly' && !yearly) return fail('pdicts.io.err.cal_yearly');
    if (yearly && (rule !== 'yearly' || kind !== base!.data.kind)) {
      return fail('pdicts.io.err.cal_yearly');
    }
    const key = base ? String(base.data.key) : date;
    const after: IoValue = { code: date, name, active: true, data: { kind, rule, key } };
    // Праздник «каждый год» — строка в обоих годах: вторая строка с тем же названием уже записана.
    const [now] = base
      ? await tx.select().from(productionCalendar).where(eq(productionCalendar.day, key))
      : [];
    if (base && !now) return CHANGED;
    if (now && now.kind === kind && now.name === name) {
      return { ok: true, record: { ...after, version: now.version } };
    }
    if (!base) {
      const [row] = await tx.execute<{ version: number | null }>(
        sql`select app.admin_calendar_insert(${date}, ${kind}, ${name}) as version`,
      );
      const version = row?.version ?? null;
      if (!version) return CHANGED;
      await history(tx, 'calendar', key, 'create', [
        { field: 'kind', to: kind },
        ...(name ? [{ field: 'name', to: name }] : []),
      ]);
      return { ok: true, record: { ...after, version }, redue: CALENDAR_REDUE };
    }
    // Что запись не изменили после сравнения, проверяет отметка загрузки; здесь — нынешняя версия.
    const [row] = await tx.execute<{ version: number | null }>(
      sql`select app.admin_calendar_update(${key}, ${kind}, ${name}, ${now!.version}) as version`,
    );
    const version = row?.version ?? null;
    if (!version) return CHANGED;
    const changes: HistoryChange[] = [];
    if (now!.kind !== kind) changes.push({ field: 'kind', from: now!.kind, to: kind });
    if (now!.name !== name) changes.push({ field: 'name', from: now!.name, to: name });
    await history(tx, 'calendar', key, 'update', changes);
    return { ok: true, record: { ...after, version }, redue: CALENDAR_REDUE };
  },
  async remove(tx, record) {
    const key = String(record.data.key ?? record.code);
    if (isEveryYear(key)) return CHANGED;
    const [now] = await tx
      .select({ version: productionCalendar.version })
      .from(productionCalendar)
      .where(eq(productionCalendar.day, key));
    if (!now) return { ok: true };
    const deleted = await adminCalendarDelete(tx, key, now.version);
    return deleted.ok
      ? { ok: true, record, redue: CALENDAR_REDUE }
      : deleted.reason === 'not_found'
        ? { ok: true }
        : CHANGED;
  },
};

/* ───────────── Разделы-массивы: налоги и ставки налога на имущество ───────────── */

type Stored = Record<string, unknown> & { code: string };

const itemsOf = (payload: unknown): Stored[] =>
  Array.isArray(payload)
    ? (payload as Stored[]).filter((x) => x && typeof x.code === 'string')
    : [];

/**
 * Раздел-массив `platform_reference`: значение — запись массива по коду; запись строки переписывает
 * раздел нынешней версии (строки загрузки идут одна за другой в одной транзакции; что раздел не
 * изменился после сравнения, проверяет отметка загрузки).
 */
function arrayWriter(
  dict: 'taxes' | 'proprates',
  key: 'taxes' | 'propertyRates',
  toValue: (x: Stored) => Omit<IoValue, 'code'>,
  toStored: (value: IoValue, old: Stored | undefined) => Stored,
  check: (tx: Tx, value: IoValue, base: IoRecord | undefined) => Promise<SectionSaveResult | null>,
): SectionWriter {
  return {
    async records(tx) {
      const ref = await readReference(tx, key);
      return itemsOf(ref?.payload).map((x) => ({
        code: x.code,
        ...toValue(x),
        version: ref!.version,
      }));
    },
    async save(tx, value, base) {
      const problem = await check(tx, value, base);
      if (problem) return problem;
      const ref = await readReference(tx, key);
      if (!ref) return CHANGED;
      const items = itemsOf(ref.payload);
      const at = items.findIndex((x) => x.code === value.code);
      if (base ? at < 0 : at >= 0) return CHANGED;
      const old = at >= 0 ? items[at] : undefined;
      const stored = toStored(value, old);
      const next = at >= 0 ? items.map((x, i) => (i === at ? stored : x)) : [...items, stored];
      const version = await saveReference(tx, key, next, ref.version);
      if (version === null) return CHANGED;
      const record = { code: value.code, ...toValue(stored), version };
      await history(
        tx,
        dict,
        value.code,
        base ? 'update' : 'create',
        changesOf(base ?? null, { ...record }),
      );
      return { ok: true, record };
    },
    async remove(tx, record) {
      const ref = await readReference(tx, key);
      if (!ref) return { ok: true };
      const items = itemsOf(ref.payload);
      if (!items.some((x) => x.code === record.code)) return { ok: true };
      const version = await saveReference(
        tx,
        key,
        items.filter((x) => x.code !== record.code),
        ref.version,
      );
      if (version === null) return CHANGED;
      await history(tx, dict, record.code, 'delete', [{ field: 'name', from: record.name }]);
      return { ok: true };
    },
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

const TAX_TEXT = [
  'group',
  'level',
  'payers',
  'base',
  'rates',
  'period',
  'reportDue',
  'payDue',
  'form',
  'organ',
  'art',
  'note',
] as const;

/** Налоги (прототип DX.taxes): «Справка» налога (`guide`) и служебные поля записи сохраняются. */
const taxesWriter = arrayWriter(
  'taxes',
  'taxes',
  (x) => ({
    name: str(x.name),
    active: x.active !== false,
    data: {
      ...Object.fromEntries(TAX_TEXT.map((k) => [k, str(x[k])])),
      reportTypes: Array.isArray(x.reportTypes) ? (x.reportTypes as string[]) : [],
      gked: (x.gked as GkedRule | null | undefined) ?? null,
      verify: x.verify === true,
    },
  }),
  (value, old) => {
    const gked = value.data.gked as GkedRule | null;
    const stored: Stored = {
      ...(old ?? { active: true }),
      code: value.code,
      name: value.name.trim(),
      ...Object.fromEntries(TAX_TEXT.map((k) => [k, str(value.data[k]).trim()])),
      reportTypes: [...((value.data.reportTypes as string[] | undefined) ?? [])],
      verify: value.data.verify === true,
    };
    if (gked && !gkedRuleEmpty(gked)) stored.gked = gked;
    else delete stored.gked;
    return stored;
  },
  async (tx, value, base) => {
    const types = (value.data.reportTypes as string[] | undefined) ?? [];
    if (types.length) {
      const known = await tx
        .select({ code: reportTypes.code })
        .from(reportTypes)
        .where(inArray(reportTypes.code, types));
      const unknown = types.filter((c) => !known.some((k) => k.code === c));
      if (unknown.length) return fail('pdicts.io.err.tax_types', { codes: unknown.join(', ') });
    }
    const unknown = await unknownGkedCodes(
      tx,
      (value.data.gked as GkedRule | null) ?? null,
      (base?.data.gked as GkedRule | null | undefined) ?? null,
    );
    return unknown.length
      ? fail('pdicts.io.err.gked_unknown', { codes: unknown.join(', ') })
      : null;
  },
);

const PROPERTY_MONEY = ['homeA', 'homeB', 'homeLand', 'bizA', 'bizB', 'bizLand'] as const;

/** Ставки налога на имущество (прототип DX.proprates): в разделе — сомы, в файле и сравнении — тыйыны. */
const propratesWriter = arrayWriter(
  'proprates',
  'propertyRates',
  (x) => ({
    name: str(x.place),
    active: x.active !== false,
    data: {
      region: str(x.region),
      ...Object.fromEntries(PROPERTY_MONEY.map((k) => [k, propertyRateTyiyn(x[k])])),
    },
  }),
  (value, old) => ({
    ...(old ?? { active: true }),
    code: value.code,
    place: value.name.trim(),
    region: str(value.data.region).trim(),
    ...Object.fromEntries(PROPERTY_MONEY.map((k) => [k, Number(value.data[k] ?? 0) / 100])),
  }),
  () => Promise.resolve(null),
);

/* ───────────── Ставки единого налога ───────────── */

/**
 * Ставки единого налога (прототип DX.enrates и поля продукта): таблица `single_tax_rates` — функциями
 * базы общего механизма (справочник `enrates`). Перечень ГКЭД ставки — по основному ГКЭД (`main`).
 */
const enratesWriter: SectionWriter = {
  async records(tx) {
    return (await adminEnRates(tx)).map((x) => ({
      code: x.code,
      name: x.activity,
      active: x.active,
      data: {
        rate: x.rate,
        rateCashless: x.rateCashless,
        rateCash: x.rateCash,
        conditions: x.conditions,
        article: x.article,
        explanation: x.explanation,
        addsTo: x.addsTo,
        gked: x.gked,
      },
      version: x.version,
    }));
  },
  async save(tx, value, base) {
    const rates = await adminEnRates(tx);
    const addsTo = [...new Set((value.data.addsTo as string[] | undefined) ?? [])];
    const bad = addsTo.filter((c) => c === value.code || !rates.some((r) => r.code === c));
    if (bad.length) return fail('pdicts.io.err.adds_to', { codes: bad.join(', ') });
    const rule = (value.data.gked as GkedRule | null) ?? null;
    const gked = rule && !gkedRuleEmpty(rule) ? { ...rule, main: true } : null;
    const old = (base?.data.gked as GkedRule | null | undefined) ?? null;
    const unknown = await unknownGkedCodes(tx, gked, old);
    if (unknown.length) return fail('pdicts.io.err.gked_unknown', { codes: unknown.join(', ') });
    const x = {
      code: value.code,
      activity: value.name,
      rate: str(value.data.rate),
      rateCashless: str(value.data.rateCashless),
      rateCash: str(value.data.rateCash),
      conditions: str(value.data.conditions),
      article: str(value.data.article),
      explanation: str(value.data.explanation),
      gked,
      addsTo,
    };
    let version: number | null;
    if (base) {
      version = await updateEnRate(tx, x, base.version);
    } else {
      const [row] = await tx.execute<{ version: number | null }>(
        sql`select app.admin_dict_insert('enrates', ${x.code}, ${JSON.stringify(enRateRow(x))}::jsonb) as version`,
      );
      version = row?.version ?? null;
    }
    if (version === null) return CHANGED;
    if (base?.active !== value.active && (base || !value.active)) {
      const [row] = await tx.execute<{ version: number | null }>(
        sql`select app.admin_dict_set_active('enrates', ${x.code}, ${value.active}, ${version}) as version`,
      );
      version = row?.version ?? null;
      if (version === null) return CHANGED;
    }
    const [after] = (await this.records(tx, '' as IsoDate)).filter((r) => r.code === x.code);
    if (!after) return CHANGED;
    const was = base && { ...base, data: { ...base.data, active: base.active } };
    await history(
      tx,
      'enrates',
      x.code,
      base ? 'update' : 'create',
      changesOf(was ?? null, { ...after, data: { ...after.data, active: after.active } }),
    );
    return { ok: true, record: after };
  },
  async remove(tx, record) {
    const [now] = await adminEnRates(tx, record.code);
    if (!now) return { ok: true };
    try {
      const deleted = await tx.transaction(async (sp) => {
        const [row] = await sp.execute<{ deleted: boolean | null }>(
          sql`select app.admin_dict_delete('enrates', ${record.code}, ${now.version}) as deleted`,
        );
        return row?.deleted === true;
      });
      if (deleted) {
        await history(tx, 'enrates', record.code, 'delete', [
          { field: 'name', from: now.activity },
        ]);
        return { ok: true };
      }
    } catch (err) {
      // Ставку уже указали у вида отчёта («Не для ставок ЕН») — её можно только отключить.
      const code = ((err as { cause?: { code?: string } })?.cause ?? err) as { code?: string };
      if (code?.code !== '23503') throw err;
    }
    if (!now.active) return { ok: true };
    const [row] = await tx.execute<{ version: number | null }>(
      sql`select app.admin_dict_set_active('enrates', ${record.code}, false, ${now.version}) as version`,
    );
    if (row?.version == null) return CHANGED;
    await history(tx, 'enrates', record.code, 'update', [
      { field: 'active', from: true, to: false },
    ]);
    return { ok: true };
  },
};

/* ───────────── Группы кодов ГКЭД ───────────── */

/**
 * Группы кодов (прототип DX.gkgroups): правка — как окном группы (`adminGkedGroupSave`), с перечнями
 * единого налога и СПиНО.
 */
const gkgroupsWriter: SectionWriter = {
  async records(tx) {
    const { items, version } = await adminGkedGroups(tx);
    return items.map((g) => ({
      code: g.id,
      name: g.name,
      active: true,
      data: { codes: [...g.codes], en: g.en, spino: g.spino, ask: g.ask, why: g.why },
      version,
    }));
  },
  async save(tx, value, base) {
    const { version } = await adminGkedGroups(tx);
    const saved = await adminGkedGroupSave(
      tx,
      value.code,
      {
        name: value.name.trim(),
        codes: (value.data.codes as string[] | undefined) ?? [],
        en: (value.data.en as GkedGroupActs | undefined) ?? null,
        spino: (value.data.spino as GkedGroupActs | undefined) ?? null,
        ask: str(value.data.ask).trim(),
        why: str(value.data.why).trim(),
      },
      version,
      !base,
    );
    if (!saved.ok) {
      if (saved.reason === 'codes') {
        return fail('pdicts.io.err.gked_unknown', { codes: saved.unknown.join(', ') });
      }
      return CHANGED;
    }
    const g = saved.group;
    return {
      ok: true,
      record: {
        code: g.id,
        name: g.name,
        active: true,
        data: { codes: [...g.codes], en: g.en, spino: g.spino, ask: g.ask, why: g.why },
        version: saved.version,
      },
    };
  },
  async remove(tx, record) {
    const { version, items } = await adminGkedGroups(tx);
    if (!items.some((g) => g.id === record.code)) return { ok: true };
    const saved = await adminGkedGroupSave(tx, record.code, null, version);
    return saved.ok ? { ok: true } : CHANGED;
  },
};

export const SECTION_WRITERS: Readonly<Record<IoSectionDict, SectionWriter>> = {
  calendar: calendarWriter,
  taxes: taxesWriter,
  enrates: enratesWriter,
  proprates: propratesWriter,
  gkgroups: gkgroupsWriter,
};

/* ───────────── История ───────────── */

/** Разделы общей «Истории изменений»: ГКЭД с группами кодов и «Налоги и ставки» (три таблицы). */
export type HistorySection = IoSectionDict | 'gked';

/**
 * «История изменений · N» вкладки из нескольких разделов (прототип pdHistHtml('gked'),
 * pdHistHtml('taxes')): последние `limit` записей, сначала новые. У записи — раздел и код; подпись —
 * название из самой записи у добавления и удаления, у правки — нынешнее (иначе код). Загрузка и откат
 * — записи без кода.
 */
export async function adminSectionHistory(
  tx: Tx,
  sections: readonly HistorySection[],
  limit: number,
  today: IsoDate,
): Promise<{ total: number; items: (AdminDictHistoryItem & { section: HistorySection })[] }> {
  const where = and(
    eq(platformAuditLog.entity, 'platform_dict'),
    or(...sections.map((s) => sql`starts_with(${platformAuditLog.entityId}, ${`${s}:`})`)),
  );
  const [rows, [counted]] = await Promise.all([
    tx
      .select()
      .from(platformAuditLog)
      .where(where)
      .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
      .limit(limit),
    tx.select({ n: count() }).from(platformAuditLog).where(where),
  ]);
  const sectionOf = (entityId: string) => sections.find((s) => entityId.startsWith(`${s}:`))!;
  // Нынешние названия — только тех кодов, что есть в показанных записях.
  const wanted = new Map<HistorySection, Set<string>>();
  for (const r of rows) {
    const s = sectionOf(r.entityId);
    const code = r.entityId.slice(s.length + 1);
    if (code && r.action === 'update') wanted.set(s, (wanted.get(s) ?? new Set()).add(code));
  }
  const names = new Map<string, string>();
  for (const [s, codes] of wanted) {
    if (s === 'gked') {
      const found = await tx
        .select({ code: gkedItems.code, name: gkedItems.name })
        .from(gkedItems)
        .where(inArray(gkedItems.code, [...codes]));
      for (const x of found) names.set(`gked:${x.code}`, x.name);
    } else {
      for (const x of await SECTION_WRITERS[s].records(tx, today)) {
        if (codes.has(x.code)) names.set(`${s}:${x.code}`, x.name);
      }
    }
  }
  return {
    total: counted?.n ?? 0,
    items: rows.map((r) => {
      const section = sectionOf(r.entityId);
      const code = r.entityId.slice(section.length + 1);
      const changes = (r.changes ?? []) as HistoryChange[];
      const name = changes.find((c) => c.field === 'name');
      const own = String((r.action === 'create' ? name?.to : name?.from) ?? '');
      return {
        id: String(r.id),
        at: r.at,
        actor: auditActorName(r.actorUserId, null),
        action: r.action,
        section,
        code,
        label: (r.action === 'update' ? names.get(r.entityId) : own) || own || code,
        changes,
      };
    }),
  };
}
