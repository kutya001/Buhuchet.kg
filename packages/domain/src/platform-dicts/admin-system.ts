import type { ListColumnType, ListSort } from '../common/list';
import {
  STATUS_SCALE_DEFS,
  STATUS_SCALES,
  STATUS_TONES,
  scaleStatuses,
  statusLook,
  type StatusScaleKey,
  type StatusTone,
} from '../common/status';
import { rolePermissionLock } from '../roles/editing';
import {
  isPermissionId,
  OWNER_ONLY_PERMISSIONS,
  PERMISSION_IDS,
  SCOPE_GROUPS,
  SCOPES,
  type PermissionId,
} from '../roles/permissions';

/*
 * Админка → «Справочники платформы», вкладки группы «Работа системы» (задача 2.36, часть 3; ТЗ «Админка»
 * → «Справочники платформы» → «Справочники, на которых держится логика системы» и «Шаблоны для
 * организаций»; прототип admin/platform-dicts.js renderPDicts, permEditDlg, roleTplPermsDlg): «Статусы»
 * (названия и цвета, периодичность отчётов), «Права ролей» (название и описание), «Шаблоны ролей»
 * (название, права и область) и «Шаблоны» сообщений. Состав статусов, периодов, прав и шаблонов задаёт
 * система — администратор меняет только тексты, цвета и права шаблона.
 */

/** Вкладки части 3 — у каждой свои методы API и своя «История изменений». */
export const ADMIN_SYSTEM_DICTS = ['statuses', 'perms', 'roletpl', 'templates'] as const;
export type AdminSystemDict = (typeof ADMIN_SYSTEM_DICTS)[number];

export function isAdminSystemDict(value: string): value is AdminSystemDict {
  return (ADMIN_SYSTEM_DICTS as readonly string[]).includes(value);
}

/* ---------- «Статусы» ---------- */

/**
 * Шкалы во вкладке «Статусы» — все шкалы системы, по порядку ТЗ: сдача отчётов, оплата, задачи,
 * обслуживание контрагента, проекты, показатели.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-12
export const ADMIN_STATUS_SCALES: readonly StatusScaleKey[] = STATUS_SCALES;

/** Место статуса на шкале (прототип: метка «Этап N», «отметка» или «боковой»). */
export type StatusPlace = { kind: 'step'; n: number } | { kind: 'mark' } | { kind: 'side' };

/**
 * Место статуса: номер этапа на шкале (у задачи — и на шкале с подтверждением); отметка на шаге
 * «Сдан»; иначе — боковой статус, не шаг шкалы (прототип STATUS_GROUPS, `SCALES[sk].steps`).
 */
export function statusPlace(scale: StatusScaleKey, code: string): StatusPlace {
  const def = STATUS_SCALE_DEFS[scale];
  const steps = def.steps.includes(code) ? def.steps : (def.stepsConfirm ?? []);
  const i = steps.indexOf(code);
  if (i >= 0) return { kind: 'step', n: i + 1 };
  if (def.marks?.includes(code)) return { kind: 'mark' };
  return { kind: 'side' };
}

/**
 * Ключ цвета статуса в словаре экранов: цвета из Админки приходят вместе с текстами (`/api/l10n`),
 * поэтому шкалы и метки всех экранов видят их без отдельного запроса.
 */
export function statusToneKey(scale: StatusScaleKey, code: string): string {
  return `tone.${scale}.${code}`;
}

export function isStatusTone(value: string | undefined): value is StatusTone {
  return value !== undefined && (STATUS_TONES as readonly string[]).includes(value);
}

/** Цвет статуса: из словаря, если там цвет из набора, иначе — цвет по умолчанию шкалы. */
export function statusToneOf(
  texts: Readonly<Record<string, string>>,
  scale: StatusScaleKey,
  code: string,
): StatusTone {
  const value = texts[statusToneKey(scale, code)];
  return isStatusTone(value) ? value : statusLook(scale, code).tone;
}

/** Все статусы всех шкал с цветом по умолчанию — строки таблицы цветов при наполнении. */
export function defaultStatusTones(): {
  scale: StatusScaleKey;
  status: string;
  tone: StatusTone;
}[] {
  return STATUS_SCALES.flatMap((scale) =>
    scaleStatuses(scale).map((status) => ({ scale, status, tone: statusLook(scale, status).tone })),
  );
}

/** Периодичность отчётов (прототип PER_LABEL): коды словаря `report.period.<код>` и периодов в году. */
export const PERIOD_ROWS = [
  { code: 'm', perYear: 12 },
  { code: 'q', perYear: 4 },
  { code: 'h', perYear: 2 },
  { code: 'y', perYear: 1 },
] as const;
export type PeriodRowCode = (typeof PERIOD_ROWS)[number]['code'];

export function isPeriodRowCode(value: string): value is PeriodRowCode {
  return PERIOD_ROWS.some((p) => p.code === value);
}

/** Название статуса, периодичности, права или шаблона роли — не длиннее. */
export const SYSTEM_NAME_MAX = 100;
/** Описание права — не длиннее. */
export const PERMISSION_DESCRIPTION_MAX = 500;
/** Текст шаблона сообщения — не длиннее (длинное сообщение Telegram режет на части). */
export const MESSAGE_TEMPLATE_MAX = 2000;

/** Сравнение названий без регистра и лишних пробелов («Такое название уже есть»). */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  return norm(a) === norm(b);
}

/* ---------- «Права ролей» ---------- */

