import { describe, expect, it } from 'vitest';
import { botMessageProblem, botPlainText, findBotButton } from './bot-message';
import {
  LEAD_BOT_ACTIONS,
  LEAD_BOT_REASON_MAX,
  leadBotCanRefuse,
  leadBotCanWork,
  leadBotFirm,
  leadBotMessage,
  leadBotReason,
  type LeadBotInput,
} from './lead-bot';

// Заявка с сайта в Telegram — с кнопками (поток Т, задача Т6; прототип v103 admin/tg-leads.js, `leadMsg`).

const ID = '3f1a52c0-8a2c-4b7e-9d59-0a1b2c3d4e5f';
const input = (over: Partial<LeadBotInput> = {}): LeadBotInput => ({
  id: ID,
  firm: 'ОсОО «Учёт Плюс»',
  name: 'Айгуль Садыкова',
  phone: '+996 555 123 456',
  size: '21–50',
  status: 'new',
  statusName: 'Новая',
  repeat: false,
  stand: false,
  link: 'https://buhuchet.kg/app/orgs/leads',
  plain: '📩 Новая заявка с сайта: ОсОО «Учёт Плюс»',
  texts: {
    head: 'Новая заявка с сайта',
    work: 'Взять в работу',
    no: 'Отклонить',
    open: 'Открыть в Админке',
    firm: 'Фирма',
    size: 'Контрагентов',
    contact: 'Контакт',
    status: 'Статус',
  },
  ...over,
});

describe('сообщение о заявке с сайта', () => {
  it('новая заявка: заголовок, таблица «Фирма / Контрагентов / Контакт», кнопки «Взять в работу», «Отклонить» и ссылка', () => {
    const m = leadBotMessage(input());
    expect(m).toEqual({
      heading: 'Новая заявка с сайта',
      plain: '📩 Новая заявка с сайта: ОсОО «Учёт Плюс»',
      tables: [
        {
          rows: [
            ['Фирма', 'ОсОО «Учёт Плюс»'],
            ['Контрагентов', '21–50'],
            ['Контакт', 'Айгуль Садыкова, +996 555 123 456'],
          ],
        },
      ],
      buttons: [
        [
          { text: 'Взять в работу', action: 'leadWork', arg: ID },
          { text: 'Отклонить', action: 'leadNo', arg: ID },
        ],
        [{ text: 'Открыть в Админке', url: 'https://buhuchet.kg/app/orgs/leads' }],
      ],
    });
    expect(botMessageProblem(m)).toBeNull();
    // Простой текст — прежнее сообщение одной строкой; кнопки остаются в обоих видах.
    expect(botPlainText(m)).toBe('📩 Новая заявка с сайта: ОсОО «Учёт Плюс»');
    expect(findBotButton(m, LEAD_BOT_ACTIONS.work, ID)).toBeTruthy();
  });

  it('повторная заявка: строка «Статус»; кнопки — по статусу сохранённой заявки', () => {
    const taken = leadBotMessage(
      input({ repeat: true, status: 'in_progress', statusName: 'В работе' }),
    );
    expect(taken.tables![0]!.rows.at(-1)).toEqual(['Статус', 'В работе']);
    expect(taken.buttons![0]).toEqual([{ text: 'Отклонить', action: 'leadNo', arg: ID }]);
    for (const status of ['connected', 'rejected'] as const) {
      const closed = leadBotMessage(input({ repeat: true, status, statusName: 'x' }));
      expect(closed.buttons).toEqual([
        [{ text: 'Открыть в Админке', url: 'https://buhuchet.kg/app/orgs/leads' }],
      ]);
    }
  });

  it('заявка со стенда — с пометкой перед заголовком; ссылка — только у сайта по https', () => {
    expect(leadBotMessage(input({ stand: true })).heading).toBe(
      '🧪 Тестовый стенд · Новая заявка с сайта',
    );
    for (const link of [null, 'http://localhost:3000/app/orgs/leads', 'javascript:alert(1)']) {
      const m = leadBotMessage(input({ link }));
      expect(m.buttons).toHaveLength(1);
      expect(botMessageProblem(m)).toBeNull();
    }
    const closed = leadBotMessage(input({ link: null, status: 'rejected' }));
    expect(closed.buttons).toBeUndefined();
    expect(botMessageProblem(closed)).toBeNull();
  });

  it('длинные поля формы режутся, пустое «клиентов» — прочерк', () => {
    const m = leadBotMessage(input({ firm: 'Ф'.repeat(500), size: '' }));
    const rows = m.tables![0]!.rows;
    expect(rows[0]![1]!.length).toBe(200);
    expect(rows[0]![1]!.endsWith('…')).toBe(true);
    expect(rows[1]).toEqual(['Контрагентов', '—']);
    expect(leadBotFirm('Ф'.repeat(100)).length).toBe(60);
    expect(leadBotFirm('ОсОО «Альфа»')).toBe('ОсОО «Альфа»');
  });
});

describe('правила кнопок заявки', () => {
  it('«Взять в работу» — только у новой; «Отклонить» — у новой и в работе', () => {
    expect(
      (['new', 'in_progress', 'connected', 'rejected'] as const).map((s) => [
        leadBotCanWork(s),
        leadBotCanRefuse(s),
      ]),
    ).toEqual([
      [true, true],
      [false, true],
      [false, false],
      [false, false],
    ]);
  });

  it('причина отказа: одной строкой, без скобок и управляющих знаков, до 300 знаков; пустая — причины нет', () => {
    expect(leadBotReason('  нужна программа\n(с проводками)  ')).toBe(
      'нужна программа с проводками',
    );
    expect(leadBotReason('()')).toBe('');
    expect(leadBotReason(' ​\n ')).toBe('');
    expect(leadBotReason('я'.repeat(400))).toHaveLength(LEAD_BOT_REASON_MAX);
    // Знак из двух единиц (эмодзи) пополам не режется.
    expect(leadBotReason('😀'.repeat(400))).toBe('😀'.repeat(300));
  });
});
