import { OPEN_REPORT_STATUSES } from '@buhuchet/domain';
import type { ReportRow } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню отчёта: открывают окно. */
export interface ReportMenuRun {
  due: (r: ReportRow) => void;
  revision: (r: ReportRow) => void;
}

/** Права пунктов меню: «Изменять срок отчёта» и «Менять статус сдачи». */
export interface ReportMenuAccess {
  repDue: boolean;
  changeStatus: boolean;
}

/**
 * Пункты меню отчёта (прототип modules/reports.js, `reportActions`), которые есть до сдачи и денег:
 * «Изменить срок» — у несданного отчёта со сдачей, «Создать уточнённый» — у сданного. Без права пункт
 * виден бледным с причиной. «Открыть карточку», шаги сдачи, «Не требуется», откат и «Прикрепить файл»
 * добавит задача 2.14, «Указать сумму» и деньги — 2.19.
 */
export function reportMenuEntries({
  t,
  access,
  run,
}: {
  t: Translate;
  access: ReportMenuAccess;
  run: ReportMenuRun;
}): (r: ReportRow) => ActionEntry[] {
  return (r) => {
    const items: ActionEntry[] = [];
    if (r.act !== 'pay' && OPEN_REPORT_STATUSES.has(r.status)) {
      items.push({
        id: 'due',
        label: t('report.menu.due'),
        icon: 'calendar',
        disabled: !access.repDue,
        ...(access.repDue ? {} : { reason: t('report.menu.due_no') }),
        run: () => run.due(r),
      });
    }
    if (r.act !== 'pay' && r.status === 'submitted') {
      items.push({
        id: 'revision',
        label: t('report.menu.revision'),
        icon: 'repeat',
        disabled: !access.changeStatus,
        ...(access.changeStatus ? {} : { reason: t('report.menu.no_status') }),
        run: () => run.revision(r),
      });
    }
    return items;
  };
}
