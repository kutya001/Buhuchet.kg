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
 * обслуживание контрагента, проекты, показатели, заявки с сайта.
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

/**
 * Предел длины шаблона по ключу (прототип v89 `tplErr`): подпись кнопки бота — до 40 знаков, скрытый
 * ответ на нажатие — до 200 (больше Telegram не покажет), остальные — `MESSAGE_TEMPLATE_MAX`.
 */
export function messageTemplateMax(key: string): number {
  if (/^tgBtn/.test(key)) return 40;
  if (/^(tgAct|tgTestOk$)/.test(key)) return 200;
  return MESSAGE_TEMPLATE_MAX;
}

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
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-14
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
  tgLinked: ['логин'],
  tgPassChanged: ['логин'],
  tgPassReset: ['логин', 'кто'],
  tgRelinked: ['логин', 'телеграм'],
  tgRelinkCode: ['логин', 'телеграм', 'код', 'минут'],
  tgRelinkAsk: ['логин', 'минут'],
  tgRelinkWrong: ['попыток'],
  tgRelinkFailed: [],
  tgRelinkLimited: [],
  tgRelinkNoSend: [],
  tgPageClosed: ['контрагент', 'неверных'],
  tgUnlinked: ['логин'],
  tgLinkInvalid: [],
  tgStart: [],
  tgLoginLocked: ['логин', 'попыток', 'кто'],
  tgLoginLockedStaff: ['логин', 'попыток'],
  tgLoginLockedOwner: ['организация', 'логин', 'попыток'],
  tgAdminCode: ['логин', 'код', 'минут'],
  tgPassResetByAdmin: ['логин'],
  tgLead: ['фирма', 'имя', 'телефон', 'клиентов', 'ссылка'],
  tgLeadRep: ['фирма', 'имя', 'телефон', 'ссылка'],
  // Основа бота (прототип v89): подписи кнопок и скрытые ответы на нажатия.
  tgBtnCopyCode: [],
  tgBtnTest: [],
  tgTest: [],
  tgTestOk: [],
  tgActOff: [],
  tgActNoRight: [],
  tgActStale: [],
  // Telegram контрагента и «К оплате» клиенту (прототип v92 и v94, поток К).
  tgCpReq: ['контрагент', 'телеграм'],
  tgBtnCpOk: [],
  tgBtnCpNo: [],
  tgCpAsk: ['контрагент'],
  tgCpOn: ['контрагент'],
  tgCpNo: ['контрагент'],
  tgCpOff: ['контрагент'],
  tgCpAlready: ['контрагент'],
  tgCpLimit: ['контрагент'],
  tgCpLinkBad: [],
  waPayMonth: ['контрагент', 'месяц', 'список', 'сумма', 'срок', 'реквизиты'],
  tgCpPay: ['месяц', 'сумма', 'срок'],
  tgBtnCpReq: [],
  tgBtnCpPaid: [],
  tgBtnCpQ: [],
  tgCpPaidOk: [],
  tgCpPaidStaff: ['контрагент', 'месяц', 'сумма', 'телеграм'],
  tgCpAskHow: [],
  tgCpAskSent: [],
  tgCpAskStaff: ['контрагент', 'телеграм', 'вопрос'],
  tgCpAnswer: ['бухгалтер', 'ответ'],
  tgCpNotLinked: [],
  tgCpDebt: ['контрагент', 'сумма'],
  tgBtnCpNoDebt: [],
  tgCpNoDebtOk: [],
  tgBtnCpReqTax: [],
  tgBtnCpReqFee: [],
  tgActNoLink: [],
  // Кнопки под отчётами и задачами, ответы и просьбы бота (прототип v97).
  tgBtnWork: [],
  tgBtnDone: [],
  tgBtnOpen: [],
  tgBtnOpenReports: [],
  tgBtnCancel: [],
  tgBtnTaskWork: [],
  tgBtnTaskDone: [],
  tgBtnTaskOpen: [],
  tgBtnConfOk: [],
  tgBtnConfBack: [],
  tgActRepWork: ['отчёт'],
  tgActRepDone: ['отчёт'],
  tgActRepWait: ['отчёт'],
  tgActRepSum: ['отчёт'],
  tgActRepPay: ['отчёт'],
  tgActRepSite: ['отчёт'],
  tgActAskWait: [],
  tgActCancelled: [],
  tgActTaskWork: [],
  tgActTaskDone: [],
  tgActTaskWait: [],
  tgActConfOk: ['отчёт'],
  tgActConfOwn: [],
  tgActConfRcpt: ['отчёт'],
  tgActFailed: [],
  tgRepAskFile: ['отчёт'],
  tgTaskAskFile: ['задача'],
  tgConfAskWhy: ['отчёт'],
  tgConfBackOk: ['отчёт'],
  tgAskNeedFile: [],
  tgAskNeedText: [],
  tgFileBig: ['мб'],
  tgFileType: [],
  tgMoreOnSite: ['n', 'ещё'],
  tgConfHead: ['n'],
  tgTaskTook: ['задача', 'исполнитель'],
  tgTaskDoneBy: ['задача', 'исполнитель'],
  tgTaskWaitBy: ['задача', 'исполнитель'],
  // Таблицы в сообщениях бота: утро, сводка недели, «Напомнить», долги (прототип v100).
  tgMornHead: ['день'],
  tgMornSub: ['просрочено', 'сегодня', 'скоро', 'оплата'],
  tgSecOver: [],
  tgSecToday: [],
  tgSecBefore: ['дней'],
  tgSecPay: [],
  tgWeekHead: ['даты'],
  tgWeekSub: ['n1', 'n2', 'n3'],
  tgSecDebt: [],
  tgBtnNudge: ['сотрудник', 'n'],
  tgBtnFeeCopy: ['контрагент'],
  tgNudge: ['кто', 'n'],
  tgActNudgeOk: ['сотрудник', 'n'],
  tgActNudgeWait: ['сотрудник', 'n'],
  tgActNudgeNoTg: ['сотрудник', 'n'],
};

