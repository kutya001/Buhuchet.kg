import { defaultUiTexts } from '@buhuchet/domain';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  contractorMenuEntries,
  serviceScaleSteps,
  type ContractorRights,
  type MenuContractor,
} from './contractor-menu';

// Меню «…» контрагента и кнопка «Действия» карточки (прототип modules/contractors.js, cpActions),
// шаги шкалы обслуживания в карточке (прототип scaleFull('svc')).

const t = makeTranslate(defaultUiTexts());
const ALL: ContractorRights = { createCp: true, assign: true, cpArchive: true };
const NONE: ContractorRights = { createCp: false, assign: false, cpArchive: false };

const cp = (over: Partial<MenuContractor> = {}): MenuContractor => ({
  id: '00000000-0000-4000-8000-000000000100',
  archived: false,
  oneoff: false,
  hasReports: false,
  ...over,
});

const run = () => ({
  open: vi.fn(),
  edit: vi.fn(),
  responsible: vi.fn(),
  pick: vi.fn(),
  remove: vi.fn(),
});

const SERVICE: ActionEntry[] = [
  { id: 'pause', label: 'Приостановить обслуживание', icon: 'pause', run: () => {} },
  { id: 'archive', label: 'В архив', icon: 'archive', danger: true, run: () => {} },
];

const labels = (list: readonly ActionEntry[]) =>
  list.map((i) => ('separator' in i ? '—' : i.label));
const item = (list: readonly ActionEntry[], id: string) =>
  list.find((i): i is ActionItem => !('separator' in i) && i.id === id);

describe('меню контрагента', () => {
  it('со всеми правами: открыть, изменить, ответственный, подбор, обслуживание, «Удалить» красным', () => {
    const r = run();
    const list = contractorMenuEntries({ c: cp(), rights: ALL, t, run: r, service: SERVICE });
    expect(labels(list)).toEqual([
      'Открыть карточку',
      'Изменить',
      'Сменить ответственного',
      'Подобрать отчёты',
      '—',
      'Приостановить обслуживание',
      'В архив',
      '—',
      'Удалить',
    ]);
    const remove = item(list, 'delete')!;
    expect(remove).toMatchObject({ danger: true, icon: 'trash' });
    expect(remove.disabled).toBeFalsy();
    remove.run();
    item(list, 'pick')!.run();
    expect(r.remove).toHaveBeenCalled();
    expect(r.pick).toHaveBeenCalled();
  });

  it('есть отчёты — «Удалить» бледным с причиной: только в архив', () => {
    const list = contractorMenuEntries({
      c: cp({ hasReports: true }),
      rights: ALL,
      t,
      run: run(),
      service: [],
    });
    expect(item(list, 'delete')).toMatchObject({
      disabled: true,
      reason: 'По контрагенту есть отчёты — его можно только отправить в архив',
    });
  });

  it('без прав — только «Открыть карточку»; «Назначать отчёты» даёт ответственного и подбор', () => {
    expect(
      labels(contractorMenuEntries({ c: cp(), rights: NONE, t, run: run(), service: [] })),
    ).toEqual(['Открыть карточку']);
    expect(
      labels(
        contractorMenuEntries({
          c: cp(),
          rights: { ...NONE, assign: true },
          t,
          run: run(),
          service: [],
        }),
      ),
    ).toEqual(['Открыть карточку', 'Сменить ответственного', 'Подобрать отчёты']);
  });

  it('у разового нет «Подобрать отчёты»; у архивного — только карточка и пункты обслуживания', () => {
    expect(
      labels(
        contractorMenuEntries({ c: cp({ oneoff: true }), rights: ALL, t, run: run(), service: [] }),
      ),
    ).toEqual(['Открыть карточку', 'Изменить', 'Сменить ответственного', '—', 'Удалить']);
    const back: ActionEntry[] = [
      { id: 'unarchive', label: 'Вернуть из архива', icon: 'refresh', run: () => {} },
    ];
    expect(
      labels(
        contractorMenuEntries({
          c: cp({ archived: true }),
          rights: ALL,
          t,
          run: run(),
          service: back,
        }),
      ),
    ).toEqual(['Открыть карточку', '—', 'Вернуть из архива']);
  });

  it('«Действия» карточки — без «Открыть карточку» и «Подобрать отчёты» (в карточке это вкладка)', () => {
    expect(
      labels(
        contractorMenuEntries({ c: cp(), rights: ALL, t, run: run(), service: [], card: true }),
      ),
    ).toEqual(['Изменить', 'Сменить ответственного', '—', 'Удалить']);
  });
});

describe('шкала обслуживания в карточке', () => {
  it('шаг нажимается, только если в меню есть его пункт; назад — «Откатить приостановку»', () => {
    expect(serviceScaleSteps(SERVICE)).toEqual({
      next: { paused: 'pause', archived: 'archive' },
      back: null,
    });
    const paused: ActionEntry[] = [
      { id: 'resume', label: 'Возобновить обслуживание', icon: 'play', run: () => {} },
      { id: 'rollback', label: 'Откатить приостановку', icon: 'history', run: () => {} },
    ];
    expect(serviceScaleSteps(paused)).toEqual({ next: { active: 'resume' }, back: 'active' });
  });

  it('недоступный пункт (нет права «Откат статусов») шага не даёт', () => {
    const locked: ActionEntry[] = [
      {
        id: 'rollback',
        label: 'Откатить приостановку',
        icon: 'history',
        disabled: true,
        reason: 'Нужно право «Откат статусов»',
        run: () => {},
      },
    ];
    expect(serviceScaleSteps(locked)).toEqual({ next: {}, back: null });
    expect(serviceScaleSteps([])).toEqual({ next: {}, back: null });
  });

  it('у архивного вперёд — «Вернуть из архива»', () => {
    const back: ActionEntry[] = [
      { id: 'unarchive', label: 'Вернуть из архива', icon: 'refresh', run: () => {} },
    ];
    expect(serviceScaleSteps(back).next).toEqual({ active: 'unarchive' });
  });
});
