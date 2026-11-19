import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpTip } from './help-tip';

describe('«?» с пояснением (прототип v131 `tipI`)', () => {
  it('кнопка «?» названа по тому, что она поясняет; сам текст до нажатия не нарисован', () => {
    const html = renderToStaticMarkup(
      <HelpTip label="К уплате" text="Сколько осталось заплатить по отчёту" />,
    );
    expect(html).toContain('aria-label="К уплате"');
    expect(html).toContain('<button');
    expect(html).not.toContain('Сколько осталось заплатить');
  });

  it('пояснения нет — нет и «?»', () => {
    expect(renderToStaticMarkup(<HelpTip label="К уплате" text="" />)).toBe('');
  });
});
