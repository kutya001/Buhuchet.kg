import {
  ADMIN_PERMISSION_COLUMNS,
  ADMIN_PERMISSION_SORT,
  auditActorName,
  DEFAULT_UI_LANGUAGE,
  type ListQuery,
  messageTemplateLabelKey,
  MESSAGE_TEMPLATE_ORDER,
  PERIOD_ROWS,
  RecordChangedError,
  RecordNotFoundError,
  scaleStatuses,
  statusPlace,
  STATUS_SCALES,
  statusToneKey,
  type AdminSystemDict,
  type HistoryChange,
  type PeriodRowCode,
  type StatusPlace,
  type StatusScaleKey,
  type StatusTone,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { adminSetUiText, getUiText } from './admin-ui-texts';
import type { AdminDictHistoryItem } from './admin-platform-dicts';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { writePlatformHistory } from './platform-history';
import { reportStatusNotes } from './platform-values';
import {
  messageTemplateTexts,
  permissions,
  platformAuditLog,
  roleTemplates,
  statusTones,
} from './schema';

/*
 * Админка → «Справочники платформы», вкладки группы «Работа системы» (задача 2.36, часть 3; ТЗ
 * «Справочники, на которых держится логика системы», «Шаблоны для организаций»; прототип
 * admin/platform-dicts.js): «Статусы» (названия и цвета, периодичность), «Права ролей», «Шаблоны ролей»
 * и «Шаблоны» сообщений. Таблицы роль приложения только читает (миграция «admin_platform_dicts_system»):
 * правят узкие функции администратора платформы, названия статусов и периодичности — тексты словаря
 * (`app.admin_set_ui_text`). История — `platform_audit_log`, сущность `platform_dict`, ключ
 * `<вкладка>:<код>`, в той же транзакции. Проверки значений (`@buhuchet/domain`) делает вызывающий.
 * Транзакция — `withUserContext` администратора; устаревшая версия — `RecordChangedError`.
 */

const lang = DEFAULT_UI_LANGUAGE;

/** Ключ словаря названия статуса и периодичности. */
const statusNameKey = (scale: StatusScaleKey, code: string) => `status.${scale}.${code}`;
const periodNameKey = (code: PeriodRowCode) => `report.period.${code}`;

async function history(
  tx: Tx,
  dict: AdminSystemDict,
  code: string,
  changes: HistoryChange[],
): Promise<void> {
  if (!changes.length) return;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `${dict}:${code}`,
    action: 'update',
    changes,
  });
}

/* ---------- Цвета статусов в словаре экранов ---------- */

/**
 * Цвета статусов для словаря экранов: `tone.<шкала>.<код>` → цвет (`statusToneKey`). Экраны берут цвет
 * из словаря, поэтому правка в Админке сразу видна на шкалах и метках всех организаций.
 */
export async function statusToneTexts(db: Db | Tx): Promise<Record<string, string>> {
  const rows = await db
    .select({ scale: statusTones.scale, status: statusTones.status, tone: statusTones.tone })
    .from(statusTones);
  return Object.fromEntries(rows.map((r) => [statusToneKey(r.scale, r.status), r.tone]));
}

/** Отметка цветов: по ней словарь экранов видит, что цвета изменились. */
export async function statusTonesStamp(db: Db | Tx): Promise<string> {
  const [row] = await db
    .select({
      hash: sql<string>`md5(coalesce(string_agg(${statusTones.scale} || '.' || ${statusTones.status} || '=' || ${statusTones.tone}, ',' order by ${statusTones.scale}, ${statusTones.status}), ''))`,
    })
    .from(statusTones);
  return row?.hash ?? '';
}

/* ---------- «Статусы» ---------- */

export interface AdminStatusRecord {
  scale: StatusScaleKey;
  code: string;
  place: StatusPlace;
  name: string;
  /** Версия текста названия в словаре. */
  nameVersion: number;
  /** Пояснение статуса отчёта (раздел `statusNotes`); у других шкал — пусто. */
  note: string;
  tone: StatusTone;
  toneVersion: number;
}

