import { describe, expect, it } from 'vitest';
import {
  REQUEST_DICT_FORMS,
  REQUEST_FORM_FIELDS,
  REQUEST_LIMITS,
  requestAdminNext,
  requestCanSend,
  requestCanWithdraw,
  requestClip,
  requestFormOf,
  requestFormProblems,
  requestFormStored,
  requestHourOk,
  requestMessageHourOk,
  requestReplyEffect,
  requestStatusLabel,
  requestTopic,
  requestUnread,
  requestVisible,
  requestWhereClean,
} from './rules';

// Правила запросов администратору (ТЗ «Доработки 28.11.2026: запросы пользователей администратору»,
// прототип v169 modules/requests.js).

const author = { userId: 'u1', owner: false, seesDicts: false };
const other = { userId: 'u2', owner: false, seesDicts: true };
const owner = { userId: 'u3', owner: true, seesDicts: true };

describe('кто видит и отправляет', () => {
  it('вопрос, ошибку и опечатку видят автор и владелец', () => {
    for (const kind of ['q', 'bug', 'typo'] as const) {
      const r = { kind, authorId: 'u1' };
      expect(requestVisible(r, author), kind).toBe(true);
      expect(requestVisible(r, other), kind).toBe(false);
      expect(requestVisible(r, owner), kind).toBe(true);
    }
  });

  it('«Добавить в справочник» видят все, кто видит «Справочники»', () => {
    const r = { kind: 'dict' as const, authorId: 'u1' };
    expect(requestVisible(r, other)).toBe(true);
    expect(requestVisible(r, owner)).toBe(true);
    expect(requestVisible(r, { userId: 'u9', owner: false, seesDicts: false })).toBe(false);
  });

  it('отправить вопрос может любой, «Добавить в справочник» — кто видит «Справочники»', () => {
    expect(requestCanSend('q', author)).toBe(true);
    expect(requestCanSend('dict', author)).toBe(false);
    expect(requestCanSend('dict', other)).toBe(true);
  });
});

describe('статусы и переходы', () => {
  it('«Отозвать» — только автор и только у «Нового»', () => {
    expect(requestCanWithdraw('new', true)).toBe(true);
    expect(requestCanWithdraw('new', false)).toBe(false);
    for (const st of ['in_work', 'solved', 'added', 'rejected', 'withdrawn'] as const)
      expect(requestCanWithdraw(st, true), st).toBe(false);
  });

  it('ответ в закрытый — до 30 дней возвращает «В работу», позже и у отозванного — закрыт', () => {
    expect(requestReplyEffect('in_work', null, '2026-12-01')).toBe('post');
    expect(requestReplyEffect('solved', '2026-11-01', '2026-12-01')).toBe('reopen');
    expect(requestReplyEffect('rejected', '2026-11-01', '2026-12-02')).toBe('closed');
    expect(requestReplyEffect('added', '2026-12-01', '2026-12-01')).toBe('reopen');
    expect(requestReplyEffect('withdrawn', '2026-12-01', '2026-12-01')).toBe('closed');
  });

  it('действия администратора — только у открытого; «Добавлено» — у справочника, «Решён» — у остальных', () => {
    expect(requestAdminNext('new', 'q', 'take')).toBe('in_work');
    expect(requestAdminNext('in_work', 'q', 'take')).toBe('in_work');
    expect(requestAdminNext('in_work', 'q', 'solve')).toBe('solved');
    expect(requestAdminNext('in_work', 'q', 'add')).toBeNull();
    expect(requestAdminNext('new', 'dict', 'add')).toBe('added');
    expect(requestAdminNext('new', 'dict', 'solve')).toBeNull();
    expect(requestAdminNext('new', 'bug', 'reject')).toBe('rejected');
    for (const st of ['solved', 'added', 'rejected', 'withdrawn'] as const)
      for (const a of ['take', 'solve', 'add', 'reject'] as const)
        expect(requestAdminNext(st, 'dict', a), `${st} ${a}`).toBeNull();
  });

  it('«Ждёт вашего ответа» — автору, остальным — «Ждёт ответа автора»', () => {
    expect(requestStatusLabel('in_work', true, true)).toBe('wait_you');
    expect(requestStatusLabel('in_work', true, false)).toBe('wait_author');
    expect(requestStatusLabel('in_work', false, true)).toBe('in_work');
    expect(requestStatusLabel('new', true, true)).toBe('new');
  });

  it('непрочитанное: автору — ответ и решение, кроме «взят в работу»; администратору — сообщение организации', () => {
    const feed = [
      { n: 1, byAdmin: false, kind: 'msg' as const },
      { n: 2, byAdmin: true, kind: 'st' as const, to: 'in_work' as const },
      { n: 3, byAdmin: true, kind: 'ask' as const },
    ];
    expect(requestUnread(feed.slice(0, 2), 1, 'author')).toBe(false);
    expect(requestUnread(feed, 1, 'author')).toBe(true);
    expect(requestUnread(feed, 3, 'author')).toBe(false);
    expect(requestUnread(feed, 0, 'admin')).toBe(true);
    expect(requestUnread(feed, 1, 'admin')).toBe(false);
  });
});

describe('пределы', () => {
  it('20 запросов и 60 сообщений в час на организацию, текст до 4 000', () => {
    expect(requestHourOk(19)).toBe(true);
    expect(requestHourOk(20)).toBe(false);
    expect(requestMessageHourOk(59)).toBe(true);
    expect(requestMessageHourOk(60)).toBe(false);
    expect(REQUEST_LIMITS.text).toBe(4000);
    expect(REQUEST_LIMITS.firstNo).toBe(1201);
  });
});

