import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from './files';
import {
  acceptedFileName,
  SENT_FILE_MESSAGES,
  sentFileDaysLeft,
  sentFileNote,
  sentFilePurgeUpTo,
  sentFileReason,
  sentFileRefusalText,
  sentFilesSendRefusal,
} from './sent';
import {
  SENT_FILE_COMMENT_MAX,
  SENT_FILE_KEEP_DAYS,
  SENT_FILE_REASON_MAX,
  SENT_FILES_PER_DAY,
  SENT_FILES_PER_SEND,
} from './sent-files';

const f = (name: string, size = 1000) => ({ name, size });

describe('файлы от контрагентов: отправка', () => {
  it('пределы — как в прототипе v112: 10 за раз, 20 за сутки, 30 дней, 300 знаков', () => {
    expect([
      SENT_FILES_PER_SEND,
      SENT_FILES_PER_DAY,
      SENT_FILE_KEEP_DAYS,
      SENT_FILE_COMMENT_MAX,
      SENT_FILE_REASON_MAX,
    ]).toEqual([10, 20, 30, 300, 300]);
  });

  it('ни одного файла, больше 10 за раз', () => {
    expect(sentFilesSendRefusal([], 0)).toEqual({ code: 'sent_none' });
    const eleven = Array.from({ length: 11 }, (_, i) => f(`a${i}.pdf`));
    expect(sentFilesSendRefusal(eleven, 0)).toEqual({ code: 'sent_too_many' });
    expect(sentFilesSendRefusal(eleven.slice(0, 10), 0)).toBeNull();
  });

  it('файл больше 20 МБ и запрещённый тип — с именами файлов, размер проверяется раньше типа', () => {
    expect(sentFilesSendRefusal([f('a.pdf'), f('big.pdf', FILE_MAX_BYTES + 1)], 0)).toEqual({
      code: 'sent_too_large',
      files: ['big.pdf'],
    });
    expect(sentFilesSendRefusal([f('a.exe'), f('b.html'), f('c.pdf')], 0)).toEqual({
      code: 'sent_forbidden',
      files: ['a.exe', 'b.html'],
    });
    expect(sentFilesSendRefusal([f('big.exe', FILE_MAX_BYTES + 1)], 0)?.code).toBe(
      'sent_too_large',
    );
    expect(sentFilesSendRefusal([f('a/b.pdf')], 0)).toEqual({
      code: 'sent_name_invalid',
      files: ['a/b.pdf'],
    });
    expect(sentFilesSendRefusal([f('ровно.pdf', FILE_MAX_BYTES)], 0)).toBeNull();
  });

  // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
  it('документы с макросами от контрагента не принимаются; обычные документы и таблицы — да', () => {
    expect(sentFilesSendRefusal([f('Расчёт.xlsm'), f('Договор.DOCM'), f('Отчёт.xlsx')], 0)).toEqual(
      { code: 'sent_forbidden', files: ['Расчёт.xlsm', 'Договор.DOCM'] },
    );
    // Надстройки — всегда код.
    expect(sentFilesSendRefusal([f('Помощник.xla'), f('Шаблон.ppa')], 0)).toEqual({
      code: 'sent_forbidden',
      files: ['Помощник.xla', 'Шаблон.ppa'],
    });
    expect(sentFilesSendRefusal([f('Отчёт.xlsx'), f('Договор.docx'), f('Акт.xls')], 0)).toBeNull();
  });

  it('не больше 20 файлов за сутки: сколько осталось или «попробуйте завтра»', () => {
    expect(sentFilesSendRefusal([f('a.pdf'), f('b.pdf')], 18)).toBeNull();
    expect(sentFilesSendRefusal([f('a.pdf'), f('b.pdf'), f('c.pdf')], 18)).toEqual({
      code: 'sent_day_left',
      n: 2,
    });
    expect(sentFilesSendRefusal([f('a.pdf')], 20)).toEqual({ code: 'sent_day_limit' });
    expect(sentFilesSendRefusal([f('a.pdf')], 25)).toEqual({ code: 'sent_day_limit' });
  });

  it('тексты отказов с подстановками — как в прототипе', () => {
    expect(sentFileRefusalText({ code: 'sent_day_left', n: 3 })).toBe(
      'За сутки можно отправить не больше 20 файлов. Сегодня осталось: 3',
    );
    expect(sentFileRefusalText({ code: 'sent_forbidden', files: ['a.exe', 'b.js'] })).toBe(
      'Такие файлы не принимаются: a.exe, b.js',
    );
    expect(sentFileRefusalText({ code: 'sent_none' })).toBe(SENT_FILE_MESSAGES.sent_none);
  });

  it('комментарий — одной строкой и не длиннее 300 знаков', () => {
    expect(sentFileNote('  Выписка\nза   октябрь\t ')).toBe('Выписка за октябрь');
    expect(sentFileNote('я'.repeat(400))).toHaveLength(300);
    expect(sentFileNote('')).toBe('');
  });
});

