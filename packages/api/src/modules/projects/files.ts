import { projectFileSource, projectFilesPart, projectsFeatureOn } from '@buhuchet/db';
import { hasPermission, projectWorksEditable } from '@buhuchet/domain';
import type { FileListSource } from '../files/sources';
import { canKeepProjects, projectViewerOf, projectWhere } from './common';

/**
 * Файлы проекта (блок «Файлы» карточки, прототип `filesBox(p.files, 'pj-f', mine)`): видит тот, кто
 * видит проект, по правам Файлового менеджера и области его контрагента; прикрепляет и удаляет «Вести
 * проекты» или ответственный проекта, пока контрагент не в архиве. История — у проекта. «Проекты
 * контрагентов» выключены — файлов проекта не видно.
 */
export const projectFiles: FileListSource = {
  async resolve(tx, subject, id) {
    if (id === null || !hasPermission(subject, 'projView')) return null;
    if (!(await projectsFeatureOn(tx))) return null;
    const p = await projectFileSource(tx, id, projectWhere(subject));
    if (!p) return null;
    const viewer = { ...projectViewerOf(subject), canKeep: canKeepProjects(subject) };
    return {
      contractor: { id: p.contractor.id, responsibleEmployeeId: p.contractor.responsibleEmployeeId },
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
