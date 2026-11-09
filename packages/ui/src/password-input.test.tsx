import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { passwordDots, passwordEye, PasswordInput, PasswordText } from './password-input';

// Глаз в поле пароля (прототип v82 pwInp, pwTxt, pwEyeBtn): разметка — renderToStaticMarkup,
// переключение — правило `passwordEye`.

const LABELS = { show: 'Показать пароль', hide: 'Скрыть пароль' };

describe('PasswordInput — поле пароля с глазом', () => {
  it('скрыто по умолчанию: type="password", глаз «Показать пароль», связан с полем', () => {
    const html = renderToStaticMarkup(
      <PasswordInput id="lg-pass" labels={LABELS} autoComplete="current-password" />,
    );
    expect(html).toContain('id="lg-pass"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('aria-controls="lg-pass"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Показать пароль"');
    expect(html).toContain('title="Показать пароль"');
    // Глаз — кнопка, а не отправка формы; место под глазом в поле и 44 px на сенсорном экране.
    expect(html).toContain('type="button"');
    expect(html).toContain('pr-[42px]');
    expect(html).toContain('pointer-coarse:w-11');
  });

  it('временный пароль виден сразу (open): type="text", глаз «Скрыть пароль»', () => {
    const html = renderToStaticMarkup(
      <PasswordInput id="ne-pass" labels={LABELS} open mono defaultValue="Bh-4821-temp" />,
    );
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Скрыть пароль"');
    expect(html).toContain('font-mono');
  });

  it('глаз: открыт — перечёркнутый и «Скрыть пароль», закрыт — глаз и «Показать пароль»', () => {
    expect(passwordEye(false, LABELS)).toEqual({ icon: 'eye', label: 'Показать пароль' });
    expect(passwordEye(true, LABELS)).toEqual({ icon: 'eyeoff', label: 'Скрыть пароль' });
  });
});

describe('PasswordText — временный пароль текстом («Пароль сброшен»)', () => {
  it('виден сразу; пароль — в data-temporary-password', () => {
    const html = renderToStaticMarkup(
      <PasswordText value="Bh-4821-temp" labels={LABELS} id="rp-v" />,
    );
    expect(html).toMatch(/<b id="rp-v" data-temporary-password=""[^>]*>Bh-4821-temp<\/b>/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Скрыть пароль"');
  });

  it('скрытый — точки по длине, не меньше восьми', () => {
    expect(passwordDots('abc')).toBe('••••••••');
    expect(passwordDots('Bh-4821-temp-12')).toBe('•'.repeat(15));
  });
});
