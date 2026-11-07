import { databaseAvailable } from '@buhuchet/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Подробности «здоровья» и описание API — только администратору платформы (docs/deviations.md п. О-9).
describe.skipIf(!databaseAvailable())('подробности «здоровья» и описание API', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('сотруднику организации, даже владельцу, — 403; администратору платформы — 200', async () => {
    for (const path of ['/api/admin/health', '/api/openapi.json']) {
      expect((await apiRequest(f.app, 'GET', path, owner)).status, path).toBe(403);
      expect((await apiRequest(f.app, 'GET', path, admin)).status, path).toBe(200);
    }
  });
});
