import { getTask, taskOrgSettings } from '@buhuchet/db';
import { taskOpen } from '@buhuchet/domain';
import type { FileSource } from '../files/sources';
import { taskAccessOf } from './common';

/**
 * Файлы задачи (блок «Файлы» карточки, файл при «Выполнена»): видит тот, кто видит задачу, по правам
 * Файлового менеджера и области её контрагента; общая задача — общий файл организации. Прикрепляет и
 * удаляет исполнитель, пока задача открыта (ТЗ «исполнитель не сможет отметить задачу выполненной,
 * пока не прикрепит файл»). История — у задачи. Модуль «Задачи» выключен — файлов задачи не видно.
 */
export const taskFileSource: FileSource = {
  async resolve(tx, subject, id) {
    if (id === null) return null;
    if (!(await taskOrgSettings(tx)).tasks) return null;
    const task = await getTask(tx, id, taskAccessOf(subject));
    if (!task) return null;
    return {
      contractor: task.contractor
        ? { id: task.contractor.id, responsibleEmployeeId: task.contractor.responsibleEmployeeId }
        : null,
      editable: task.executor.id === subject.employeeId && taskOpen(task.status),
      history: () => ({
        entity: 'task',
        entityId: task.id,
        contractorId: task.contractor?.id ?? null,
      }),
    };
  },
};