export interface AdminPeriodRecord {
  code: PeriodRowCode;
  perYear: number;
  name: string;
  nameVersion: number;
}

/** Версии текстов словаря по ключам. */
async function textVersions(tx: Tx, keys: string[]): Promise<Map<string, number>> {
  const records = await Promise.all(keys.map((k) => getUiText(tx, lang, k)));
  return new Map(records.flatMap((r) => (r ? [[r.key, r.version] as const] : [])));
}

/**
 * Вкладка «Статусы»: статусы всех шкал по порядку шкалы — место на шкале, название (словарь), цвет и
 * у статусов отчёта пояснение — и блок «Периодичность отчётов». Названия — те же тексты, что на экранах (`t`).
 */
export async function adminStatuses(
  tx: Tx,
  t: ListTexts,
): Promise<{ statuses: AdminStatusRecord[]; periods: AdminPeriodRecord[] }> {
  const all = STATUS_SCALES.flatMap((scale) =>
    scaleStatuses(scale).map((code) => ({ scale, code })),
  );
  const [tones, notes, versions] = await Promise.all([
    tx.select().from(statusTones),
    reportStatusNotes(tx),
    textVersions(tx, [
      ...all.map((x) => statusNameKey(x.scale, x.code)),
      ...PERIOD_ROWS.map((p) => periodNameKey(p.code)),
    ]),
  ]);
  const toneOf = new Map(tones.map((r) => [`${r.scale}.${r.status}`, r]));
  return {
    statuses: all.flatMap(({ scale, code }) => {
      const tone = toneOf.get(`${scale}.${code}`);
      if (!tone) return [];
      const key = statusNameKey(scale, code);
      return [
        {
          scale,
          code,
          place: statusPlace(scale, code),
          name: t(key),
          nameVersion: versions.get(key) ?? 0,
          note: scale === 'report' ? (notes.get(code) ?? '') : '',
          tone: tone.tone,
          toneVersion: tone.version,
        },
      ];
    }),
    periods: PERIOD_ROWS.map((p) => ({
      code: p.code,
      perYear: p.perYear,
      name: t(periodNameKey(p.code)),
      nameVersion: versions.get(periodNameKey(p.code)) ?? 0,
    })),
  };
}

/** Сохранить текст словаря; тот же текст — без новой версии и без записи в историю. */
async function setText(
  tx: Tx,
  key: string,
  text: string,
  version: number,
): Promise<{ from: string; changed: boolean }> {
  const before = await getUiText(tx, lang, key);
  if (!before) throw new RecordNotFoundError('ui_text', key);
  const saved = await adminSetUiText(tx, { lang, key, text, version });
  if (!saved.ok) {
    if (saved.reason === 'not_found') throw new RecordNotFoundError('ui_text', key);
    throw new RecordChangedError('ui_text', key, before.version);
  }
  return { from: before.text, changed: before.text !== text };
}

/**
 * «Название статуса» (прототип: «Статусы: «К сдаче» переименован в «К отправке»»): текст словаря
 * `status.<шкала>.<код>` и запись в историю вкладки.
 */
export async function adminSetStatusName(
  tx: Tx,
  input: { scale: StatusScaleKey; code: string; name: string; version: number },
): Promise<void> {
  const { from, changed } = await setText(
    tx,
    statusNameKey(input.scale, input.code),
    input.name,
    input.version,
  );
  if (changed) {
    await history(tx, 'statuses', `${input.scale}.${input.code}`, [
      { field: 'name', from, to: input.name },
    ]);
  }
}

/** «Название периодичности» (прототип: «Периодичность: «Месяц» → «Отчётный месяц»»). */
export async function adminSetPeriodName(
  tx: Tx,
  input: { code: PeriodRowCode; name: string; version: number },
): Promise<void> {
  const { from, changed } = await setText(tx, periodNameKey(input.code), input.name, input.version);
  if (changed) {
    await history(tx, 'statuses', `period.${input.code}`, [
      { field: 'name', from, to: input.name },
    ]);
  }
}

