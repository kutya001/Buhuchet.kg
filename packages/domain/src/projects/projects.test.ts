import { describe, expect, it } from 'vitest';
import {
  projectActive,
  projectCancelable,
  projectFormDefaults,
  projectLeft,
  projectMemberToggle,
  projectOfferedForTask,
  projectOverdue,
  projectPercent,
  projectProblems,
  projectVisible,
  projectWorkExecutor,
  projectWorkOverdue,
  projectWorksClean,
  projectWorksEditable,
  type ProjectFields,
} from './projects';

// Проекты контрагентов — как в прототипе (modules/projects.js `projVisible`, `projActive`, `workOver`,
// `openProject`, `projectDlg`; modules/services.js `projLeft`, `projOver`).

const TODAY = '2026-11-01';

const fields = (patch: Partial<ProjectFields> = {}): ProjectFields => ({
  name: 'Восстановление учёта 2024–2025',
  startsOn: '2026-11-01',
  endsOn: '2026-12-31',
  members: ['e1', 'e2'],
  lead: 'e1',
  plan: 5_000_000,
  works: [],
  ...patch,
});

describe('проект: активный, просрочен, остаток', () => {
  it('активные — «Планируется» и «В работе»; отменить можно только активный', () => {
    expect(projectActive('planned')).toBe(true);
    expect(projectActive('in_progress')).toBe(true);
    expect(projectActive('done')).toBe(false);
    expect(projectActive('cancelled')).toBe(false);
    expect(projectCancelable('in_progress')).toBe(true);
    expect(projectCancelable('done')).toBe(false);
  });

  it('срок прошёл — только у проекта «В работе» с окончанием раньше сегодня', () => {
    expect(projectOverdue({ status: 'in_progress', endsOn: '2026-10-31' }, TODAY)).toBe(true);
    expect(projectOverdue({ status: 'in_progress', endsOn: TODAY }, TODAY)).toBe(false);
    expect(projectOverdue({ status: 'planned', endsOn: '2026-10-31' }, TODAY)).toBe(false);
    expect(projectOverdue({ status: 'done', endsOn: '2026-10-31' }, TODAY)).toBe(false);
  });

  it('работа просрочена — не сделана, срок есть и прошёл', () => {
    expect(projectWorkOverdue({ done: false, due: '2026-10-31' }, TODAY)).toBe(true);
    expect(projectWorkOverdue({ done: true, due: '2026-10-31' }, TODAY)).toBe(false);
    expect(projectWorkOverdue({ done: false, due: null }, TODAY)).toBe(false);
    expect(projectWorkOverdue({ done: false, due: TODAY }, TODAY)).toBe(false);
  });

  it('остаток: план минус получено, не меньше нуля; без плана — 0', () => {
    expect(projectLeft(5_000_000, 4_500_000)).toBe(500_000);
    expect(projectLeft(5_000_000, 6_000_000)).toBe(0);
    expect(projectLeft(null, 100)).toBe(0);
  });

  it('процент полосы: округление, не больше 100; без работ — 0', () => {
    expect(projectPercent(1, 3)).toBe(33);
    expect(projectPercent(2, 3)).toBe(67);
    expect(projectPercent(5, 4)).toBe(100);
    expect(projectPercent(0, 0)).toBe(0);
  });
});

