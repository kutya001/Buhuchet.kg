import {
  oneOffServiceFileSource,
  operationFileSource,
  operationMonthClosed,
  serviceFilesPart,
} from '@buhuchet/db';
import { canSeeContractor, hasPermission, opLock, opRight } from '@buhuchet/domain';
import type { FileListSource } from '../files/sources';
import { finScopeOf } from '../money/common';
import { canArchiveRest } from './common';
import { canKeepServices, serviceReadScope, servicesVisible } from './services';

/**
 * Файлы списания, возврата, перевода, обратной записи и возврата по уточнённому (задача 2.22; ТЗ
 * «Финансовые операции по контрагентам» → «Окно оплаты»: в окне — файлы, «Изменить» меняет и файлы;
 * прототип opWin — блок «Файлы» у всех операций, opEditDlg — «Добавить файлы»). Видны тому, кто видит
 * окно операции: «Учёт денег» или «Просматривать финансовые операции», контрагент в области группы
 * «Финансовые операции», «Учёт оплаты налогов» включён. Прикреплять и удалять — когда «Изменить» у
 * операции открыт (прототип: `filesBox(…, !v.del && !eL)`): не удалена, контрагент не в архиве, месяц не
 * закрыт, есть право этого вида операции. История — у операции. В «Файловом менеджере» их нет — как в
 * прототипе (allFiles: только поступления и оплаты налогов).
 */
export const operationFiles: FileListSource = {
  async resolve(tx, subject, id) {
    if (id === null || (!hasPermission(subject, 'money') && !hasPermission(subject, 'finView')))
      return null;
    const row = await operationFileSource(tx, id, finScopeOf(subject));
    if (!row?.taxpay || !canSeeContractor(subject, 'fin', row.contractor)) return null;
    const contractor = {
      id: row.contractor.id,
      responsibleEmployeeId: row.contractor.responsibleEmployeeId,
    };
    // Замок «Изменить» — тот же, что в окне операции (`operationLock`).
    const lock = opLock(
      {
        kind: row.kind,
        deleted: row.cancelled,
        canKind: hasPermission(subject, opRight(row.kind)),
        canArchiveRest: canArchiveRest(subject),
        canMoney: hasPermission(subject, 'money'),
        archived: row.contractor.archived,
        monthClosed: await operationMonthClosed(tx, row),
        receiptPart: false,
      },
      'edit',
    );
    return {
      contractor,
      editable: lock === null,
      history: () => ({ entity: 'money_operation', entityId: id, contractorId: contractor.id }),
    };
  },
  list: () => null,
};

/**
 * Файлы разовой услуги («Файлы: акт, договор, чек») и её оплат («Файлы: платёжка, чек») (задача 2.22;
 * прототип serviceCard — `filesBox(…, can('projects') && !s.del)`, opWin — блок «Файлы» оплаты, allFiles —
 * вид «Разовая услуга»). Видны тому, кто видит услугу (`servicesVisible`, контрагент в
 * `serviceReadScope`), при включённых «Финансовых операциях». Прикреплять и удалять у услуги — с правом
 * «Вести проекты и разовые услуги» в области группы «Проекты контрагентов», пока услуга не удалена; у
 * оплаты — когда открыт её «Изменить». История — у услуги или у оплаты. В Файловом менеджере файлы
 * оплат — вместе с файлами услуги: источник — название услуги, переход — карточка услуги.
 */
function serviceFiles(kind: 'one_off_service' | 'one_off_service_payment'): FileListSource {
  return {
    async resolve(tx, subject, id) {
      if (id === null) return null;
      const row = await oneOffServiceFileSource(tx, kind, id, serviceReadScope(subject));
      if (!row?.finops) return null;
      if (!servicesVisible(subject, { fee: row.feeOn })) return null;
      const contractor = {
        id: row.contractor.id,
        responsibleEmployeeId: row.contractor.responsibleEmployeeId,
      };
      const can = canKeepServices(subject, row.contractor);
      const editable =
        kind === 'one_off_service'
          ? can && !row.deleted
          : !row.deleted && can && !row.contractor.archived;
      return {
        contractor,
        editable,
        history: () => ({ entity: kind, entityId: id, contractorId: contractor.id }),
      };
    },
    list: ({ subject, features }) =>
      features.finops && servicesVisible(subject, features)
        ? serviceFilesPart(kind, serviceReadScope(subject))
        : null,
  };
}

export const serviceFileSources = {
  one_off_service: serviceFiles('one_off_service'),
  one_off_service_payment: serviceFiles('one_off_service_payment'),
} as const;
