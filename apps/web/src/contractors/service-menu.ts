import { monthLabelGen, serviceMenu } from '@buhuchet/domain';
import type { ContractorService } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Действия обслуживания контрагента: окна и запросы, которые открывают пункты меню. */
export type ServiceMenuAction =
  | 'toRegular'
  | 'cancelPause'
  | 'changeResume'
  | 'pause'
  | 'resume'
  | 'rollback'
  | 'archive'
  | 'unarchive';

export type ServiceMenuRun = Record<ServiceMenuAction, (service: ContractorService) => void>;

/** Права сотрудника, от которых зависят пункты обслуживания. */
export interface ServiceRights {
  createCp: boolean;
  cpPause: boolean;
  cpArchive: boolean;
  rollback: boolean;
}

/** Контрагент глазами правил меню: архивный, разовый, периоды. */
export const serviceSubject = (s: ContractorService) => ({
  archived: s.status === 'archived',
  oneOff: s.kind === 'oneoff',
  periods: s.periods,
});

/**
 * Пункты обслуживания в меню «…» контрагента (прототип modules/contractors.js, `cpActions`, группа
 * после черты): у разового — «Перевести в постоянное обслуживание» (право «Создавать и изменять
 * контрагентов»); у постоянного с правом «Приостанавливать контрагентов» — «Отменить приостановку»
 * (без права «Откат статусов» — бледным с подсказкой), «Изменить возобновление: сейчас с …»,
 * «Приостановить обслуживание» или «Возобновить обслуживание», «Откатить приостановку»; «В архив»
 * красным; у архивного — «Вернуть из архива». Какие пункты есть — правила `serviceMenu` (те же, что у
 * сервера); черту перед группой ставит меню карточки и списка.
 */
export function serviceMenuEntries({
  service,
  rights,
  t,
  run,
}: {
  service: ContractorService;
  rights: ServiceRights;
  t: Translate;
  run: ServiceMenuRun;
}): ActionEntry[] {
  const m = serviceMenu(serviceSubject(service), service.month);
  const go = (action: ServiceMenuAction) => () => run[action](service);
  const noRollback = rights.rollback ? {} : { disabled: true, reason: t('svc.need_rollback') };
  const items: ActionEntry[] = [];
  if (m.unarchive) {
    if (rights.cpArchive) {
      items.push({
        id: 'unarchive',
        label: t('svc.menu.unarchive'),
        icon: 'refresh',
        run: go('unarchive'),
      });
    }
    return items;
  }
  if (m.toRegular && rights.createCp) {
    items.push({
      id: 'toRegular',
      label: t('svc.menu.to_regular'),
      icon: 'repeat',
      run: go('toRegular'),
    });
  }
  if (rights.cpPause) {
    if (m.cancelPause && service.plannedPause) {
      items.push({
        id: 'cancelPause',
        label: t('svc.menu.cancel_pause'),
        icon: 'refresh',
        sub: t('svc.menu.cancel_pause.sub', {
          month: monthLabelGen(service.plannedPause.from),
        }),
        run: go('cancelPause'),
        ...noRollback,
      });
    }
    if (m.changeResume) {
      items.push({
        id: 'changeResume',
        label: t('svc.menu.change_resume', { month: monthLabelGen(m.changeResume) }),
        icon: 'play',
        run: go('changeResume'),
      });
    }
    if (m.pause) {
      items.push({ id: 'pause', label: t('svc.menu.pause'), icon: 'pause', run: go('pause') });
    }
    if (m.resume) {
      items.push({ id: 'resume', label: t('svc.menu.resume'), icon: 'play', run: go('resume') });
    }
    if (m.rollback) {
      items.push({
        id: 'rollback',
        label: t('svc.menu.rollback'),
        icon: 'history',
        run: go('rollback'),
        ...noRollback,
      });
    }
  }
  if (m.archive && rights.cpArchive) {
    items.push({
      id: 'archive',
      label: t('svc.menu.archive'),
      icon: 'archive',
      danger: true,
      run: go('archive'),
    });
  }
  return items;
}

/**
 * Отметка запланированного в карточке (прототип ui/status-scale.js, `svcPlanNote`): «Запланирована
 * приостановка с …, возобновление с …» или «Возобновление запланировано с …»; null — ничего.
 */
export function servicePlanNote(
  t: Translate,
  service: ContractorService,
): { kind: 'pause' | 'resume'; text: string } | null {
  const pp = service.plannedPause;
  if (pp) {
    return {
      kind: 'pause',
      text: pp.resume
        ? t('svc.plan.pause_resume', {
            month: monthLabelGen(pp.from),
            resume: monthLabelGen(pp.resume),
          })
        : t('svc.plan.pause', { month: monthLabelGen(pp.from) }),
    };
  }
  if (service.status === 'paused' && service.plannedResume) {
    return {
      kind: 'resume',
      text: t('svc.plan.resume', { month: monthLabelGen(service.plannedResume) }),
    };
  }
  return null;
}
