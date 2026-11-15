import { MESSAGE_TEMPLATE_ORDER, MESSAGE_TEMPLATE_VARIABLES } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { AdminMessageTemplatesForm, MESSAGE_TEMPLATES_FORM_MAX } from './admin-system';

describe('Админка → «Шаблоны»: «Сохранить шаблоны» шлёт все шаблоны разом', () => {
  it('все шаблоны справочника проходят схему — с запасом на следующие версии прототипа', () => {
    // MESSAGE_TEMPLATE_ORDER сверен с refDB.messageTemplates тестом домена (admin-system.test.ts).
    expect(MESSAGE_TEMPLATE_ORDER.length * 2).toBeLessThanOrEqual(MESSAGE_TEMPLATES_FORM_MAX);
    const items = MESSAGE_TEMPLATE_ORDER.map((key) => ({
      key,
      text: MESSAGE_TEMPLATE_VARIABLES[key]?.length
        ? `{${MESSAGE_TEMPLATE_VARIABLES[key]![0]}}`
        : 'x',
      version: 1,
    }));
    expect(AdminMessageTemplatesForm.safeParse({ items }).success).toBe(true);
  });
});