/** Цвет статуса для всех организаций; тот же цвет — без новой версии и без записи в историю. */
export async function adminSetStatusTone(
  tx: Tx,
  input: { scale: StatusScaleKey; code: string; tone: StatusTone; version: number },
): Promise<void> {
  const [before] = await tx
    .select()
    .from(statusTones)
    .where(and(eq(statusTones.scale, input.scale), eq(statusTones.status, input.code)));
  const id = `statuses:${input.scale}.${input.code}`;
  if (!before) throw new RecordNotFoundError('platform_dict', id);
  if (before.version !== input.version) {
    throw new RecordChangedError('platform_dict', id, before.version);
  }
  if (before.tone === input.tone) return;
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_status_tone(${input.scale}, ${input.code}, ${input.tone}, ${input.version}) as version`,
  );
  if (row?.version == null) throw new RecordChangedError('platform_dict', id, before.version);
  await history(tx, 'statuses', `${input.scale}.${input.code}`, [
    { field: 'tone', from: before.tone, to: input.tone },
  ]);
}

/* ---------- «Права ролей» ---------- */

export interface AdminPermissionRecord {
  id: string;
  group: string;
  name: string;
  description: string;
  version: number;
}

/** Права по порядку формы роли. */
export async function adminPermissions(tx: Tx): Promise<AdminPermissionRecord[]> {
  return tx
    .select({
      id: permissions.id,
      group: permissions.permGroup,
      name: permissions.name,
      description: permissions.description,
      version: permissions.version,
    })
    .from(permissions)
    .orderBy(asc(permissions.sortOrder), asc(permissions.id));
}

/** Право в списке вкладки: с названием группы из словаря. */
export interface AdminPermissionRow extends AdminPermissionRecord {
  groupText: string;
}

const pf = (key: string) => sql.raw(`"r"."${key}"`);

/**
 * Список «Права ролей» (`ADMIN_PERMISSION_COLUMNS`): строки одним параметром запроса — поиск, фильтры,
 * сортировка и группы общим механизмом списков. «Группа» — код группы, на экране и в сортировке —
 * название и порядок формы роли.
 */
export const adminPermissionListColumns: ListColumns = Object.fromEntries(
  ADMIN_PERMISSION_COLUMNS.map((c) => [
    c.key,
    c.key === 'group'
      ? {
          type: c.type,
          label: c.label,
          value: pf('group'),
          display: pf('group_text'),
          sort: { value: pf('ord'), text: false },
        }
      : { type: c.type, label: c.label, value: pf(c.key) },
  ]),
);

async function permissionSource(tx: Tx, t: ListTexts) {
  const rows: AdminPermissionRow[] = (await adminPermissions(tx)).map((p) => ({
    ...p,
    groupText: t(`roles.group.${p.group}`),
  }));
  const json = rows.map((p, i) => ({
    id: p.id,
    ord: i + 1,
    group: p.group,
    group_text: p.groupText,
    name: p.name,
    description: p.description,
  }));
  const source: SQL = sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb)
    as r("id" text, "ord" integer, "group" text, "group_text" text, "name" text, "description" text)`;
  const from: ListFrom = (fields) => tx.select(fields).from(source).$dynamic();
  return { rows, source, from };
}