describe('окно проекта', () => {
  it('все отказы сразу — у своих полей', () => {
    expect(
      projectProblems(
        fields({
          name: '  ',
          contractorId: null,
          startsOn: '',
          members: [],
          lead: null,
          plan: 'invalid',
          works: [{ name: 'Акт сверки', executorEmployeeId: '', due: null }],
        }),
      ),
    ).toEqual([
      { field: 'name', problem: 'project_name_required' },
      { field: 'contractor', problem: 'project_contractor_required' },
      { field: 'dates', problem: 'project_dates_required' },
      { field: 'members', problem: 'project_members_required' },
      { field: 'plan', problem: 'project_plan_invalid' },
      { field: 'works', problem: 'project_work_invalid' },
    ]);
    expect(projectProblems(fields({ contractorId: 'c1' }))).toEqual([]);
  });

  it('окончание не раньше начала; главный — один из ответственных', () => {
    expect(projectProblems(fields({ endsOn: '2026-10-31' }))).toEqual([
      { field: 'dates', problem: 'project_dates_order' },
    ]);
    expect(projectProblems(fields({ lead: 'e9' }))).toEqual([
      { field: 'lead', problem: 'project_lead_invalid' },
    ]);
  });

  it('стоимость — сумма или пусто и не меньше уже полученного', () => {
    expect(projectProblems(fields({ plan: null }), 100)).toEqual([]);
    expect(projectProblems(fields({ plan: -1 }))).toEqual([
      { field: 'plan', problem: 'project_plan_invalid' },
    ]);
    expect(projectProblems(fields({ plan: 1.5 }))).toEqual([
      { field: 'plan', problem: 'project_plan_invalid' },
    ]);
    expect(projectProblems(fields({ plan: 4_000_000 }), 4_500_000)).toEqual([
      { field: 'plan', problem: 'project_plan_less', amount: 4_500_000 },
    ]);
  });

  it('работы без названия отбрасываются, у остальных — название без пробелов по краям', () => {
    const works = [
      { name: '  ', executorEmployeeId: '', due: null },
      { name: ' Акт сверки ', executorEmployeeId: 'e1', due: '2026-11-15' },
    ];
    expect(projectProblems(fields({ works }))).toEqual([]);
    expect(projectWorksClean(works)).toEqual([
      { name: 'Акт сверки', executorEmployeeId: 'e1', due: '2026-11-15' },
    ]);
  });

  it('новый проект: с сегодня на 60 дней, «Планируется», ответственный контрагента или я', () => {
    expect(projectFormDefaults(TODAY, { contractorResponsible: 'e3', me: 'e1' })).toEqual({
      startsOn: TODAY,
      endsOn: '2026-12-31',
      status: 'planned',
      members: ['e3'],
      lead: 'e3',
    });
    expect(projectFormDefaults(TODAY, { contractorResponsible: null, me: 'e1' })).toMatchObject({
      members: ['e1'],
      lead: 'e1',
    });
    expect(projectFormDefaults(TODAY, { contractorResponsible: null, me: null })).toMatchObject({
      members: [],
      lead: null,
    });
  });

  it('ответственные: добавить, убрать; ушёл главный — главным становится первый', () => {
    expect(projectMemberToggle(['e1'], 'e1', 'e2')).toEqual({ members: ['e1', 'e2'], lead: 'e1' });
    expect(projectMemberToggle(['e1', 'e2'], 'e1', 'e1')).toEqual({ members: ['e2'], lead: 'e2' });
    expect(projectMemberToggle(['e1'], 'e1', 'e1')).toEqual({ members: [], lead: null });
  });

  it('исполнитель новой работы в карточке — я, если я ответственный, иначе главный', () => {
    const p = { members: ['e1', 'e2'], lead: 'e1' };
    expect(projectWorkExecutor(p, 'e2')).toBe('e2');
    expect(projectWorkExecutor(p, 'e5')).toBe('e1');
    expect(projectWorkExecutor(p, null)).toBe('e1');
  });
});

describe('кто видит проект и ведёт работы', () => {
  const p = { members: ['e2', 'e3'], contractorResponsible: 'e1', status: 'in_progress' as const };

  it('область «Все» — все проекты; иначе ответственный контрагента или один из ответственных', () => {
    expect(projectVisible({ employeeId: 'e9', canKeep: false, seeAll: true }, p)).toBe(true);
    expect(projectVisible({ employeeId: 'e1', canKeep: false, seeAll: false }, p)).toBe(true);
    expect(projectVisible({ employeeId: 'e3', canKeep: false, seeAll: false }, p)).toBe(true);
    expect(projectVisible({ employeeId: 'e9', canKeep: true, seeAll: false }, p)).toBe(false);
    expect(projectVisible({ employeeId: null, canKeep: true, seeAll: false }, p)).toBe(false);
  });

  it('отмечать и добавлять работы — право «Вести проекты» или ответственный проекта', () => {
    expect(projectWorksEditable({ employeeId: 'e9', canKeep: true, seeAll: false }, p)).toBe(true);
    expect(projectWorksEditable({ employeeId: 'e2', canKeep: false, seeAll: false }, p)).toBe(true);
    expect(projectWorksEditable({ employeeId: 'e1', canKeep: false, seeAll: true }, p)).toBe(false);
  });
});

describe('поле «Проект» формы задачи', () => {
  it('предлагаются активные проекты контрагента; завершённый — только уже выбранный', () => {
    expect(projectOfferedForTask({ id: 'p1', status: 'planned' }, null)).toBe(true);
    expect(projectOfferedForTask({ id: 'p1', status: 'in_progress' }, null)).toBe(true);
    expect(projectOfferedForTask({ id: 'p1', status: 'done' }, null)).toBe(false);
    expect(projectOfferedForTask({ id: 'p1', status: 'done' }, 'p1')).toBe(true);
    expect(projectOfferedForTask({ id: 'p1', status: 'cancelled' }, 'p1')).toBe(false);
  });
});
