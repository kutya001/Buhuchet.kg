import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { fileHistoryText } from './file-history';

describe('записи истории о файле (прототип v95 fileEditDlg, fNoteLog)', () => {
  const t = makeTranslate(defaultUiTexts());

  it('прикрепление: с примечанием — «Прикреплён файл: … Примечание: …», без него текст даёт карточка', () => {
    expect(
      fileHistoryText(t, {
        action: 'file_attach',
        changes: [
          { field: 'file', to: 'Акт.pdf' },
          { field: 'note', to: 'Скан с печатью' },
        ],
      }),
    ).toBe('Прикреплён файл: Акт.pdf. Примечание: Скан с печатью');
    expect(
      fileHistoryText(t, { action: 'file_attach', changes: [{ field: 'file', to: 'Акт.pdf' }] }),
    ).toBeNull();
    expect(
      fileHistoryText(t, { action: 'file_delete', changes: [{ field: 'file', from: 'Акт.pdf' }] }),
    ).toBeNull();
  });

  it('«Изменить файл»: переименование, примечание и замена — одной записью через «; »', () => {
    expect(
      fileHistoryText(t, {
        action: 'file_edit',
        changes: [
          { field: 'file', to: 'Акт сверки.pdf' },
          { field: 'name', from: 'Акт.pdf', to: 'Акт сверки.pdf' },
          { field: 'note', from: null, to: 'За октябрь' },
          { field: 'size', from: 38_000, to: 1_258_291 },
        ],
      }),
    ).toBe(
      'Файл «Акт.pdf» переименован в «Акт сверки.pdf»; Примечание к файлу «Акт сверки.pdf»: За октябрь; Файл «Акт сверки.pdf» заменён: было 37 КБ, стало 1,2 МБ',
    );
    expect(
      fileHistoryText(t, {
        action: 'file_edit',
        changes: [
          { field: 'file', to: 'Акт.pdf' },
          { field: 'note', from: 'За октябрь', to: null },
        ],
      }),
    ).toBe('Примечание к файлу «Акт.pdf» убрано');
  });
  it('файл контрагента ссылкой (доработки 16.11.2026, блок 2; прототип v124 fLinkAdd, fUnlink, fDelDlg)', () => {
    expect(
      fileHistoryText(t, {
        action: 'file_attach',
        changes: [
          { field: 'file', to: 'Акт сверки.pdf' },
          { field: 'link', to: true },
        ],
      }),
    ).toBe('Прикреплены из файлов контрагента: Акт сверки.pdf');
    expect(
      fileHistoryText(t, {
        action: 'file_delete',
        changes: [
          { field: 'file', from: 'Акт сверки.pdf' },
          { field: 'link', to: true },
        ],
      }),
    ).toBe('Откреплён файл «Акт сверки.pdf»: он остался в файлах контрагента');
    expect(
      fileHistoryText(t, {
        action: 'file_delete',
        changes: [
          { field: 'file', from: 'Акт сверки.pdf' },
          { field: 'linked', to: true },
        ],
      }),
    ).toBe('Удалён файл «Акт сверки.pdf» (был прикреплён из файлов контрагента)');
  });
});
