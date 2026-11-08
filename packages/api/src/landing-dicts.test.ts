import {
  createTestDatabase,
  databaseAvailable,
  seedPhoneCodes,
  seedPlatformDictionaries,
} from '@buhuchet/db/testing';
import { describe, expect, it } from 'vitest';
import {
  LANDING_DICTS_TTL_MS,
  landingDictsLoader,
  readLandingDicts,
  type LandingDicts,
} from './landing-dicts';

const dicts = (regimes: number): LandingDicts => ({
  numbers: { reportTypes: 120, regimes },
  codes: [
    { cc: 'KG', flag: '🇰🇬', name: 'Кыргызстан', code: '996', mask: 'XXX XXX XXX', active: true },
  ],
  videos: [],
});

describe('справочники лендинга (задача #165)', () => {
  it('из базы — не чаще раза в минуту, потом заново: правка администратора доходит до лендинга', async () => {
    let calls = 0;
    const load = landingDictsLoader(async () => dicts((calls += 1)));
    expect((await load(0)).numbers.regimes).toBe(1);
    expect((await load(LANDING_DICTS_TTL_MS - 1)).numbers.regimes).toBe(1);
    expect(calls).toBe(1);
    expect((await load(LANDING_DICTS_TTL_MS)).numbers.regimes).toBe(2);
    expect(calls).toBe(2);
  });

  it('неудачное чтение не запоминается — следующее открытие спрашивает базу снова', async () => {
    let fail = true;
    const load = landingDictsLoader(async () => {
      if (fail) throw new Error('база недоступна');
      return dicts(7);
    });
    await expect(load(0)).rejects.toThrow('база недоступна');
    fail = false;
    expect((await load(1)).numbers.regimes).toBe(7);
  });

  it.skipIf(!databaseAvailable())(
    'числа и коды стран — из справочников платформы, роль приложения читает их без входа',
    async () => {
      const t = await createTestDatabase();
      try {
        await seedPlatformDictionaries(t.admin.db);
        await seedPhoneCodes(t.admin.db);
        const { numbers, codes } = await readLandingDicts(t.app.db);
        expect(numbers.reportTypes).toBeGreaterThan(100);
        expect(numbers.regimes).toBeGreaterThan(5);
        expect(codes[0]).toMatchObject({ cc: 'KG', code: '996', active: true });
      } finally {
        await t.drop();
      }
    },
  );
});
