import type { ContractorRow, ContractorService } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Контрагент глазами меню: архивный, разовый, есть ли отчёты (тогда «Удалить» недоступно). */
export interface MenuContractor {
  id: string;
  archived: boolean;
  oneoff: boolean;
  hasReports: boolean;
}

/** Права сотрудника, от которых зависят пункты меню контрагента. */
export interface ContractorRights {
  createCp: boolean;
  assign: boolean;
  cpArchive: boolean;
}

export interface ContractorMenuRun {
  open: () => void;
  edit: () => void;
  responsible: () => void;
  pick: () => void;
  remove: () => void;
}

/**
 * Пункты меню «…» контрагента (прототип modules/contractors.js, `cpActions`): «Открыть карточку»; у
 * не архивного — «Изменить» (право «Создавать и изменять контрагентов»), «Сменить ответственного» и
 * «Подобрать отчёты» (у постоянного; «Назначать отчёты» или «Создавать…»), пункты платы за обслуживание
 * (`fee`, их правила — `feeMenuEntries`); после черты — пункты обслуживания (`service`, их правила —
 * `serviceMenuEntries`); после черты — «Удалить» красным (право «Отправлять в архив и удалять»),
 * бледным с причиной, если по контрагенту есть отчёты. Проекты и разовые услуги добавят их задачи.
 * `card` — кнопка «Действия» карточки: без «Открыть карточку» и «Подобрать отчёты» (в карточке это
 * вкладка).
 */
export function contractorMenuEntries({
  c,
  rights,
  t,
  run,
  service,
  fee = [],
  card = false,
}: {
  c: MenuContractor;
  rights: ContractorRights;
  t: Translate;
  run: ContractorMenuRun;
  /** Пункты обслуживания (`useServiceActions().actions`). */
  service: readonly ActionEntry[];
  /** «Принять оплату за обслуживание», «Напомнить о долге в WhatsApp» (`feeMenuEntries`). */
  fee?: readonly ActionEntry[];
  card?: boolean;
}): ActionEntry[] {
  const items: ActionEntry[] = card
    ? []
    : [{ id: 'open', label: t('cp.menu.open'), icon: 'building', run: run.open }];
  const people = rights.assign || rights.createCp;
  if (!c.archived) {
    if (rights.createCp)
      items.push({ id: 'edit', label: t('cp.menu.edit'), icon: 'edit', run: run.edit });
    if (people) {
      items.push({
        id: 'responsible',
        label: t('cp.menu.responsible'),
        icon: 'user',
        run: run.responsible,
      });
    }
    if (people && !c.oneoff && !card) {
      items.push({ id: 'pick', label: t('cp.menu.pick'), icon: 'matrix', run: run.pick });
    }
    items.push(...fee);
  }
  if (service.length) items.push({ id: 'sep-service', separator: true }, ...service);
  if (!c.archived && rights.cpArchive) {
    items.push(
      { id: 'sep-delete', separator: true },
      {
        id: 'delete',
        label: t('cp.menu.delete'),
        icon: 'trash',
        danger: true,
        run: run.remove,
        ...(c.hasReports ? { disabled: true, reason: t('cp.menu.delete_has_reports') } : {}),
      },
    );
  }
  return items;
}

/** Строка списка как контрагент меню. */
export const menuContractorOf = (r: ContractorRow): MenuContractor => ({
  id: r.id,
  archived: r.serviceStatus === 'archived',
  oneoff: r.kind === 'oneoff',
  hasReports: r.hasReports,
});

/**
 * Обслуживание строки списка для правил меню (`serviceMenuEntries`): статус, периоды и запланированное
 * — с сервера; «Историю статусов» и пропущенные месяцы окна откроют по свежему обслуживанию.
 */
export function rowService(r: ContractorRow): ContractorService {
  return {
    id: r.id,
    kind: r.kind,
    status: r.serviceStatus,
    periods: r.service.periods,
    periodsText: '',
    month: r.service.month,
    plannedPause: r.service.plannedPause,
    plannedResume: r.service.plannedResume,
    skipped: [],
    statusHistory: [],
    version: r.version,
  };
}

/**
 * Шаги шкалы обслуживания в карточке (прототип scaleFull('svc')): следующий шаг нажимается, только если
 * в меню есть его пункт — «Приостановить», «В архив», «Вернуть из архива»; шаг назад — «Откатить
 * приостановку» (без права «Откат статусов» его нет).
 */
export function serviceScaleSteps(entries: readonly ActionEntry[]): {
  next: Record<string, string>;
  back: string | null;
} {
  const has = (id: string) =>
    entries.some((e) => !('separator' in e) && e.id === id && !e.disabled);
  const next: Record<string, string> = {};
  if (has('pause')) next.paused = 'pause';
  if (has('archive')) next.archived = 'archive';
  if (has('unarchive')) next.active = 'unarchive';
  else if (has('resume')) next.active = 'resume';
  return { next, back: has('rollback') ? 'active' : null };
}
