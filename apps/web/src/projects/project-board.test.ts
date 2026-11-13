import { defaultUiTexts } from '@buhuchet/domain';
import { ProjectEditRequest, type ProjectCard } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { leadChangeBody, leadChangeRefusal, projectKanban, projectMove } from './project-board';

// Доска проектов (прототип v85 modules/projects.js, `projKanban`): перетаскиванием меняются статус
// (шаг вперёд по шкале, «Отменён» — с вопросом) и главный незавершённого проекта.

const t = makeTranslate(defaultUiTexts());
const ME = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const THIRD = '00000000-0000-4000-8000-0000000000e3';
const project = (
  status: 'planned' | 'in_progress' | 'done' | 'cancelled' = 'in_progress',
  lead = ME,
) => ({ status, lead: { id: lead } });

describe('доска проектов', () => {
  it('столбцы: статус по умолчанию; три статуса видны и пустыми, «Отменён» — только с проектами', () => {
    const kanban = projectKanban(t, [{ key: OTHER, label: 'Айбек С.' }], () => {});
    expect(kanban.def).toBe('status');
    expect(kanban.by).toEqual(['status', 'cp', 'lead']);
    expect(kanban.order?.status).toEqual(['planned', 'in_progress', 'done', 'cancelled']);
    expect(kanban.show?.status).toEqual([
      { key: 'planned', label: 'Планируется' },
      { key: 'in_progress', label: 'В работе' },
      { key: 'done', label: 'Завершён' },
    ]);
    expect(kanban.show?.lead).toEqual([{ key: OTHER, label: 'Айбек С.' }]);
    // Сумма в шапке столбца — целыми сомами, как в прототипе.
    expect(kanban.sum?.(125050)).toBe('1 251');
    expect(kanban.drop).toBeTypeOf('function');
    expect(projectKanban(t, [], undefined).drop).toBeUndefined();
  });

  it('по статусу: шаг вперёд по шкале — сразу, свой столбец — ничего', () => {
    expect(projectMove(project('planned'), true, 'status', 'in_progress')).toEqual({
      kind: 'status',
      to: 'in_progress',
    });
    expect(projectMove(project('in_progress'), true, 'status', 'done')).toEqual({
      kind: 'status',
      to: 'done',
    });
    for (const s of ['planned', 'in_progress', 'done', 'cancelled'] as const)
      expect(projectMove(project(s), true, 'status', s)).toEqual({ kind: 'none' });
  });

  it('по статусу: «Отменён» у активного проекта — вопрос, у завершённого — отказ', () => {
    expect(projectMove(project('planned'), true, 'status', 'cancelled')).toEqual({
      kind: 'cancel',
    });
    expect(projectMove(project('in_progress'), true, 'status', 'cancelled')).toEqual({
      kind: 'cancel',
    });
    expect(projectMove(project('done'), true, 'status', 'cancelled')).toEqual({
      kind: 'refusal',
      key: 'proj.board.no_move',
    });
  });

  it('по статусу: через шаг — отказ, назад — отказ с подсказкой про меню проекта', () => {
    expect(projectMove(project('planned'), true, 'status', 'done')).toEqual({
      kind: 'refusal',
      key: 'proj.board.no_move',
    });
    for (const [from, to] of [
      ['in_progress', 'planned'],
      ['done', 'in_progress'],
      ['cancelled', 'in_progress'],
    ] as const)
      expect(projectMove(project(from), true, 'status', to)).toEqual({
        kind: 'refusal',
        key: 'proj.board.no_move_back',
      });
    expect(projectMove(project('cancelled'), true, 'status', 'planned')).toEqual({
      kind: 'refusal',
      key: 'proj.board.no_move',
    });
  });

  it('по главному: другой сотрудник — смена, свой столбец — ничего', () => {
    expect(projectMove(project('planned'), true, 'lead', OTHER)).toEqual({
      kind: 'lead',
      employeeId: OTHER,
    });
    expect(projectMove(project('in_progress'), true, 'lead', OTHER).kind).toBe('lead');
    expect(projectMove(project('in_progress'), true, 'lead', ME)).toEqual({ kind: 'none' });
  });

  it('по главному: не столбец сотрудника и завершённый или отменённый проект — отказ', () => {
    expect(projectMove(project(), true, 'lead', '')).toEqual({
      kind: 'refusal',
      key: 'proj.board.pick_employee',
    });
    for (const s of ['done', 'cancelled'] as const)
      expect(projectMove(project(s), true, 'lead', OTHER)).toEqual({
        kind: 'refusal',
        key: 'proj.board.lead_open',
      });
  });

  it('без права «Вести проекты и разовые услуги» и по контрагенту — отказ', () => {
    for (const key of ['status', 'lead', 'cp'])
      expect(projectMove(project('planned'), false, key, 'in_progress')).toEqual({
        kind: 'refusal',
        key: 'proj.board.no_right',
      });
    expect(projectMove(project(), true, 'cp', 'x')).toEqual({
      kind: 'refusal',
      key: 'proj.board.only',
    });
  });

  it('тексты отказов — в словаре, с названиями столбцов', () => {
    expect(t('proj.board.no_move', { from: 'Планируется', to: 'Завершён' })).toBe(
      'Из «Планируется» в «Завершён» проект перевести нельзя',
    );
    expect(t('proj.board.no_move_back', { from: 'В работе', to: 'Планируется' })).toContain(
      'откат — в меню проекта',
    );
    expect(t('proj.board.lead_done', { name: 'Айбек С.' })).toBe('Главный по проекту: Айбек С.');
  });
});

