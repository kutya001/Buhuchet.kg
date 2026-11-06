import { readFileSync } from 'node:fs';
import { PLATFORM_CRON_ENTRIES } from '@buhuchet/adapters/scheduler';
import { describe, expect, it } from 'vitest';

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

  it('Vercel Cron будит только /api/cron/tick раз в минуту', () => {
    expect(config.crons).toEqual(PLATFORM_CRON_ENTRIES);
  });

  // Регион функций — в настройках каждого проекта Vercel (Settings → Functions → Function Region):
  // стенд buhuchet-kg — dub1 (база в Дублине), рабочий сайт buhuchet — fra1 (база во Франкфурте).
  // «regions» в vercel.json перекрыл бы обе настройки одним регионом.
  it('регион функций не задан в vercel.json — у каждого проекта свой', () => {
    expect(config).not.toHaveProperty('regions');
  });
});