describe('формы', () => {
  it('у каждой формы справочника — обязательное поле, как в прототипе', () => {
    for (const id of REQUEST_DICT_FORMS)
      expect(
        REQUEST_FORM_FIELDS[id].some((x) => x.required),
        id,
      ).toBe(true);
    expect(REQUEST_FORM_FIELDS.gked[0]).toEqual({ key: 'code', type: 'text', required: true });
  });

  it('вопрос: тема и текст обязательны, текст до 4 000', () => {
    expect(requestFormProblems('q', { topic: 'Как сдать', text: 'Вопрос' }, null)).toEqual({});
    expect(requestFormProblems('q', { topic: ' ', text: '' }, null)).toEqual({
      topic: 'empty',
      text: 'empty',
    });
    expect(requestFormProblems('q', { topic: 'a', text: 'x'.repeat(4001) }, null)).toEqual({
      text: 'too_long',
    });
  });

  it('ошибка и опечатка: обязательные поля, лишнее поле — ошибка', () => {
    expect(requestFormProblems('bug', { what: 'Не сохраняется' }, null)).toEqual({});
    expect(requestFormProblems('bug', { exp: 'Сохранится' }, null)).toEqual({ what: 'empty' });
    expect(requestFormProblems('typo', { was: 'Отчот', right: 'Отчёт' }, null)).toEqual({});
    expect(requestFormProblems('typo', { was: 'x', password: '1' }, null)).toEqual({
      password: 'unknown_field',
    });
    expect(requestFormProblems('typo', { was: 'x' }, 'type')).toEqual({ form: 'bad_form' });
  });

  it('справочник: форма из списка, выбор из значений, дата, комментарий', () => {
    expect(
      requestFormProblems('dict', { name: 'НДС', act: 'Сдача', note: 'нужно' }, 'type'),
    ).toEqual({});
    expect(requestFormProblems('dict', { name: 'НДС', act: 'Иногда' }, 'type')).toEqual({
      act: 'bad_option',
    });
    expect(requestFormProblems('dict', { name: 'Налог', from: '01.01.2027' }, 'tax')).toEqual({
      from: 'bad_date',
    });
    expect(requestFormProblems('dict', { name: 'x'.repeat(301) }, 'cat')).toEqual({
      name: 'too_long',
    });
    expect(requestFormProblems('dict', { name: 'x' }, null)).toEqual({ form: 'bad_form' });
    expect(requestFormProblems('dict', { name: 'x' }, 'nope' as never)).toEqual({
      form: 'bad_form',
    });
    expect(requestFormProblems('dict', { name: 'x' }, 'other')).toEqual({ dict: 'empty' });
  });

  it('тема — как в прототипе', () => {
    expect(requestTopic('q', { topic: ' Сроки ' }, null)).toBe('Сроки');
    expect(requestTopic('bug', { what: 'a'.repeat(100) }, null)).toBe(`${'a'.repeat(89)}…`);
    expect(requestTopic('typo', { was: 'Отчот' }, null)).toBe('«Отчот»');
    expect(requestTopic('dict', { code: '62.01.0', name: 'Программирование' }, 'gked')).toBe(
      '62.01.0 Программирование',
    );
    expect(requestTopic('dict', { name: 'Налог на роскошь' }, 'tax')).toBe('Налог на роскошь');
  });

  it('хранятся обрезанные значения без пустых и без темы вопроса', () => {
    expect(requestFormStored('q', { topic: 'T', text: ' Вопрос ', x: ' ' })).toEqual({
      text: 'Вопрос',
    });
    expect(requestClip('  a \n  b  ')).toBe('a b');
  });

  it('прежний справочник → форма (как reqFidOf прототипа)', () => {
    expect(requestFormOf('Налоговые органы (УГНС)')).toBe('ugns');
    expect(requestFormOf('Виды отчётов')).toBe('type');
    expect(requestFormOf('Налоговые льготы и особые статусы')).toBe('ben');
    expect(requestFormOf('Банковские провайдеры')).toBe('bank');
    expect(requestFormOf('Налоговые режимы')).toBe('tax');
    expect(requestFormOf('Формы собственности')).toBe('other');
    expect(requestFormOf(null)).toBe('other');
  });
});

describe('«Где»', () => {
  const where = {
    path: 'Отчёты для сдачи → На неделе → окно «Отметить отчёт сданным»',
    hash: '#reports.week?q=Иванов',
    ver: '169',
    br: 'Chrome 140',
    scr: '1280×800',
    at: '2026-11-28 10:15',
  };

  it('остаются только известные поля, адрес — без параметров поиска', () => {
    expect(requestWhereClean({ ...where, password: 'secret', amount: 1250 })).toEqual({
      ...where,
      hash: '#reports.week',
    });
  });

  it('чужие значения и длины отбрасываются, без пути — нет «Где»', () => {
    const got = requestWhereClean({
      ...where,
      hash: 'javascript:alert(1)',
      scr: 'big',
      at: 'вчера',
      ver: '<b>',
      path: `${'x'.repeat(400)}\u0000`,
    });
    expect(got).toMatchObject({ hash: '', scr: '', at: '', ver: '' });
    expect(got!.path).toHaveLength(300);
    expect(requestWhereClean({ ...where, path: ' ' })).toBeNull();
    expect(requestWhereClean('строка')).toBeNull();
    expect(requestWhereClean(null)).toBeNull();
  });
});
