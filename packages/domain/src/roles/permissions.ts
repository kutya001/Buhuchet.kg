/**
 * Каталог прав. Набор прав и их группы задаёт система (ТЗ «Сотрудники» → «Вкладка Роли»), названия и
 * описания — справочник платформы «Права ролей» (таблица permissions, наполняется из refDB.json).
 * Порядок — как в форме роли и в refDB.permissions; тест сверяет каталог с refDB.json.
 */

/** Функции учётной политики, без которых модуль выключен. */
export const FEATURES = [
  'tasks',
  'calendar',
  'fee',
  'taxpay',
  'accounts',
  'telegram',
  'files',
  'finops',
  'projects',
  'indicators',
  'cppage',
] as const;
export type Feature = (typeof FEATURES)[number];

/**
 * Группы прав в порядке меню модулей, последней — «Общие права» (прототип core/org.js, PERM_GROUPS).
 * view — право «Просматривать …»: без него модуль скрыт, остальные права группы не действуют;
 * scope — у группы есть область «Свои контрагенты / Все контрагенты».
 */
export const PERMISSION_GROUPS = [
  { id: 'cps', feature: null, view: 'cpView', scope: true },
  { id: 'reports', feature: null, view: 'repView', scope: true },
  { id: 'fin', feature: 'finops', view: 'finView', scope: true },
  { id: 'projects', feature: 'projects', view: 'projView', scope: true },
  { id: 'kpi', feature: 'indicators', view: 'kpiView', scope: true },
  { id: 'tasks', feature: 'tasks', view: null, scope: false },
  { id: 'files', feature: 'files', view: 'filesView', scope: true },
  { id: 'staff', feature: null, view: 'staffView', scope: false },
  { id: 'dicts', feature: null, view: null, scope: false },
  { id: 'kb', feature: null, view: null, scope: false },
  { id: 'org', feature: null, view: null, scope: false },
  { id: 'common', feature: null, view: null, scope: false },
] as const satisfies readonly {
  id: string;
  feature: Feature | null;
  view: string | null;
  scope: boolean;
}[];

export type PermissionGroupId = (typeof PERMISSION_GROUPS)[number]['id'];

/** Группы с областью «Свои / Все контрагенты». */
export type ScopeGroupId = Extract<(typeof PERMISSION_GROUPS)[number], { scope: true }>['id'];
export const SCOPE_GROUPS = PERMISSION_GROUPS.filter((g) => g.scope).map(
  (g) => g.id,
) as ScopeGroupId[];

/** «Свои контрагенты» — только те, где сотрудник ответственный; «Все контрагенты» — все в организации. */
export const SCOPES = ['own', 'all'] as const;
export type Scope = (typeof SCOPES)[number];

/** 39 прав: [код, группа]. */
export const PERMISSIONS = [
  ['cpView', 'cps'],
  ['createCp', 'cps'],
  ['cpImport', 'cps'],
  ['cpPause', 'cps'],
  ['cpArchive', 'cps'],
  ['fee', 'cps'],
  ['tariff', 'cps'],
  ['cpPage', 'cps'],
  ['archiveRest', 'cps'],
  ['repView', 'reports'],
  ['assign', 'reports'],
  ['repDue', 'reports'],
  ['changeStatus', 'reports'],
  ['changeSum', 'reports'],
  ['repConfirm', 'reports'],
  ['finView', 'fin'],
  ['money', 'fin'],
  ['bonus', 'fin'],
  ['projView', 'projects'],
  ['projects', 'projects'],
  ['kpiView', 'kpi'],
  ['kpiEdit', 'kpi'],
  ['kpiImport', 'kpi'],
  ['indSetup', 'kpi'],
  ['indCheck', 'kpi'],
  ['tasksCreate', 'tasks'],
  ['tasksAll', 'tasks'],
  ['tasksConfirm', 'tasks'],
  ['filesView', 'files'],
  ['filesUpload', 'files'],
  ['filesDelete', 'files'],
  ['staffView', 'staff'],
  ['staff', 'staff'],
  ['dicts', 'dicts'],
  ['kbLevels', 'kb'],
  ['org', 'org'],
  ['viewAll', 'common'],
  ['export', 'common'],
  ['rollback', 'common'],
] as const satisfies readonly (readonly [string, PermissionGroupId])[];

export type PermissionId = (typeof PERMISSIONS)[number][0];

export const PERMISSION_IDS: readonly PermissionId[] = PERMISSIONS.map(([id]) => id);

const GROUP_OF = new Map<string, PermissionGroupId>(PERMISSIONS.map(([id, group]) => [id, group]));
const VIEW_OF = new Map<PermissionGroupId, PermissionId | null>(
  PERMISSION_GROUPS.map((g) => [g.id, g.view]),
);

export function isPermissionId(value: string): value is PermissionId {
  return GROUP_OF.has(value);
}

export function permissionGroup(permission: PermissionId): PermissionGroupId {
  return GROUP_OF.get(permission)!;
}

/** Право «Просматривать …» группы права; null — у группы нет права просмотра. */
export function viewPermissionOf(permission: PermissionId): PermissionId | null {
  return VIEW_OF.get(permissionGroup(permission)) ?? null;
}

/** Есть только у владельца организации, ролям не выдаётся. */
export const OWNER_ONLY_PERMISSIONS: readonly PermissionId[] = ['org'];

/** Выдаёт ролям только владелец. */
export const OWNER_GRANTED_PERMISSIONS: readonly PermissionId[] = [
  'rollback',
  'archiveRest',
  'staff',
];
