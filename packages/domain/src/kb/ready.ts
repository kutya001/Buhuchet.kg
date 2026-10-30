import type { HistoryAction, HistoryEntity, HistoryValue } from '../common/history';
import type { StatusScaleKey } from '../common/status';
import type { MenuModuleId } from '../org/modules';
import type { PermissionId } from '../roles/permissions';

/*
 * Какие шаги «Базы знаний» уже работают (задача 2.30, правило стыков docs/decisions.md п. Г-2): шаг
 * виден, только когда его модуль сделан — есть экран, куда ведёт «Перейти», и событие, которое его
 * отмечает. Задача модуля, слитая позже, добавляет сюда свои шаги (одна строка на шаг, по порядку
 * групп ТЗ), а «Перейти» — в `apps/web/src/kb/kb-go.ts`.
 */

/**
 * Чем отмечается шаг «Сделать» (прототип modules/kb-lessons.js, `KB_EV` и `done`): записью истории
 * изменений под именем самого пользователя (ТЗ «Шаг засчитывается только тому пользователю, который
 * сам сделал действие») или состоянием его данных. Запись ищется в `audit_log`: сущность, действие и —
 * если задано — хотя бы одно из полей или поле с нужным новым значением.
 */
export type KbDoneRule =
  | {
      kind: 'history';
      entity: HistoryEntity;
      actions: readonly HistoryAction[];
      /** Изменено хотя бы одно из полей. */
      anyField?: readonly string[];
      /** Поле получило это значение. */
      change?: { field: string; to: HistoryValue };
    }
  /**
   * Смена статуса записи самим пользователем («История статусов», `status_history`; откат не
   * считается): шкала, из каких статусов и в какие. Действия с задачей пишутся только туда.
   */
  | { kind: 'status'; scale: StatusScaleKey; from: readonly string[]; to: readonly string[] }
  /** Привязан свой Telegram (`telegram_links`). */
  | { kind: 'telegram' }
  /** Администратор платформы сам создал организацию (`organizations.created_by`). */
  | { kind: 'org_created' };

export interface KbStepRule {
  /**
   * Модуль шага: шаг виден, только если модуль в меню пользователя (ТЗ «Шаг «Посмотреть» показывается,
   * если есть право хотя бы смотреть этот модуль»); статья модуля — статья шага. null — шаг без модуля
   * (Telegram, тема, поиск). У шагов Админки — модуль Админки.
   */
  module: MenuModuleId | null;
  /** Шаг «Сделать» с событием; «Посмотреть» и «первое использование» отмечаются без него. */
  done?: KbDoneRule;
  /**
   * Засчитывается и сохранением без изменений (ТЗ: «при сохранении профиля», «сохранены
   * «Настройки»»): истории тогда нет, и экран сам сообщает о сохранении первым использованием с кодом
   * шага (`POST /api/kb/hits/<шаг>`). Шаг виден только тому, кто может сохранить экран.
   */
  savedUnchanged?: boolean;
  /**
   * Право шага, если его нет в справочнике шагов (`perm`): шаг «Сделать» без права не показывается
   * (ТЗ «Главное правило»).
   */
  permission?: PermissionId;
}

const orgSettings = (...anyField: string[]): KbDoneRule => ({
  kind: 'history',
  entity: 'org_settings',
  actions: ['update'],
  anyField,
});

