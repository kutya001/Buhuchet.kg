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
  telegramErrorText,
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
  changes: [],
  reason: null,
  ...over,
});

describe('карточка пользователя: «История»', () => {
  it('бонусы сотрудника: списание — с основанием и без суммы, отмена списания', () => {
    const change = (field: string) => ({ field, from: null, to: null });
    expect(
      accountHistoryText(
        t,
        entry({
          entity: 'employee',
          changes: [change('bonusOut'), change('bonusOutDate'), change('bonusBalance')],
          reason: 'Выдано с зарплатой',
        }),
      ),
    ).toBe('Списан бонус: Выдано с зарплатой');
    expect(
      accountHistoryText(
        t,
        entry({ entity: 'employee', changes: [change('bonusOutUndo'), change('bonusOutDate')] }),
      ),
    ).toBe('Отменено списание бонуса');
  });

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

  const plain = (...fields: string[]) => fields.map((field) => ({ field, from: null, to: null }));

  it('правка без значений — перечень изменённых полей; незнакомое поле — как есть', () => {
    expect(
      accountHistoryText(t, entry({ entity: 'employee', changes: plain('phone', 'shift') })),
    ).toBe('Изменено: телефон, shift');
    expect(
      accountHistoryText(t, entry({ changes: plain('passwordHash', 'mustChangePassword') })),
    ).toBe('Изменено: пароль, временный пароль');
    expect(accountHistoryText(t, entry())).toBe('Запись изменена');
  });

  it('правка со значениями — «было → стало» (ТЗ); роль — один раз', () => {
    expect(
      accountHistoryText(
        t,
        entry({
          entity: 'employee',
          changes: [
            { field: 'roleId', from: null, to: null },
            { field: 'roleName', from: 'Бухгалтер', to: 'Главный бухгалтер' },
            { field: 'phone', from: null, to: null },
          ],
        }),
      ),
    ).toBe('Роль: Бухгалтер → Главный бухгалтер; Изменено: телефон');
    expect(
      accountHistoryText(
        t,
        entry({
          entity: 'employee',
          changes: [{ field: 'shortName', from: 'Айгерим А.', to: 'Айгерим' }],
        }),
      ),
    ).toBe('Отображаемое имя: Айгерим А. → Айгерим');
    expect(
      accountHistoryText(
        t,
        entry({ changes: [{ field: 'fullName', from: null, to: 'Асанов Асан' }] }),
      ),
    ).toBe('ФИО: Асанов Асан');
  });

  it('Telegram: привязка, отвязка и замена различаются', () => {
    const tg = (from: string | null, to: string | null) =>
      accountHistoryText(t, entry({ changes: [{ field: 'telegram', from, to }] }));
    expect(tg(null, '@asanov')).toBe('Telegram привязан: @asanov');
    expect(tg('@asanov', null)).toBe('Telegram отвязан');
    expect(tg('@asanov', '@asan2')).toBe('Telegram заменён: @asanov → @asan2');
  });

  it('блокировка сотрудника владельцем и снятие блокировки входа', () => {
    const flag = (field: string, from: boolean, to: boolean) =>
      accountHistoryText(t, entry({ entity: 'employee', changes: [{ field, from, to }] }));
    expect(flag('active', true, false)).toBe('Заблокирован');
    expect(flag('active', false, true)).toBe('Разблокирован');
    expect(flag('loginLocked', true, false)).toBe('Вход разблокирован');
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

describe('карточка пользователя: «Telegram»', () => {
  it('ошибка сообщения: код итога — подписью из словаря, ответ Telegram — как есть', () => {
    expect(telegramErrorText(t, 'recipient_unlinked')).toBe(t('tgadm.err.unlinked'));
    expect(telegramErrorText(t, '403: Forbidden')).toBe('403: Forbidden');
    expect(telegramErrorText(t, null)).toBe(t('tgadm.st.error'));
  });
});
