import { defaultUiTexts } from '@buhuchet/domain';
import type { ContractorService } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  serviceMenuEntries,
  servicePlanNote,
  type ServiceMenuRun,
  type ServiceRights,
} from './service-menu';

// Пункты обслуживания в меню контрагента и отметка запланированного (прототип cpActions, svcPlanNote).

const t = makeTranslate(defaultUiTexts());
const ALL: ServiceRights = { createCp: true, cpPause: true, cpArchive: true, rollback: true };

const service = (over: Partial<ContractorService> = {}): ContractorService => ({
  id: '00000000-0000-4000-8000-000000000100',
  kind: 'regular',
  status: 'active',
  periods: [{ from: '2026-01', to: null }],
  periodsText: '01.2026–…',
  month: '2026-10',
  plannedPause: null,
  plannedResume: null,
  skipped: [],
  statusHistory: [],
  version: 1,
  ...over,
});

const run = (): ServiceMenuRun => ({
  toRegular: vi.fn(),
  cancelPause: vi.fn(),
  changeResume: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  rollback: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
});

const items = (entries: ActionEntry[]) => entries.filter((e): e is ActionItem => 'run' in e);
const menu = (s: ContractorService, rights: ServiceRights = ALL) =>
  items(serviceMenuEntries({ service: s, rights, t, run: run() }));
const labels = (s: ContractorService, rights: ServiceRights = ALL) =>
  menu(s, rights).map((i) => (i.disabled ? `${i.label} (${i.reason})` : i.label));

describe('меню обслуживания контрагента', () => {
  it('обслуживается: «Приостановить» и «В архив» красным', () => {
    expect(labels(service())).toEqual(['Приостановить обслуживание', 'В архив']);
    expect(menu(service()).at(-1)).toMatchObject({ id: 'archive', danger: true });
  });

  it('запланирована приостановка: «Отменить приостановку» с месяцем; без права отката — бледным', () => {
    const s = service({
      periods: [
        { from: '2026-01', to: '2026-11' },
        { from: '2027-05', to: null },
      ],
      plannedPause: { from: '2026-12', resume: '2027-05' },
    });
    expect(menu(s)[0]).toMatchObject({
      label: 'Отменить приостановку',
      sub: 'Запланирована с декабря 2026',
    });
    expect(labels(s)).toEqual([
      'Отменить приостановку',
      'Изменить возобновление: сейчас с мая 2027',
      'В архив',
    ]);
    expect(labels(s, { ...ALL, rollback: false })[0]).toBe(
      'Отменить приостановку (Нужно право «Откат статусов»)',
    );
  });

  it('приостановлен: «Возобновить», «Откатить приостановку»; запланированное возобновление — «Изменить»', () => {
    const paused = service({ status: 'paused', periods: [{ from: '2026-01', to: '2026-09' }] });
    expect(labels(paused)).toEqual([
      'Возобновить обслуживание',
      'Откатить приостановку',
      'В архив',
    ]);
    expect(labels(paused, { ...ALL, rollback: false })[1]).toBe(
      'Откатить приостановку (Нужно право «Откат статусов»)',
    );
    const planned = service({
      status: 'paused',
      periods: [
        { from: '2026-01', to: '2026-09' },
        { from: '2026-12', to: null },
      ],
      plannedResume: '2026-12',
    });
    expect(labels(planned)).toEqual([
      'Изменить возобновление: сейчас с декабря 2026',
      'Откатить приостановку',
      'В архив',
    ]);
  });

  it('права: без «Приостанавливать» — только архив; без архива — ничего', () => {
    const rights = { ...ALL, cpPause: false };
    expect(labels(service(), rights)).toEqual(['В архив']);
    expect(labels(service(), { ...rights, cpArchive: false })).toEqual([]);
  });

  it('разовый: «Перевести в постоянное обслуживание» (право «Создавать») и «В архив»', () => {
    const s = service({ kind: 'oneoff', periods: [], periodsText: '' });
    expect(labels(s)).toEqual(['Перевести в постоянное обслуживание', 'В архив']);
    expect(labels(s, { ...ALL, createCp: false })).toEqual(['В архив']);
  });

  it('архивный: только «Вернуть из архива» и только с правом архива', () => {
    const s = service({ status: 'archived', periods: [{ from: '2026-01', to: '2026-10' }] });
    expect(labels(s)).toEqual(['Вернуть из архива']);
    expect(labels(s, { ...ALL, cpArchive: false })).toEqual([]);
  });

  it('пункт вызывает своё действие с обслуживанием', () => {
    const r = run();
    const s = service();
    const [pause] = items(serviceMenuEntries({ service: s, rights: ALL, t, run: r }));
    pause!.run();
    expect(r.pause).toHaveBeenCalledWith(s);
  });

  it('отметка запланированного: приостановка с возобновлением, возобновление', () => {
    expect(servicePlanNote(t, service())).toBeNull();
    expect(
      servicePlanNote(t, service({ plannedPause: { from: '2026-12', resume: '2027-05' } })),
    ).toEqual({
      kind: 'pause',
      text: 'Запланирована приостановка с декабря 2026, возобновление с мая 2027',
    });
    expect(
      servicePlanNote(t, service({ plannedPause: { from: '2026-12', resume: null } })),
    ).toEqual({ kind: 'pause', text: 'Запланирована приостановка с декабря 2026' });
    expect(servicePlanNote(t, service({ status: 'paused', plannedResume: '2026-12' }))).toEqual({
      kind: 'resume',
      text: 'Возобновление запланировано с декабря 2026',
    });
  });
});
