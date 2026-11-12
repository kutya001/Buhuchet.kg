import type { AdminOrganization } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню организации. */
export interface OrgMenuRun {
  /** «Открыть карточку» — первым пунктом меню строки списка; в шапке карточки его нет. */
  open?: (o: AdminOrganization) => void;
  block: (o: AdminOrganization) => void;
  unblock: (o: AdminOrganization) => void;
}

/**
 * Пункты меню организации в Админке (прототип admin/accounts-orgs.js, renderOrgs → actions): у
 * активной — «Заблокировать» (красным, после вопроса), у заблокированной — «Разблокировать» (сразу).
 * Демо-организацию стенда не блокируют: пункт виден, но недоступен с причиной «Демо-организация
 * стенда» (в прототипе — «Демо-организация прототипа», docs/deviations.md). В меню строки списка
 * первым идёт «Открыть карточку» и черта (прототип v83, renderOrgs).
 */
export function orgMenu({
  t,
  run,
}: {
  t: Translate;
  run: OrgMenuRun;
}): (o: AdminOrganization) => ActionEntry[] {
  const open = run.open;
  return (o) => [
    ...(open
      ? ([
          { id: 'card', label: t('orgs.action.card'), icon: 'building', run: () => open(o) },
          { id: 'sep-card', separator: true },
        ] satisfies ActionEntry[])
      : []),
    o.active
      ? {
          id: 'block',
          label: t('orgs.action.block'),
          icon: 'lock',
          danger: true,
          disabled: o.isDemo,
          reason: o.isDemo ? t('orgs.demo_reason') : undefined,
          run: () => run.block(o),
        }
      : {
          id: 'unblock',
          label: t('orgs.action.unblock'),
          icon: 'key',
          run: () => run.unblock(o),
        },
  ];
}

/** Кнопки шапки карточки организации: пункты меню без черт (прототип orgCard: `orgActions(o)`). */
export function orgHeadActions(entries: readonly ActionEntry[]): ActionItem[] {
  return entries.filter((a): a is ActionItem => !('separator' in a));
}
