import { describe, expect, it } from 'vitest';
import { SESSION_DEVICE_MAX, sessionDevice } from './device';

describe('устройство сеанса по заголовку браузера', () => {
  it('браузер и система, как в прототипе: «Chrome 130 · Windows…», «Safari 18 · iOS 18 (iPhone)»', () => {
    expect(
      sessionDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 130 · Windows 10 или 11');
    expect(
      sessionDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 18 · iOS 18 (iPhone)');
    expect(
      sessionDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      ),
    ).toBe('Safari 18 · macOS 10.15');
  });

  it('браузеры на движке Chrome узнаются раньше самого Chrome', () => {
    const tail = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0';
    expect(
      sessionDevice(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${tail} YaBrowser/24.10.0 Safari/537.36`),
    ).toBe('Яндекс Браузер 24 · Windows 10 или 11');
    expect(
      sessionDevice(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${tail} Safari/537.36 Edg/130.0.0.0`),
    ).toBe('Edge 130 · Windows 10 или 11');
    expect(
      sessionDevice(`Mozilla/5.0 (Linux; Android 14; SM-A546B) ${tail} Mobile Safari/537.36`),
    ).toBe('Chrome 130 · Android 14');
    expect(
      sessionDevice('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0'),
    ).toBe('Firefox 132 · Linux');
  });

  it('узнано только одно — только оно; ничего не узнано или заголовка нет — пусто', () => {
    expect(sessionDevice('curl/8.5.0')).toBeNull();
    expect(sessionDevice('')).toBeNull();
    expect(sessionDevice(null)).toBeNull();
    expect(sessionDevice(undefined)).toBeNull();
    expect(sessionDevice('SomeBot/1.0 (Linux)')).toBe('Linux');
  });

  it('длинный или подделанный заголовок не даёт подпись длиннее предела и разметку', () => {
    const label = sessionDevice(`Chrome/${'9'.repeat(400)} <script>alert(1)</script> Windows NT 10.0`);
    expect(label === null || label.length <= SESSION_DEVICE_MAX).toBe(true);
    expect(label ?? '').not.toContain('<');
  });
});