/** Работающие шаги программы организации по порядку групп ТЗ. */
export const KB_STEP_RULES: Readonly<Record<string, KbStepRule>> = {
  // 1. Моя организация.
  profile: {
    module: 'org',
    done: { kind: 'history', entity: 'organization', actions: ['update'] },
    savedUnchanged: true,
  },
  // Реквизиты для приёма денег (задача 2.18): «добавлен счёт организации».
  accs: { module: 'org', done: { kind: 'history', entity: 'org_account', actions: ['create'] } },
  // ТЗ: «засчитывается при завершении опросника или изменении хотя бы одной функции» (2.33).
  policy: { module: 'org', done: orgSettings('features', 'quiz') },
  // ТЗ: «добавлен или убран день напоминания в учётной политике».
  remind: { module: 'org', done: orgSettings('remindDays') },
  settings: {
    module: 'org',
    done: orgSettings('timezone', 'digestTime', 'overdueRepeat', 'defaultRoleId'),
    savedUnchanged: true,
  },
  // «Хранилище файлов» на вкладке «Настройки» (задача 2.29).
  storage: { module: 'org' },
  // 2. Мой профиль. «Режим и виды уведомлений» — с задачей 2.24; «Тема оформления» — с 2.31: шаг
  // «Посмотреть» без экрана и статьи засчитывается только показом «Показать как».
  tg: { module: null, done: { kind: 'telegram' } },
  // 3. Справочники.
  types: {
    module: 'dicts',
    done: {
      kind: 'history',
      entity: 'org_report_type',
      actions: ['create', 'update'],
      change: { field: 'enabled', to: true },
    },
  },
  typecfg: {
    module: 'dicts',
    done: {
      kind: 'history',
      entity: 'org_report_type',
      actions: ['update'],
      anyField: ['remindDays', 'needFile', 'needReceipt'],
    },
  },
  pdicts: { module: 'dicts' },
  // 4. Сотрудники и роли.
  roles: { module: 'staff' },
  emps: { module: 'staff', done: { kind: 'history', entity: 'employee', actions: ['create'] } },
  empcard: { module: 'staff' },
  // 9. Задачи (задача 2.23). «Регулярные задачи по отчётам» — с задачей 2.24. «Выполнена» или «Не
  // выполнена» — и отправленная на подтверждение (прототип `KB_EV['t.done']`); «Подтвердить» или «На
  // доработку» (`KB_EV['t.conf']`).
  mtask: { module: 'tasks', done: { kind: 'history', entity: 'task', actions: ['create'] } },
  daymonth: { module: 'tasks' },
  tdone: {
    module: 'tasks',
    done: {
      kind: 'status',
      scale: 'task',
      from: ['todo', 'in_progress', 'rework'],
      to: ['on_confirm', 'done', 'failed'],
    },
  },
  tconf: {
    module: 'tasks',
    done: { kind: 'status', scale: 'task', from: ['on_confirm'], to: ['confirmed', 'rework'] },
  },
  // 11. Показатели контрагентов (задачи 2.27, 2.28). «Вкладка «Показатели» в карточке контрагента» — с
  // карточкой контрагента (2.11).
  kset: {
    module: 'kpi',
    done: { kind: 'history', entity: 'indicator', actions: ['create', 'update', 'delete'] },
  },
  // ТЗ: «изменено, каким контрагентам вести показатель» — «Ведётся» → «Не ведётся» и обратно.
  kwho: {
    module: 'kpi',
    done: { kind: 'history', entity: 'indicator', actions: ['update'], anyField: ['enabled'] },
  },
  kval: {
    module: 'kpi',
    done: { kind: 'history', entity: 'indicator_value', actions: ['create', 'update'] },
  },
  // Прототип: запись истории «Ввод показателей из Excel …» после «Применить».
  kxls: {
    module: 'kpi',
    done: { kind: 'history', entity: 'indicator_import', actions: ['create'] },
  },
  kper: { module: 'kpi' },
  kchk: {
    module: 'kpi',
    done: { kind: 'status', scale: 'indicator', from: ['filled'], to: ['checked'] },
  },
  // 12. Файловый менеджер (задача 2.29): «Загрузить файл вручную» — запись истории ручной загрузки
  // (сущность «файл»: файлы записей пишутся в историю своей записи); шаг — только с правом «Загружать
  // файлы» (ТЗ «Главное правило»; в справочнике шагов права нет).
  // ОТКЛОНЕНИЕ: docs/deviations.md#Г-8
  upload: {
    module: 'files',
    permission: 'filesUpload',
    done: { kind: 'history', entity: 'file', actions: ['file_attach'] },
  },
  ffind: { module: 'files' },
  // 14. Работа со списками и интерфейсом: пока нет «Контрагентов», «Перейти» ведёт в список «Видов
  // отчётов» — он виден всем. «Статистика» — с первым экраном организации с плашками (2.13).
  search: { module: null },
  cols: { module: 'dicts' },
  grp: { module: 'dicts' },
  xls: { module: 'dicts' },
  swipe: { module: 'dicts' },
  // Админка (задачи 2.35, 2.36, 2.40). «Каталог видов отчётов», шаблоны и загрузка из Excel — с их
  // вкладками (2.36, 2.37).
  'a-dicts': { module: 'pdicts' },
  'a-cal': { module: 'pdicts' },
  'a-l10n': { module: 'l10n' },
  'a-org': { module: 'orgs', done: { kind: 'org_created' } },
};

/**
 * Модули, у которых уже есть экраны: статьи остальных модулей скрыты, как и их шаги (их описания
 * экранов пока не совпадают с продуктом). Модуль, слитый позже, добавляет себя сюда.
 */
export const KB_READY_MODULES: ReadonlySet<string> = new Set<MenuModuleId>([
  'staff',
  'dicts',
  'org',
  'tasks',
  // «Показатели контрагентов» (2.27).
  'kpi',
  // «Файловый менеджер» (2.29).
  'files',
  'kb',
  // Админка: «Учётные записи» (2.35), «Организации», «Локализация» (2.40). Статья «Справочников
  // платформы» описывает и загрузку из Excel — модуль добавит задача 2.37.
  'accounts',
  'orgs',
  'l10n',
]);