/** Столбец списка «Права ролей»: ключ, тип, подпись (ключ словаря) и скрыт ли по умолчанию. */
export interface AdminPermissionColumn {
  key: 'group' | 'name' | 'description' | 'id';
  type: ListColumnType;
  label: string;
  hidden?: boolean;
}

/** Столбцы — как в прототипе (`adm-perms`): «Группа», «Право», «Описание» и скрытый «Код». */
export const ADMIN_PERMISSION_COLUMNS: readonly AdminPermissionColumn[] = [
  { key: 'group', type: 'enum', label: 'pdicts.perm.col.group' },
  { key: 'name', type: 'text', label: 'pdicts.perm.col.name' },
  { key: 'description', type: 'text', label: 'pdicts.perm.col.description' },
  { key: 'id', type: 'text', label: 'pdicts.perm.col.code', hidden: true },
];

/** По умолчанию — по группе, внутри группы — в порядке формы роли (прототип `sortVal`). */
export const ADMIN_PERMISSION_SORT: ListSort = { key: 'group', dir: 'asc' };

/* ---------- «Шаблоны ролей» ---------- */

/**
 * Почему галочку права в окне «Права шаблона роли» не поставить (прототип roleTplPermsDlg, `o.lock`):
 * право есть только у владельца организации; права группы — только вместе с её просмотром.
 */
export function templatePermissionLock(
  permission: PermissionId,
  selected: ReadonlySet<PermissionId>,
): 'owner_only' | 'view_required' | null {
  if (OWNER_ONLY_PERMISSIONS.includes(permission)) return 'owner_only';
  const lock = rolePermissionLock(
    { isOwner: true, roleId: '' },
    { id: 'template', isOwner: false },
    permission,
    selected,
  );
  return lock === 'view_required' ? lock : null;
}

/** Что не так с правами шаблона роли. */
export type RoleTemplateProblem =
  | { problem: 'unknown_permission'; permission: string }
  | { problem: 'owner_only'; permission: PermissionId }
  | { problem: 'view_required'; permission: PermissionId }
  | { problem: 'bad_scope'; group: string };

/**
 * Права и область шаблона роли (прототип roleTplPermsDlg): только права каталога, без прав «только у
 * владельца», у права группы — и право просмотра группы («Сначала дайте просмотр»); область —
 * «Свои» или «Все» по группам с областью. Первая найденная причина; null — всё верно.
 */
export function roleTemplateProblem(
  permissions: readonly string[],
  scopes: Readonly<Record<string, string>>,
): RoleTemplateProblem | null {
  const unknown = permissions.find((p) => !isPermissionId(p));
  if (unknown !== undefined) return { problem: 'unknown_permission', permission: unknown };
  const selected = new Set(permissions as PermissionId[]);
  for (const p of PERMISSION_IDS) {
    const lock = selected.has(p) ? templatePermissionLock(p, selected) : null;
    if (lock === 'owner_only') return { problem: 'owner_only', permission: p };
    if (lock === 'view_required') return { problem: 'view_required', permission: p };
  }
  const groups = new Set<string>(SCOPE_GROUPS);
  const values = new Set<string>(SCOPES);
  for (const [group, scope] of Object.entries(scopes)) {
    if (!groups.has(group) || !values.has(scope)) return { problem: 'bad_scope', group };
  }
  return null;
}

/** Права, которые можно дать шаблону роли (без прав «только у владельца»): «N из M прав». */
export const TEMPLATE_PERMISSION_COUNT = PERMISSION_IDS.length - OWNER_ONLY_PERMISSIONS.length;

/* ---------- «Шаблоны» сообщений ---------- */

/**
 * Подстановки шаблонов сообщений (прототип TPL_VARS): под каждым шаблоном — какие в нём доступны.
 * Набор шаблонов задаёт система; у неизвестного шаблона подстановок нет.
 */
export const MESSAGE_TEMPLATE_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  waTax: ['контрагент', 'отчёт', 'период', 'срок', 'сумма', 'дата', 'реквизиты'],
  waFee: ['контрагент', 'месяц', 'сумма', 'дата', 'реквизиты'],
  waPage: ['контрагент', 'ссылка', 'код'],
  tgConfWait: ['дней', 'список'],
  tgFix: ['отчёт', 'причина', 'автор'],
  tgBefore: ['дней', 'список'],
  tgToday: ['список'],
  tgOver: ['список'],
  tgPay: ['дней', 'список'],
  tgWeek: ['даты', 'n1', 'n2', 'n3'],
  tgCode: ['код'],
  tgTask: ['автор', 'задача', 'срок'],
};

/**
 * Порядок шаблонов во вкладке (прототип: WhatsApp, потом Telegram); в справочнике организации —
 * свой порядок (`templateNotes`). Шаблон без места здесь — в конце.
 */
export const MESSAGE_TEMPLATE_ORDER = [
  'waTax',
  'waFee',
  'waPage',
  'tgBefore',
  'tgToday',
  'tgOver',
  'tgPay',
  'tgConfWait',
  'tgFix',
  'tgWeek',
  'tgCode',
  'tgTask',
] as const;

/** Ключ словаря подписи шаблона: `tgConfWait` → `pdicts.tpl.label.tg_conf_wait`. */
export function messageTemplateLabelKey(key: string): string {
  return `pdicts.tpl.label.${key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`;
}

/** Подстановки в тексте, которых нет у шаблона: «{кантрагент}» — опечатка, её никто не заполнит. */
export function unknownTemplateVariables(key: string, text: string): string[] {
  const known = new Set(MESSAGE_TEMPLATE_VARIABLES[key] ?? []);
  const used = [...text.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]!);
  return [...new Set(used.filter((v) => !known.has(v)))];
}
