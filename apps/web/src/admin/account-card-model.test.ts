import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminUserCard } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  accountHashLogin,
  accountHistoryItems,
  accountHistoryText,
  accountHistoryWho,
  sessionEndText,
} from './account-card-model';

// Карточка пользователя в Админке (прототип v83, admin/admin-cards.js): строки «Истории», подписи
// закрытых сеансов и адрес #accounts/<логин>.

const t = makeTranslate(defaultUiTexts());

const entry = (over: Partial<AdminUserCard['history'][number]> = {}) => ({
  id: 'user-1',
  at: '2026-11-12T04:05:00.000Z',
  actor: null,
  actorAdmin: false,
  entity: 'user',
  action: 'update',
  fields: [],
  reason: null,
  ...over,
});

describe('карточка пользователя: «История»', () => {
  it('действие с пояснением показывается пояснением', () => {
    expect(
      accountHistoryText(
        t,
        entry({ action: 'card_view', reason: 'Открыта карточка пользователя' }),
      ),
    ).toBe('Открыта карточка пользователя');
  });

  it('создание учётной записи и сотрудника, закрытие входа', () => {
    expect(accountHistoryText(t, entry({ action: 'create' }))).toBe('Учётная запись создана');
    expect(accountHistoryText(t, entry({ entity: 'employee', action: 'create' }))).toBe(
      'Сотрудник добавлен',
    );
    expect(accountHistoryText(t, entry({ action: 'login_lock' }))).toBe(
      'Вход закрыт: неверные пароли подряд',
    );
  });

  it('правка без пояснения — перечень изменённых полей; роль — один раз, незнакомое поле — как есть', () => {
    expect(
      accountHistoryText(
        t,
        entry({ entity: 'employee', fields: ['roleId', 'roleName', 'phone', 'shift'] }),
      ),
    ).toBe('Изменено: роль, телефон, shift');
    expect(accountHistoryText(t, entry({ fields: ['passwordHash', 'mustChangePassword'] }))).toBe(
      'Изменено: пароль, временный пароль',
    );
    expect(accountHistoryText(t, entry())).toBe('Запись изменена');
  });

  it('кто: сотрудник, администратор платформы или «Система»', () => {
    expect(accountHistoryWho(t, entry({ actor: 'Эркин А.' }))).toBe('Эркин А.');
    expect(accountHistoryWho(t, entry({ actorAdmin: true }))).toBe('Администратор платформы');
    expect(accountHistoryWho(t, entry())).toBe('Система');
  });

  it('строка ленты: дата и время по Бишкеку', () => {
    expect(accountHistoryItems(t, [entry({ action: 'create' })])).toEqual([
      {
        id: 'user-1',
        date: '12.11.2026',
        time: '10:05',
        text: 'Учётная запись создана',
        who: 'Система',
      },
    ]);
  });
});

describe('карточка пользователя: сеансы и ссылка', () => {
  it('чем закрыт сеанс', () => {
    expect(sessionEndText(t, 'logout')).toBe('Выход');
    expect(sessionEndText(t, 'expired')).toBe('Истёк срок');
    expect(sessionEndText(t, 'admin')).toBe('Завершён администратором платформы');
    expect(sessionEndText(t, 'blocked')).toBe('Завершён: учётная запись заблокирована');
    expect(sessionEndText(t, 'reset')).toBe('Завершён: пароль сброшен');
    expect(sessionEndText(t, 'password')).toBe('Завершён: пароль изменён');
    expect(sessionEndText(t, 'closed')).toBe('Завершён');
    expect(sessionEndText(t, null)).toBe('');
  });

  it('адрес #accounts/<логин>: логин из адреса, чужой адрес и битая кодировка — нет', () => {
    expect(accountHashLogin('#accounts/alisher')).toBe('alisher');
    expect(accountHashLogin('#accounts/ivan.petrov%2D1')).toBe('ivan.petrov-1');
    expect(accountHashLogin('#accounts/')).toBeNull();
    expect(accountHashLogin('#orgs/demo')).toBeNull();
    expect(accountHashLogin('#accounts/%E0%A4%A')).toBeNull();
    expect(accountHashLogin('')).toBeNull();
  });
});
