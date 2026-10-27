import type { AdminOrganization } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню организации. */
export interface OrgMenuRun {
  block: (o: AdminOrganization) => void;
  unblock: (o: AdminOrganization) => void;
}

/**
 * Пункты меню организации в Админке (прототип admin/accounts-orgs.js, renderOrgs → actions): у
 * активной — «Заблокировать» (красным, после вопроса), у заблокированной — «Разблокировать» (сразу).
 * Демо-организацию стенда не блокируют: пункт виден, но недоступен с причиной «Демо-организация
 * стенда» (в прототипе — «Демо-организация прототипа», docs/deviations.md).
 */
export function orgMenu({
  t,
  run,
}: {
  t: Translate;
  run: OrgMenuRun;
}): (o: AdminOrganization) => ActionEntry[] {
  return (o) => [
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
