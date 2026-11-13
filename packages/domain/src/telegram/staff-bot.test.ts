import { describe, expect, it } from 'vitest';
import {
  asBotMessage,
  askBotMessage,
  BOT_ASK_CANCEL,
  botAskLive,
  botKeyboard,
  botMessageProblem,
  closeBotAsk,
  sameBotAsk,
  type BotMessage,
} from './bot-message';
import {
  BOT_RETURN_REASON_MAX,
  botDayMonth,
  botDueText,
  botReturnReason,
  confirmBotMessage,
  fixBotMessage,
  moreOnSiteMessage,
  reportBotMessage,
  STAFF_BOT_ACTIONS,
  STAFF_BOT_BUTTONS_MAX,
  taskBotMessage,
} from './staff-bot';

// Действия сотрудника из чата бота (поток Т, задача Т2; прототип v97 modules/tg-staff.js, tg-chat.js).
const ID = '7d9f6a52-3b1c-4c8e-9a41-5e2f0b7c6d10';
const URL = 'https://buhuchet.kg/app/reports/all?report=' + ID;
const due = {
  due: (date: string) => `срок ${date}`,
  over: (n: number) => `просрочен на ${n} дн.`,
  today: 'сегодня последний день',
  ahead: (n: number) => `через ${n} дн.`,
};

describe('просьба бота прислать файл или текст', () => {
  const ask = askBotMessage(
    'Пришлите файл.',
    {
      action: 'repFile',
      arg: ID,
      kind: 'file',
      day: '2026-11-13',
      src: { messageId: 7, action: 'repDone' },
    },
    'Отмена',
  );

  it('под просьбой — «Отмена»; сообщение проходит проверку и читается из базы без потерь', () => {
    expect(botKeyboard(ask)).toEqual([[{ text: 'Отмена', data: BOT_ASK_CANCEL }]]);
    expect(botMessageProblem(ask)).toBeNull();
    expect(asBotMessage(JSON.parse(JSON.stringify(ask)))).toEqual(ask);
    expect(botMessageProblem({ ...ask, ask: { ...ask.ask!, action: 'Плохое действие' } })).toBe(
      'просьба бота: действие или запись',
    );
  });

  it('записи с испорченной просьбой — не сообщение бота', () => {
    for (const bad of [
      { kind: 'file' },
      { action: 'repFile', kind: 'video' },
      { action: 'repFile', kind: 'file', day: 20261113 },
      { action: 'repFile', kind: 'file', src: { messageId: '7', action: 'repDone' } },
      'repFile',
    ]) {
      expect(asBotMessage({ text: 'Пришлите файл.', ask: bad })).toBeNull();
    }
  });

  it('бот ждёт до конца дня; просьба без дня ждёт, пока её не закроют', () => {
    expect(botAskLive(ask, '2026-11-13')).toBe(true);
    expect(botAskLive(ask, '2026-11-14')).toBe(false);
    const open: BotMessage = {
      text: 'Ответьте на это сообщение.',
      ask: { action: 'cpAsk', kind: 'text' },
    };
    expect(botAskLive(open, '2030-01-01')).toBe(true);
    expect(botAskLive({ text: 'Обычное сообщение' }, '2026-11-13')).toBe(false);
  });

  it('та же просьба — то же действие с той же записью', () => {
    expect(sameBotAsk(ask, 'repFile', ID)).toBe(true);
    expect(sameBotAsk(ask, 'repFile', null)).toBe(false);
    expect(sameBotAsk(ask, 'taskFile', ID)).toBe(false);
    expect(sameBotAsk({ text: 'x', ask: { action: 'cpAsk', kind: 'text' } }, 'cpAsk', '')).toBe(
      true,
    );
    expect(sameBotAsk({ text: 'x' }, 'repFile', ID)).toBe(false);
  });

  it('после ответа или отмены бот не ждёт, «Отмена» гаснет, остальные кнопки остаются', () => {
    const withLink: BotMessage = {
      ...ask,
      buttons: [[...ask.buttons![0]!, { text: 'Открыть', url: URL }]],
    };
    const closed = closeBotAsk(withLink);
    expect(botAskLive(closed, '2026-11-13')).toBe(false);
    expect(closed.ask).toEqual({ ...ask.ask, off: true });
    expect(botKeyboard(closed)).toEqual([
      [
        { text: 'Отмена', data: 'off', disabled: true },
        { text: 'Открыть', url: URL },
      ],
    ]);
    const plain: BotMessage = { text: 'Обычное сообщение' };
    expect(closeBotAsk(plain)).toBe(plain);
    expect(closeBotAsk({ text: 'x', ask: { action: 'cpAsk', kind: 'text' } })).toEqual({
      text: 'x',
      ask: { action: 'cpAsk', kind: 'text', off: true },
    });
  });
});

