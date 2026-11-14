import { describe, expect, it } from 'vitest';
import { botMessageProblem, botPlainText, botRichHtml } from '../telegram/bot-message';
import {
  CAST_IMAGE_MAX_BYTES,
  CAST_PATHS,
  CAST_TEXT_MAX,
  CAST_TITLE_MAX,
  castBotMessage,
  castClip,
  castFromNews,
  castImageName,
  castImageProblem,
  castImageType,
  WEBHOOK_ERROR_FRESH_MS,
  webhookState,
} from './telegram';

const URL = 'https://test.buhuchet.kg/api/telegram/webhook';
const NOW = new Date('2026-11-01T04:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('состояние вебхука бота платформы (прототип TG_WH, задача 2.41)', () => {
  it('работает: наш адрес, ошибок нет или последняя — давно', () => {
    const ok = { ok: true, problem: null, lastError: null, actualUrl: null };
    expect(webhookState({ url: URL, lastErrorAt: null, lastError: null }, URL, NOW)).toEqual(ok);
    expect(
      webhookState(
        { url: URL, lastErrorAt: ago(WEBHOOK_ERROR_FRESH_MS + 1000), lastError: '502 Bad Gateway' },
        URL,
        NOW,
      ),
    ).toEqual(ok);
  });

  it('ошибка: свежая ошибка доставки — с текстом Telegram', () => {
    expect(
      webhookState(
        {
          url: URL,
          lastErrorAt: ago(5 * 60_000),
          lastError: 'Wrong response from the webhook: 502 Bad Gateway',
        },
        URL,
        NOW,
      ),
    ).toEqual({
      ok: false,
      problem: 'delivery',
      lastError: 'Wrong response from the webhook: 502 Bad Gateway',
      actualUrl: null,
    });
  });

  it('ошибка: бот не подключён, Telegram не ответил, вебхук не поставлен или на другом адресе', () => {
    expect(webhookState(null, URL, NOW).problem).toBe('no_bot');
    expect(webhookState('unreachable', URL, NOW).problem).toBe('unreachable');
    expect(webhookState({ url: '', lastErrorAt: null, lastError: null }, URL, NOW).problem).toBe(
      'not_set',
    );
    expect(
      webhookState(
        { url: 'https://buhuchet.kg/api/telegram/webhook', lastErrorAt: null, lastError: null },
        URL,
        NOW,
      ),
    ).toEqual({
      ok: false,
      problem: 'other_url',
      lastError: null,
      actualUrl: 'https://buhuchet.kg/api/telegram/webhook',
    });
  });
});

describe('оформленная рассылка (поток Т, задача Т6; прототип v103 admin/tg-cast.js)', () => {
  const bytes = (head: number[], n = 32) => {
    const b = new Uint8Array(n);
    b.set(head);
    return b;
  };
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPG = [0xff, 0xd8, 0xff];
  const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

  it('тип картинки — по первым байтам: JPG, PNG, WebP; GIF, SVG и обрезанный файл — нет', () => {
    expect(castImageType(bytes(PNG))).toBe('image/png');
    expect(castImageType(bytes(JPG))).toBe('image/jpeg');
    expect(castImageType(bytes(WEBP))).toBe('image/webp');
    expect(castImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(
      castImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(castImageType(new Uint8Array(PNG))).toBeNull();
    expect(castImageName('image/jpeg')).toBe('image.jpg');
    expect(castImageName('image/webp')).toBe('image.webp');
  });

  it('картинка: сначала размер (больше 2 МБ), затем тип', () => {
    expect(castImageProblem(bytes(PNG))).toBeNull();
    expect(castImageProblem(bytes(PNG, CAST_IMAGE_MAX_BYTES))).toBeNull();
    expect(castImageProblem(bytes(PNG, CAST_IMAGE_MAX_BYTES + 1))).toBe('cast_image_too_large');
    expect(castImageProblem(bytes([1, 2, 3]))).toBe('cast_image_type');
  });

  it('«Заполнить из новости»: заголовок до 80, текст до 900 с многоточием, видео — только доступное', () => {
    const news = { id: 'n1', title: 'З'.repeat(100), short: 'Коротко', video: 'v1' };
    expect(castFromNews(news, () => true)).toEqual({
      title: `${'З'.repeat(CAST_TITLE_MAX - 1)}…`,
      text: 'Коротко',
      more: { kind: 'news', id: 'n1' },
      video: 'v1',
    });
    expect(castFromNews({ ...news, video: 'v1' }, () => false).video).toBeNull();
    expect(castFromNews({ ...news, video: null }, () => true).video).toBeNull();
    expect(castClip('т'.repeat(CAST_TEXT_MAX + 5), CAST_TEXT_MAX)).toHaveLength(CAST_TEXT_MAX);
    expect(castClip('  коротко  ', 10)).toBe('коротко');
  });

  it('сообщение: картинка, заголовок, текст и кнопки только https; разметка из текста не выполняется', () => {
    const image = '0b7f8a52-8a36-4a8e-9a43-1f1f4b7a1c11';
    const m = castBotMessage({
      title: 'Работы <b>',
      text: 'Текст & ссылка <a href="x">',
      image,
      more: { text: 'Подробнее', url: 'https://test.buhuchet.kg' + CAST_PATHS.news('n 1') },
      video: { text: 'Смотреть видео', url: 'http://localhost/app/kb/video?video=v1' },
    });
    expect(m).toEqual({
      heading: 'Работы <b>',
      text: 'Текст & ссылка <a href="x">',
      image,
      buttons: [[{ text: 'Подробнее', url: 'https://test.buhuchet.kg/app/kb/news?news=n%201' }]],
    });
    expect(botMessageProblem(m)).toBeNull();
    expect(botPlainText(m)).toBe('Работы <b>\nТекст & ссылка <a href="x">');
    expect(botRichHtml(m)).toBe('<b>Работы &lt;b&gt;</b>\nТекст &amp; ссылка &lt;a href="x"&gt;');
    // Без заголовка, картинки и кнопок — просто текст.
    expect(castBotMessage({ title: '', text: 'Т', image: null, more: null, video: null })).toEqual({
      text: 'Т',
    });
    // Заголовок 80 и текст 900 помещаются в подпись к картинке (1024).
    const full = castBotMessage({
      title: 'з'.repeat(CAST_TITLE_MAX),
      text: 'т'.repeat(CAST_TEXT_MAX),
      image,
      more: null,
      video: null,
    });
    expect(botMessageProblem(full)).toBeNull();
    expect(botMessageProblem({ ...full, image: 'не-номер' })).toBe('номер картинки');
    expect(botMessageProblem({ ...full, text: 'т'.repeat(1000) })).toBe(
      'подпись к картинке длиннее 1024 знаков',
    );
    expect(botMessageProblem({ ...full, tables: [{ rows: [['a', 'b']] }] })).toBe(
      'у сообщения с картинкой нет таблиц',
    );
  });
});