export async function listAdminPermissionsPage(tx: Tx, query: ListQuery, t: ListTexts) {
  const { rows, source, from } = await permissionSource(tx, t);
  const byId = new Map(rows.map((p) => [p.id, p]));
  const page = await selectListPage({
    query,
    columns: adminPermissionListColumns,
    natural: [pf('ord')],
    defaultSort: ADMIN_PERMISSION_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${pf('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from,
  });
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

export async function listAdminPermissionValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  const { from } = await permissionSource(tx, t);
  return selectListValues({ columns: adminPermissionListColumns, key, scope: undefined, from, q });
}

export async function exportAdminPermissions(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  const { from } = await permissionSource(tx, t);
  return selectListExport({
    query,
    columns: adminPermissionListColumns,
    keys,
    natural: [pf('ord')],
    defaultSort: ADMIN_PERMISSION_SORT,
    scope: undefined,
    from,
  });
}

/**
 * «Право роли» (прототип permEditDlg): название и описание; в историю — по полю, как в прототипе
 * («переименовано», «изменено описание»). Без изменений — без новой версии.
 */
export async function adminSetPermission(
  tx: Tx,
  input: { id: string; name: string; description: string; version: number },
): Promise<void> {
  const [before] = await tx.select().from(permissions).where(eq(permissions.id, input.id));
  const id = `perms:${input.id}`;
  if (!before) throw new RecordNotFoundError('platform_dict', id);
  if (before.version !== input.version) {
    throw new RecordChangedError('platform_dict', id, before.version);
  }
  const changes: HistoryChange[] = [];
  if (before.name !== input.name)
    changes.push({ field: 'name', from: before.name, to: input.name });
  if (before.description !== input.description) {
    changes.push({ field: 'description', from: before.description, to: input.description });
  }
  if (!changes.length) return;
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_permission(${input.id}, ${input.name}, ${input.description}, ${input.version}) as version`,
  );
  if (row?.version == null) throw new RecordChangedError('platform_dict', id, before.version);
  await history(tx, 'perms', input.id, changes);
}

/* ---------- «Шаблоны ролей» ---------- */

export interface AdminRoleTemplateRecord {
  code: string;
  name: string;
  permissions: string[];
  scopes: Record<string, string>;
  version: number;
}

export async function adminRoleTemplates(tx: Tx): Promise<AdminRoleTemplateRecord[]> {
  return tx
    .select({
      code: roleTemplates.code,
      name: roleTemplates.name,
      permissions: roleTemplates.permissions,
      scopes: roleTemplates.scopes,
      version: roleTemplates.version,
    })
    .from(roleTemplates)
    .orderBy(asc(roleTemplates.sortOrder), asc(roleTemplates.code));
}

/** Права шаблона в порядке каталога — так их сравнивает история. */
const sortedPermissions = (list: readonly string[], order: readonly string[]) =>
  [...new Set(list)].sort((a, b) => order.indexOf(a) - order.indexOf(b));

/**
 * Шаблон роли (прототип: «Название шаблона роли», roleTplPermsDlg): название, права и область. В
 * историю — изменённые поля целиком; строки «добавлено право», «убрано право», «область» собирает
 * экран. Роли уже созданных организаций не меняются.
 */
export async function adminSetRoleTemplate(
  tx: Tx,
  input: {
    code: string;
    name: string;
    permissions: readonly string[];
    scopes: Readonly<Record<string, string>>;
    version: number;
  },
): Promise<void> {
  const [before] = await tx.select().from(roleTemplates).where(eq(roleTemplates.code, input.code));
  const id = `roletpl:${input.code}`;
  if (!before) throw new RecordNotFoundError('platform_dict', id);
  if (before.version !== input.version) {
    throw new RecordChangedError('platform_dict', id, before.version);
  }
  const order = (await adminPermissions(tx)).map((p) => p.id);
  const fromPerms = sortedPermissions(before.permissions, order);
  const toPerms = sortedPermissions(input.permissions, order);
  const scopes = { ...before.scopes, ...input.scopes };
  const changes: HistoryChange[] = [];
  if (before.name !== input.name)
    changes.push({ field: 'name', from: before.name, to: input.name });
  if (fromPerms.join() !== toPerms.join()) {
    changes.push({ field: 'permissions', from: fromPerms, to: toPerms });
  }
  if (Object.entries(scopes).some(([g, s]) => before.scopes[g] !== s)) {
    changes.push({ field: 'scopes', from: before.scopes, to: scopes });
  }
  if (!changes.length) return;
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_set_role_template(${input.code}, ${input.name},
      array(select jsonb_array_elements_text(${JSON.stringify(toPerms)}::jsonb)),
      ${JSON.stringify(scopes)}::jsonb, ${input.version}) as version`,
  );
  if (row?.version == null) throw new RecordChangedError('platform_dict', id, before.version);
  await history(tx, 'roletpl', input.code, changes);
}

/* ---------- «Шаблоны» сообщений ---------- */

export interface AdminMessageTemplateRecord {
  key: string;
  note: string;
  text: string;
  version: number;
}

/** Шаблоны в порядке вкладки (прототип: WhatsApp, потом Telegram); неизвестные — в конце. */
export async function adminMessageTemplates(tx: Tx): Promise<AdminMessageTemplateRecord[]> {
  const order: readonly string[] = MESSAGE_TEMPLATE_ORDER;
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  const rows = await tx
    .select({
      key: messageTemplateTexts.key,
      note: messageTemplateTexts.note,
      text: messageTemplateTexts.text,
      version: messageTemplateTexts.version,
    })
    .from(messageTemplateTexts);
  return rows.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/**
 * «Сохранить шаблоны» (прототип): все изменённые тексты одной транзакцией — устаревшая версия
 * любого из них отменяет всё сохранение. Отвечает числом изменённых шаблонов.
 */
export async function adminSetMessageTemplates(
  tx: Tx,
  items: readonly { key: string; text: string; version: number }[],
): Promise<number> {
  const current = new Map((await adminMessageTemplates(tx)).map((x) => [x.key, x]));
  let changed = 0;
  for (const item of items) {
    const before = current.get(item.key);
    const id = `templates:${item.key}`;
    if (!before) throw new RecordNotFoundError('platform_dict', id);
    if (before.version !== item.version) {
      throw new RecordChangedError('platform_dict', id, before.version);
    }
    if (before.text === item.text) continue;
    const [row] = await tx.execute<{ version: number | null }>(
      sql`select app.admin_set_message_template(${item.key}, ${item.text}, ${item.version}) as version`,
    );
    if (row?.version == null) throw new RecordChangedError('platform_dict', id, before.version);
    await history(tx, 'templates', item.key, [{ field: 'text', from: before.text, to: item.text }]);
    changed++;
  }
  return changed;
}

/* ---------- «История изменений» вкладок ---------- */

/**
 * Последние записи истории вкладки, сначала новые. Подпись записи — нынешнее название: статуса и
 * периодичности — из словаря, права и шаблона роли — из таблицы, шаблона сообщения — из словаря
 * Админки. Прежние названия — в самих изменениях.
 */
export async function adminSystemHistory(
  tx: Tx,
  dict: AdminSystemDict,
  limit: number,
  t: ListTexts,
): Promise<{ total: number; items: AdminDictHistoryItem[] }> {
  const where = and(
    eq(platformAuditLog.entity, 'platform_dict'),
    sql`starts_with(${platformAuditLog.entityId}, ${`${dict}:`})`,
  );
  const [rows, [counted], names] = await Promise.all([
    tx
      .select()
      .from(platformAuditLog)
      .where(where)
      .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
      .limit(limit),
    tx.select({ n: count() }).from(platformAuditLog).where(where),
    historyNames(tx, dict),
  ]);
  const labelOf = (code: string): string => {
    if (dict === 'statuses') {
      return code.startsWith('period.')
        ? t(`report.period.${code.slice('period.'.length)}`)
        : t(`status.${code}`);
    }
    if (dict === 'templates') {
      return t(messageTemplateLabelKey(code));
    }
    return names.get(code) ?? code;
  };
  return {
    total: counted?.n ?? 0,
    items: rows.map((r) => {
      const code = r.entityId.slice(dict.length + 1);
      return {
        id: String(r.id),
        at: r.at,
        actor: auditActorName(r.actorUserId, null),
        action: r.action,
        code,
        label: labelOf(code),
        changes: (r.changes ?? []) as HistoryChange[],
      };
    }),
  };
}

/** Нынешние названия прав и шаблонов ролей для подписей истории. */
async function historyNames(tx: Tx, dict: AdminSystemDict): Promise<Map<string, string>> {
  if (dict === 'perms') return new Map((await adminPermissions(tx)).map((p) => [p.id, p.name]));
  if (dict === 'roletpl') {
    return new Map((await adminRoleTemplates(tx)).map((x) => [x.code, x.name]));
  }
  return new Map();
}
