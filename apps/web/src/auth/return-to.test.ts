import { describe, expect, it } from 'vitest';
import { withCardHash } from './return-to';

// Ссылка на карточку в Админке (`#accounts/<логин>`) переживает вход: прототип v83, admin-cards.js.

describe('адрес после входа со ссылкой на карточку', () => {
  it('ссылка на карточку переносится на страницу после входа', () => {
    expect(withCardHash('/app/accounts', '#accounts/asanov')).toBe('/app/accounts#accounts/asanov');
    expect(withCardHash('/app/orgs', '#orgs/demo-firm')).toBe('/app/orgs#orgs/demo-firm');
    expect(withCardHash('/app/accounts', '#accounts/%D0%B0')).toBe('/app/accounts#accounts/%D0%B0');
  });

  it('другой текст после «#» и адрес со своим «#» не меняются', () => {
    expect(withCardHash('/app', '')).toBe('/app');
    expect(withCardHash('/app', '#top')).toBe('/app');
    expect(withCardHash('/app', '#accounts/a b')).toBe('/app');
    expect(withCardHash('/app/accounts#x', '#accounts/asanov')).toBe('/app/accounts#x');
  });
});
