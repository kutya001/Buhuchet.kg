import { readFileSync } from 'node:fs';
import { PLATFORM_CRON_ENTRIES } from '@buhuchet/adapters/scheduler';
import { describe, expect, it } from 'vitest';

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

  it('Vercel Cron будит только /api/cron/tick раз в минуту', () => {
    expect(config.crons).toEqual(PLATFORM_CRON_ENTRIES);
  });

  it('функции во Франкфурте, рядом с базой', () => {
    expect(config.regions).toEqual(['fra1']);
  });
});