describe('сообщения сотруднику с кнопками', () => {
  it('срок словами: просрочен, сегодня, через N дней (прототип tgDueTxt)', () => {
    expect(botDayMonth('2026-11-13')).toBe('13.11');
    expect(botDueText('2026-11-10', '2026-11-13', due)).toBe('срок 10.11 · просрочен на 3 дн.');
    expect(botDueText('2026-11-13', '2026-11-13', due)).toBe('срок 13.11 · сегодня последний день');
    expect(botDueText('2026-11-20', '2026-11-13', due)).toBe('срок 20.11 · через 7 дн.');
  });

  it('отчёт: «В работе» — только у «К сдаче»; без https-адреса сайта «Открыть» нет', () => {
    const labels = { work: 'В работе', done: 'Сдан', open: 'Открыть' };
    const r = { id: ID, name: 'НДС за октябрь 2026', contractor: 'ОсОО «Ромашка»', todo: true };
    const m = reportBotMessage(r, 'срок 13.11 · сегодня последний день', labels, URL);
    expect(m).toEqual({
      heading: 'НДС за октябрь 2026',
      sub: 'ОсОО «Ромашка» · срок 13.11 · сегодня последний день',
      buttons: [
        [
          { text: 'В работе', action: 'repWork', arg: ID },
          { text: 'Сдан', action: 'repDone', arg: ID },
          { text: 'Открыть', url: URL },
        ],
      ],
    });
    expect(botMessageProblem(m)).toBeNull();
    expect(
      reportBotMessage({ ...r, todo: false }, 'срок', labels, null).buttons![0]!.map((b) => b.text),
    ).toEqual(['Сдан']);
  });

  it('подтверждение сдачи и возврат «На исправление»', () => {
    const conf = confirmBotMessage(
      { id: ID, name: 'НДС за октябрь 2026', contractor: 'ОсОО «Ромашка»' },
      'сдан 13.11, Иванов И.',
      { ok: 'Подтвердить', back: 'Вернуть', open: 'Открыть' },
      URL,
    );
    expect(conf.sub).toBe('ОсОО «Ромашка» · сдан 13.11, Иванов И.');
    expect(conf.buttons![0]!.map((b) => b.action ?? 'url')).toEqual(['confOk', 'confBack', 'url']);
    expect(botMessageProblem(conf)).toBeNull();
    const fix = fixBotMessage(ID, '↩️ На исправление: …', { done: 'Сдан', open: 'Открыть' }, null);
    expect(fix).toEqual({
      text: '↩️ На исправление: …',
      buttons: [[{ text: 'Сдан', action: STAFF_BOT_ACTIONS.reportDone, arg: ID }]],
    });
  });

  it('задача: «Взять в работу» — только у «К выполнению», «Открыть задачу» — отдельным рядом', () => {
    const labels = { work: 'Взять в работу', done: 'Выполнена', open: 'Открыть задачу' };
    const task = { id: ID, title: 'Сверить акт', todo: true };
    const m = taskBotMessage(task, 'Новая задача от Иванов И. · срок 20.11.2026', labels, URL);
    expect(m.heading).toBe('Сверить акт');
    expect(m.buttons).toEqual([
      [
        { text: 'Взять в работу', action: 'taskWork', arg: ID },
        { text: 'Выполнена', action: 'taskDone', arg: ID },
      ],
      [{ text: 'Открыть задачу', url: URL }],
    ]);
    expect(botMessageProblem(m)).toBeNull();
    expect(taskBotMessage({ ...task, todo: false }, 'x', labels, null).buttons).toEqual([
      [{ text: 'Выполнена', action: 'taskDone', arg: ID }],
    ]);
  });

  it('«ещё на сайте» — с кнопкой-ссылкой; предел кнопок — 10', () => {
    expect(STAFF_BOT_BUTTONS_MAX).toBe(10);
    expect(moreOnSiteMessage('Ещё 3 — на сайте.', 'Открыть отчёты на сайте', URL)).toEqual({
      text: 'Ещё 3 — на сайте.',
      buttons: [[{ text: 'Открыть отчёты на сайте', url: URL }]],
    });
    expect(moreOnSiteMessage('Ещё 3 — на сайте.', 'Открыть', null)).toEqual({
      text: 'Ещё 3 — на сайте.',
    });
  });

  it('причина возврата: одной строкой, без скобок и невидимых знаков, не длиннее 500', () => {
    expect(botReturnReason('  Нет (квитанции)\nо   приёме ')).toBe('Нет квитанции о приёме');
    expect(botReturnReason(' ( ) ​\n')).toBe('');
    expect(botReturnReason('а'.repeat(600))).toHaveLength(BOT_RETURN_REASON_MAX);
    // Знак из двух кодовых единиц на границе не режется пополам.
    const cut = botReturnReason('а'.repeat(499) + '😀😀');
    expect([...cut]).toHaveLength(500);
    expect(cut.endsWith('😀')).toBe(true);
  });
});
