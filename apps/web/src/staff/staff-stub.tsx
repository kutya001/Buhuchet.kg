'use client';

import { useNewRole } from '../roles/new-role';
import { ModuleStub } from '../shell/module-stub';
import { useStaffActions } from './staff-actions';
import { useStaffAddRequest } from './staff-add';

/**
 * Вкладка модуля «Сотрудники» без экрана («Списания в бонус» — с модулем «Финансы»): заглушка, но
 * «+ Добавить» → «Сотрудник» и «Роль» работают, как на остальных вкладках модуля.
 */
export function StaffStub() {
  const staff = useStaffActions();
  const newRole = useNewRole();
  useStaffAddRequest({ employee: staff.newEmployee, role: newRole.open });
  return (
    <>
      <ModuleStub moduleId="staff" handleAdd={false} />
      {staff.dialogs}
      {newRole.dialog}
    </>
  );
}