describe('смена главного с доски', () => {
  const card = {
    version: 7,
    name: 'Восстановление учёта',
    startsOn: '2026-10-01',
    endsOn: '2026-12-31',
    description: 'За 2025 год',
    lead: { id: ME, name: 'Я' },
    members: [
      { id: ME, name: 'Я' },
      { id: THIRD, name: 'Третий' },
    ],
    money: { plan: 12_000_000, paid: 0 },
    works: [
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        name: 'Первичка',
        executor: { id: THIRD, name: 'Третий' },
        due: '2026-11-20',
        done: true,
        overdue: false,
      },
      {
        id: '00000000-0000-4000-8000-0000000000a2',
        name: 'Отчётность',
        executor: { id: ME, name: 'Я' },
        due: null,
        done: false,
        overdue: false,
      },
    ],
  } as unknown as ProjectCard;

  it('новый главный добавляется в ответственные, остальное — как в карточке', () => {
    const body = leadChangeBody(card, OTHER, 7);
    expect(body).toEqual({
      version: 7,
      name: 'Восстановление учёта',
      startsOn: '2026-10-01',
      endsOn: '2026-12-31',
      description: 'За 2025 год',
      plan: 12_000_000,
      members: [ME, THIRD, OTHER],
      lead: OTHER,
      works: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          name: 'Первичка',
          executorId: THIRD,
          due: '2026-11-20',
        },
        {
          id: '00000000-0000-4000-8000-0000000000a2',
          name: 'Отчётность',
          executorId: ME,
          due: null,
        },
      ],
    });
    // Запрос проходит схему окна «Изменить проект».
    expect(ProjectEditRequest.safeParse(body).success).toBe(true);
  });

  it('главный из ответственных второй раз не добавляется; без права на деньги стоимость пустая', () => {
    const body = leadChangeBody({ ...card, money: null }, THIRD, 5);
    expect(body.members).toEqual([ME, THIRD]);
    expect(body.lead).toBe(THIRD);
    expect(body.plan).toBeNull();
    // Версия — записи на доске: проект, изменённый после загрузки списка, сервер не сохранит.
    expect(body.version).toBe(5);
  });

  it('по свежим данным: столбец заблокированного сотрудника и завершённый проект — отказ', () => {
    const active = [ME, OTHER];
    expect(leadChangeRefusal({ status: 'in_progress' }, active, OTHER)).toBeNull();
    expect(leadChangeRefusal({ status: 'planned' }, active, OTHER)).toBeNull();
    // Заблокированный сотрудник ещё числится главным другого проекта — его столбец виден.
    expect(leadChangeRefusal({ status: 'in_progress' }, active, THIRD)).toBe(
      'proj.board.pick_employee',
    );
    for (const status of ['done', 'cancelled'] as const)
      expect(leadChangeRefusal({ status }, active, OTHER)).toBe('proj.board.lead_open');
  });
});
