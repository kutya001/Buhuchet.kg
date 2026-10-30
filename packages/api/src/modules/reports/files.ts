import { reportFileTarget } from '@buhuchet/db';
import { hasPermission } from '@buhuchet/domain';
import type { FileSource } from '../files/sources';
import { reportScopeOf } from './common';

/**
 * Файлы отчёта (блок «Файлы» карточки, файл при «Сдан» и квитанция при «Подтвердить»; прототип
 * fileDlg, submitDlg, repConfDlg): видит тот, кто видит отчёт (право «Просматривать отчёты» и область
 * «Свои»), по правам Файлового менеджера и области контрагента отчёта. Прикрепить и удалить может
 * любой с правами Файлового менеджера, как в прототипе (`reportActions`: «Прикрепить файл» — только
 * «Загружать файлы»); у контрагента в архиве — только просмотр. История — у отчёта.
 */
export const reportFileSource: FileSource = {
  async resolve(tx, subject, id) {
    if (id === null || !hasPermission(subject, 'repView')) return null;
    const report = await reportFileTarget(tx, id, reportScopeOf(subject));
    if (!report) return null;
    const { contractor } = report;
    return {
      contractor: { id: contractor.id, responsibleEmployeeId: contractor.responsibleEmployeeId },
      editable: !contractor.archived,
      history: () => ({ entity: 'report', entityId: report.id, contractorId: contractor.id }),
    };
  },
};
