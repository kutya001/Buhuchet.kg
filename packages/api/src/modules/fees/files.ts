import { feePaymentFileSource } from '@buhuchet/db';
import { canSeeContractor, hasPermission } from '@buhuchet/domain';
import type { FileListSource } from '../files/sources';
import { scopeSqlOf } from '../contractors/common';

/**
 * Файлы оплаты за обслуживание (задача 2.21; ТЗ «Принять оплату за обслуживание»: файл — скрин перевода,
 * квитанция): видны при включённой «Плате за обслуживание» с правом «Видеть плату за обслуживание» по
 * контрагентам области группы «Контрагенты» (ТЗ «Файловый менеджер»: файлы по плате — только с этим
 * правом); прикреплять и удалять — с правом «Менять журнал тарифов», пока контрагент не в архиве.
 * История — у оплаты. В «Файловом менеджере» и во вкладке «Файлы» их нет — как в прототипе (allFiles
 * без FEEPAYS): они открываются из оплаты.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-18
export const feePaymentFiles: FileListSource = {
  async resolve(tx, subject, id) {
    if (id === null || !hasPermission(subject, 'fee')) return null;
    const row = await feePaymentFileSource(tx, id, scopeSqlOf(subject));
    if (!row?.feeOn || !canSeeContractor(subject, 'cps', row.contractor)) return null;
    const contractor = {
      id: row.contractor.id,
      responsibleEmployeeId: row.contractor.responsibleEmployeeId,
    };
    return {
      contractor,
      editable: !row.contractor.archived && hasPermission(subject, 'tariff'),
      history: () => ({ entity: 'fee_payment', entityId: id, contractorId: contractor.id }),
    };
  },
  list: () => null,
};
