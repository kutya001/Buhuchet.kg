import {
  projectFileSource,
  projectFilesPart,
  projectPaymentFileSource,
  projectPaymentFilesPart,
  projectsFeatureOn,
} from '@buhuchet/db';
import { hasPermission, projectWorksEditable } from '@buhuchet/domain';
import type { FileListSource } from '../files/sources';
import {
  canKeepProjects,
  projectMoneyVisible,
  projectViewerOf,
  projectWhere,
  tranchesSeen,
} from './common';

/**
 * Файлы проекта (блок «Файлы» карточки, прототип `filesBox(p.files, 'pj-f', mine)`): видит тот, кто
 * видит проект, по правам Файлового менеджера и области его контрагента; прикрепляет и удаляет «Вести
 * проекты» или ответственный проекта, пока контрагент не в архиве. История — у проекта. «Проекты
 * контрагентов» выключены — файлов проекта не видно.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export const projectFiles: FileListSource = {
  async resolve(tx, subject, id) {
    if (id === null || !hasPermission(subject, 'projView')) return null;
    if (!(await projectsFeatureOn(tx))) return null;
    const p = await projectFileSource(tx, id, projectWhere(subject));
    if (!p) return null;
    const viewer = { ...projectViewerOf(subject), canKeep: canKeepProjects(subject) };
    return {
      contractor: {
        id: p.contractor.id,
        responsibleEmployeeId: p.contractor.responsibleEmployeeId,
      },
      editable:
        !p.contractor.archived &&
        projectWorksEditable(viewer, { members: p.members, status: 'in_progress' }),
      history: () => ({ entity: 'project', entityId: id, contractorId: p.contractor.id }),
    };
  },
  list: ({ subject, features }) =>
    features.projects && hasPermission(subject, 'projView')
      ? projectFilesPart(projectViewerOf(subject))
      : null,
};

/**
 * Файлы транша («Файлы: платёжка, чек»; прототип opWin — блок «Файлы» оплаты, allFiles — вместе с
 * файлами проекта): видит тот, кто видит транш (проект виден, деньги проектов видны), по правам Файлового
 * менеджера и области контрагента. Прикрепляет и удаляет — кому открыт «Изменить» транша (право «Вести
 * проекты», транш не удалён, контрагент не в архиве). История — у транша. В Файловом менеджере —
 * источник «название проекта», переход — карточка проекта.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-11
export const projectPaymentFiles: FileListSource = {
  async resolve(tx, subject, id) {
    if (id === null || !tranchesSeen(subject)) return null;
    const p = await projectPaymentFileSource(tx, id, projectWhere(subject));
    if (!p?.projectsOn || !projectMoneyVisible(subject, { fee: p.feeOn })) return null;
    const contractor = {
      id: p.contractor.id,
      responsibleEmployeeId: p.contractor.responsibleEmployeeId,
    };
    return {
      contractor,
      editable: !p.deleted && canKeepProjects(subject) && !p.contractor.archived,
      history: () => ({ entity: 'project_payment', entityId: id, contractorId: contractor.id }),
    };
  },
  list: ({ subject, features }) =>
    features.projects && tranchesSeen(subject) && projectMoneyVisible(subject, features)
      ? projectPaymentFilesPart(projectViewerOf(subject))
      : null,
};
