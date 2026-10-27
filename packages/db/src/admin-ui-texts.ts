import { auditActorName, type ListQuery, type UiLanguage } from '@buhuchet/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
} from './list';
import { writePlatformHistory } from './platform-history';
import { uiTexts } from './schema';

/**
 * Админка → «Локализация» (ТЗ «Модуль Локализация»; прототип admin/l10n.js): список словаря текстов
 * интерфейса одного языка и правка текста. Словарь общий для всех организаций, роль приложения его
 * только читает (миграция 0017); текст меняет функция `app.admin_set_ui_text` (миграция 0034) — только
 * администратору платформы, историю пишет сервер в `platform_audit_log` в той же транзакции.
 */

/** Текст словаря в списке «Локализации». */
export interface UiTextRecord {
  key: string;
  text: string;
  section: string;
  audit: { createdAt: Date; createdBy: string | null; updatedAt: Date; updatedBy: string | null };
  version: number;
}

const t = uiTexts;

const fields = {
  key: t.key,
  text: t.text,
  section: t.section,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  createdBy: t.createdBy,
  updatedBy: t.updatedBy,
  version: t.version,
};

type Row = typeof uiTexts.$inferSelect;

/**
 * «Создал» и «Изменил» у текста — только администратор платформы (записи сотрудника у него нет);
 * текст из наполнения — без автора.
 */
function toRecord(r: Omit<Row, 'lang'>): UiTextRecord {
  const createdBy = auditActorName(r.createdBy, null);
  return {
    key: r.key,
    text: r.text,
    section: r.section,
    audit: {
      createdAt: r.createdAt,
      createdBy,
      updatedAt: r.updatedAt,
      updatedBy: auditActorName(r.updatedBy, null) ?? createdBy,
    },
    version: r.version,
  };
}

const NO_NAME: SQL = sql`null::text`;
const CREATED_BY = auditActorValue(t.createdBy, NO_NAME);

/**
 * Столбцы списка «Локализации» на сервере (прототип: «Ключ», «Русский текст», «Раздел»); ключи — как
 * у столбцов экрана, служебные «Создал / Изменил / Создано / Изменено» — общие.
 */
export function uiTextListColumns(): ListColumns {
  return {
    key: { type: 'text', label: 'locale.col.key', value: t.key },
    text: { type: 'text', label: 'locale.col.text', value: t.text },
    section: { type: 'enum', label: 'locale.col.section', value: t.section },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: t.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: t.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(t.updatedBy, NO_NAME)}, ${CREATED_BY})`,
    },
  };
}

const NATURAL = [t.createdAt, t.key];

function langFrom(tx: Tx, lang: UiLanguage): ListFrom {
  return (f) => tx.select(f).from(t).where(eq(t.lang, lang)).$dynamic();
}

/** Страница словаря языка: сортировка, страница, фильтры, поиск и группы — на сервере. */
export async function listUiTextsPage(
  tx: Tx,
  lang: UiLanguage,
  query: ListQuery,
): Promise<ListPageResult<UiTextRecord>> {
  const page = await selectListPage({
    query,
    columns: uiTextListColumns(),
    natural: NATURAL,
    scope: eq(t.lang, lang),
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...fields, ...window })
        .from(t)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: langFrom(tx, lang),
  });
  return { ...page, rows: page.rows.map((r) => toRecord(r)) };
}

/** Значения столбца словаря для фильтра-галочек; `q` — «Найти значение». */
export function listUiTextValues(tx: Tx, lang: UiLanguage, key: string, q?: string) {
  return selectListValues({
    columns: uiTextListColumns(),
    key,
    scope: eq(t.lang, lang),
    from: langFrom(tx, lang),
    q,
  });
}

/** Словарь для выгрузки в Excel: все тексты под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportUiTexts(tx: Tx, lang: UiLanguage, query: ListQuery, keys: readonly string[]) {
  return selectListExport({
    query,
    columns: uiTextListColumns(),
    keys,
    natural: NATURAL,
    scope: eq(t.lang, lang),
    from: langFrom(tx, lang),
  });
}

/** Один текст словаря; нет такого ключа — null. */
export async function getUiText(
  tx: Tx | Db,
  lang: UiLanguage,
  key: string,
): Promise<UiTextRecord | null> {
  const [row] = await tx
    .select(fields)
    .from(t)
    .where(and(eq(t.lang, lang), eq(t.key, key)));
  return row ? toRecord(row) : null;
}

/** Сколько текстов у языка — для отметки «сколько строк переведено» (ТЗ «Модуль Локализация»). */
export async function countUiTexts(tx: Tx | Db, lang: UiLanguage): Promise<number> {
  return tx.$count(t, eq(t.lang, lang));
}

export type UiTextSaveResult =
  { ok: true; record: UiTextRecord } | { ok: false; reason: 'not_found' | 'changed' };

/**
 * Правка текста словаря администратором платформы (прототип: окно «Текст интерфейса», «Сохранить»):
 * новый текст, версия, «Изменил»; «было → стало» — в историю платформы (`ui_text`, ключ `язык:ключ`) в
 * той же транзакции. Правила текста (`uiTextProblem`) проверяет вызывающий; тот же текст — без новой
 * версии и записи в историю. Транзакция — `withUserContext` администратора. Устаревшая версия —
 * `changed`.
 */
export async function adminSetUiText(
  tx: Tx,
  input: { lang: UiLanguage; key: string; text: string; version: number },
): Promise<UiTextSaveResult> {
  const before = await getUiText(tx, input.lang, input.key);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== input.version) return { ok: false, reason: 'changed' };
  if (before.text === input.text) return { ok: true, record: before };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_ui_text(${input.lang}, ${input.key}, ${input.text}, ${input.version}) as version`,
  );
  // Пусто — версию успели сменить: права администратора проверил вызывающий (`requirePlatformAdmin`,
  // `withUserContext`), текст — `uiTextProblem`; иначе функция откажет так же, но ответ будет «changed».
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'ui_text',
    entityId: `${input.lang}:${input.key}`,
    action: 'update',
    changes: [{ field: 'text', from: before.text, to: input.text }],
  });
  const after = await getUiText(tx, input.lang, input.key);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}
