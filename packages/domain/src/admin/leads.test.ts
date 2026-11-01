import { describe, expect, it } from 'vitest';
import { scaleStatuses } from '../common/status';
import {
  appendLeadNote,
  LEAD_NOTE_TOTAL_MAX,
  LEAD_STATUSES,
  leadBack,
  leadCanConnect,
  leadCanCreateOrg,
  leadCanReject,
  leadCanStart,
  leadMainAction,
  leadSizeOptions,
  leadStatusChange,
  type LeadState,
  type LeadStatus,
} from './leads';

const lead = (status: LeadStatus, more: Partial<LeadState> = {}): LeadState => ({
  status,
  statusBefore: null,
  hasOrg: false,
  ...more,
});

describe('заявки с лендинга', () => {
  it('статусы заявки — те же, что у шкалы «Заявка» справочника «Статусы»', () => {
    expect([...LEAD_STATUSES]).toEqual(scaleStatuses('lead'));
  });

  it('варианты «Сколько клиентов ведёте» — из текста словаря через «|»', () => {
    expect(leadSizeOptions('До 20|21–50| 51–100 |Больше 100|')).toEqual([
      'До 20',
      '21–50',
      '51–100',
      'Больше 100',
    ]);
    expect(leadSizeOptions('')).toEqual([]);
  });

  it('повторная заявка дописывает комментарий с новой строки, пустой — не меняет', () => {
    expect(appendLeadNote(null, ' Перезвоните после обеда ')).toBe('Перезвоните после обеда');
    expect(appendLeadNote('Первый', 'Второй')).toBe('Первый\nВторой');
    expect(appendLeadNote('Первый', '  ')).toBe('Первый');
    expect(appendLeadNote(null, '')).toBeNull();
    expect(appendLeadNote('x'.repeat(LEAD_NOTE_TOTAL_MAX), 'ещё')).toHaveLength(
      LEAD_NOTE_TOTAL_MAX,
    );
  });

  it('меню строки — как в прототипе (leadActions)', () => {
    const menu = (s: LeadState) =>
      [
        leadCanStart(s) && 'start',
        leadCanCreateOrg(s) && 'org',
        leadCanConnect(s) && 'connect',
        leadCanReject(s) && 'reject',
      ].filter(Boolean);
    expect(menu(lead('new'))).toEqual(['start', 'org', 'reject']);
    expect(menu(lead('in_progress'))).toEqual(['org', 'connect', 'reject']);
    expect(menu(lead('connected'))).toEqual(['org']);
    expect(menu(lead('connected', { hasOrg: true }))).toEqual([]);
    // «Создать организацию» есть и у «Отказа»: человек мог передумать.
    expect(menu(lead('rejected'))).toEqual(['org']);
    expect(menu(lead('in_progress', { hasOrg: true }))).toEqual(['reject']);
  });

  it('откат: «Снять «Отказ»» — в статус до отказа, «Подключена» с организацией не откатывается', () => {
    expect(leadBack(lead('new'))).toBeNull();
    expect(leadBack(lead('in_progress'))).toEqual({ to: 'new' });
    expect(leadBack(lead('connected'))).toEqual({ to: 'in_progress' });
    expect(leadBack(lead('connected', { hasOrg: true }))).toEqual({ locked: true });
    expect(leadBack(lead('rejected', { statusBefore: 'in_progress' }))).toEqual({
      to: 'in_progress',
    });
    expect(leadBack(lead('rejected'))).toEqual({ to: 'new' });
    expect(leadBack(lead('rejected', { statusBefore: 'connected' }))).toEqual({ to: 'new' });
  });

  it('главная кнопка окна: «В работу» у новой, «Создать организацию» без организации и не у «Отказа»', () => {
    expect(leadMainAction(lead('new'))).toBe('start');
    expect(leadMainAction(lead('in_progress'))).toBe('org');
    expect(leadMainAction(lead('connected'))).toBe('org');
    expect(leadMainAction(lead('connected', { hasOrg: true }))).toBeNull();
    expect(leadMainAction(lead('rejected'))).toBeNull();
  });

  it('смена статуса на сервере: шаг, «Отказ», откат; лишнее — отказ', () => {
    expect(leadStatusChange(lead('new'), 'in_progress')).toEqual({
      kind: 'step',
      to: 'in_progress',
    });
    expect(leadStatusChange(lead('new'), 'connected')).toBeNull();
    expect(leadStatusChange(lead('in_progress'), 'connected')).toEqual({
      kind: 'step',
      to: 'connected',
    });
    expect(leadStatusChange(lead('in_progress', { hasOrg: true }), 'connected')).toBeNull();
    expect(leadStatusChange(lead('new'), 'rejected')).toEqual({ kind: 'reject' });
    expect(leadStatusChange(lead('connected'), 'rejected')).toBeNull();
    expect(leadStatusChange(lead('rejected'), 'rejected')).toBeNull();
    expect(leadStatusChange(lead('in_progress'), 'new')).toEqual({ kind: 'rollback', to: 'new' });
    expect(leadStatusChange(lead('connected'), 'in_progress')).toEqual({
      kind: 'rollback',
      to: 'in_progress',
    });
    expect(leadStatusChange(lead('connected', { hasOrg: true }), 'in_progress')).toBe('locked');
    expect(leadStatusChange(lead('connected'), 'new')).toBeNull();
    expect(
      leadStatusChange(lead('rejected', { statusBefore: 'in_progress' }), 'in_progress'),
    ).toEqual({ kind: 'rollback', to: 'in_progress' });
    expect(leadStatusChange(lead('rejected', { statusBefore: 'in_progress' }), 'new')).toBeNull();
    expect(leadStatusChange(lead('new'), 'new')).toBeNull();
  });
});