describe('файлы от контрагентов: решение бухгалтера', () => {
  it('причина отказа обязательна, одной строкой, до 300 знаков', () => {
    expect(sentFileReason('   \n ')).toEqual({ problem: 'sent_reason_empty' });
    expect(sentFileReason('Не тот\nмесяц ')).toEqual({ reason: 'Не тот месяц' });
    expect(sentFileReason('я'.repeat(300))).toEqual({ reason: 'я'.repeat(300) });
    expect(sentFileReason('я'.repeat(301))).toEqual({ problem: 'sent_reason_long' });
  });

  it('принятый файл с занятым именем получает « (2)», « (3)» перед расширением', () => {
    expect(acceptedFileName('Акт.pdf', ['Договор.pdf'])).toBe('Акт.pdf');
    expect(acceptedFileName('Акт.pdf', ['Акт.pdf'])).toBe('Акт (2).pdf');
    expect(acceptedFileName('акт.PDF', ['Акт.pdf', 'Акт (2).pdf'])).toBe('акт (3).PDF');
    expect(acceptedFileName('README', ['README'])).toBe('README (2)');
    expect(acceptedFileName('архив.tar.gz', ['архив.tar.gz'])).toBe('архив.tar (2).gz');
  });

  it('имя с « (2)» не длиннее 255 знаков: название укорачивается, расширение остаётся', () => {
    const long = 'я'.repeat(251) + '.pdf';
    const next = acceptedFileName(long, [long]);
    expect(next).toHaveLength(255);
    expect(next.endsWith(' (2).pdf')).toBe(true);
  });
});

describe('файлы от контрагентов: удаление через 30 дней', () => {
  it('«Удалится через N дн.» — 30 минус прошедшие дни по Бишкеку, не меньше нуля; у принятого — нет', () => {
    expect(sentFileDaysLeft({ status: 'new', sentDate: '2026-11-15' }, '2026-11-15')).toBe(30);
    expect(sentFileDaysLeft({ status: 'new', sentDate: '2026-11-14' }, '2026-11-15')).toBe(29);
    expect(sentFileDaysLeft({ status: 'rejected', sentDate: '2026-10-29' }, '2026-11-15')).toBe(13);
    expect(sentFileDaysLeft({ status: 'rejected', sentDate: '2026-10-01' }, '2026-11-15')).toBe(0);
    expect(
      sentFileDaysLeft({ status: 'accepted', sentDate: '2026-01-01' }, '2026-11-15'),
    ).toBeNull();
  });

  it('задача по расписанию удаляет отправленные 30 и более дней назад', () => {
    expect(sentFilePurgeUpTo('2026-11-15')).toBe('2026-10-16');
    // отправлен 16.10 — 15.11 у него «0 дней», в этот день он удаляется; отправленный 17.10 — ещё нет
    expect(sentFileDaysLeft({ status: 'new', sentDate: '2026-10-16' }, '2026-11-15')).toBe(0);
    expect(sentFileDaysLeft({ status: 'new', sentDate: '2026-10-17' }, '2026-11-15')).toBe(1);
    expect(sentFilePurgeUpTo('2026-03-01')).toBe('2026-01-30');
  });
});