/** Подстановки шаблона; у неизвестного ключа (в том числе `constructor`) — нет. */
export function messageTemplateVariables(key: string): readonly string[] {
  return Object.hasOwn(MESSAGE_TEMPLATE_VARIABLES, key) ? MESSAGE_TEMPLATE_VARIABLES[key]! : [];
}

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
  'tgLinked',
  'tgPassChanged',
  'tgPassReset',
  'tgRelinked',
  'tgRelinkCode',
  'tgRelinkAsk',
  'tgRelinkWrong',
  'tgRelinkFailed',
  'tgRelinkLimited',
  'tgRelinkNoSend',
  'tgPageClosed',
  'tgUnlinked',
  'tgLinkInvalid',
  'tgStart',
  'tgLoginLocked',
  'tgLoginLockedStaff',
  'tgLoginLockedOwner',
  'tgAdminCode',
  'tgPassResetByAdmin',
  'tgLead',
  'tgLeadRep',
  'tgBtnCopyCode',
  'tgBtnTest',
  'tgTest',
  'tgTestOk',
  'tgActOff',
  'tgActNoRight',
  'tgActStale',
  'tgCpReq',
  'tgBtnCpOk',
  'tgBtnCpNo',
  'tgCpAsk',
  'tgCpOn',
  'tgCpNo',
  'tgCpOff',
  'tgCpAlready',
  'tgCpLimit',
  'tgCpLinkBad',
  'waPayMonth',
  'tgCpPay',
  'tgBtnCpReq',
  'tgBtnCpPaid',
  'tgBtnCpQ',
  'tgCpPaidOk',
  'tgCpPaidStaff',
  'tgCpAskHow',
  'tgCpAskSent',
  'tgCpAskStaff',
  'tgCpAnswer',
  'tgCpNotLinked',
  'tgCpDebt',
  'tgBtnCpNoDebt',
  'tgCpNoDebtOk',
  'tgBtnCpReqTax',
  'tgBtnCpReqFee',
  'tgActNoLink',
  'tgBtnWork',
  'tgBtnDone',
  'tgBtnOpen',
  'tgBtnOpenReports',
  'tgBtnCancel',
  'tgBtnTaskWork',
  'tgBtnTaskDone',
  'tgBtnTaskOpen',
  'tgBtnConfOk',
  'tgBtnConfBack',
  'tgActRepWork',
  'tgActRepDone',
  'tgActRepWait',
  'tgActRepSum',
  'tgActRepPay',
  'tgActRepSite',
  'tgActAskWait',
  'tgActCancelled',
  'tgActTaskWork',
  'tgActTaskDone',
  'tgActTaskWait',
  'tgActConfOk',
  'tgActConfOwn',
  'tgActConfRcpt',
  'tgActFailed',
  'tgRepAskFile',
  'tgTaskAskFile',
  'tgConfAskWhy',
  'tgConfBackOk',
  'tgAskNeedFile',
  'tgAskNeedText',
  'tgFileBig',
  'tgFileType',
  'tgMoreOnSite',
  'tgConfHead',
  'tgTaskTook',
  'tgTaskDoneBy',
  'tgTaskWaitBy',
  'tgMornHead',
  'tgMornSub',
  'tgSecOver',
  'tgSecToday',
  'tgSecBefore',
  'tgSecPay',
  'tgWeekHead',
  'tgWeekSub',
  'tgSecDebt',
  'tgBtnNudge',
  'tgBtnFeeCopy',
  'tgNudge',
  'tgActNudgeOk',
  'tgActNudgeWait',
  'tgActNudgeNoTg',
] as const;

/** Ключ словаря подписи шаблона: `tgConfWait` → `pdicts.tpl.label.tg_conf_wait`. */
export function messageTemplateLabelKey(key: string): string {
  return `pdicts.tpl.label.${key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`;
}

const usedTemplateVariables = (text: string) =>
  [...text.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]!);

/** Подстановки в тексте, которых нет у шаблона: «{кантрагент}» — опечатка, её никто не заполнит. */
export function unknownTemplateVariables(key: string, text: string): string[] {
  const known = new Set(messageTemplateVariables(key));
  return [...new Set(usedTemplateVariables(text).filter((v) => !known.has(v)))];
}

/**
 * Подстановки, без которых шаблон не сохранить: без {код} код восстановления пароля, код входа в
 * Админку и код замены Telegram до человека не дойдут — восстановить пароль, войти в Админку и
 * привязать другой Telegram станет нельзя.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-50
export const MESSAGE_TEMPLATE_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  tgCode: ['код'],
  tgAdminCode: ['код'],
  tgRelinkCode: ['код'],
};

/** Обязательные подстановки шаблона, которых нет в тексте. */
export function missingTemplateVariables(key: string, text: string): string[] {
  if (!Object.hasOwn(MESSAGE_TEMPLATE_REQUIRED, key)) return [];
  const used = new Set(usedTemplateVariables(text));
  return MESSAGE_TEMPLATE_REQUIRED[key]!.filter((v) => !used.has(v));
}
