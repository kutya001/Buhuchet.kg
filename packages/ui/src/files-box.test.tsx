import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FilesBox, type FilesBoxLabels } from './files-box';

const labels: FilesBoxLabels = {
  title: 'Файлы',
  attach: 'Прикрепить',
  uploading: 'Загрузка…',
  empty: 'Файлов пока нет',
  download: (name) => `Скачать ${name}`,
  remove: (name) => `Удалить ${name}`,
  removeTitle: 'Удалить файл',
  edit: (name) => `Изменить ${name}`,
  editTitle: 'Изменить файл: название, примечание, замена',
  noteTitle: 'Примечание к файлу',
};

const items = [
  { id: '1', name: 'Акт сверки.pdf', meta: 'PDF · 1,2 МБ', canDelete: true },
  { id: '2', name: 'Договор.docx', meta: 'DOCX · 54 КБ', canDelete: false },
];

const render = (props: Partial<Parameters<typeof FilesBox>[0]> = {}) =>
  renderToStaticMarkup(
    <FilesBox
      items={items}
      canUpload
      labels={labels}
      onPick={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  );

describe('блок «Файлы» (прототип filesBox)', () => {
  it('заголовок с числом файлов, «Прикрепить» с выбором нескольких файлов', () => {
    const html = render();
    expect(html).toContain('Файлы · 2');
    expect(html).toContain('Прикрепить');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*multiple/);
  });

  it('строка файла: имя, тип и размер, «Скачать»; «Удалить» — только где можно', () => {
    const html = render();
    expect(html).toContain('Акт сверки.pdf');
    expect(html).toContain('PDF · 1,2 МБ');
    expect(html).toContain('aria-label="Скачать Акт сверки.pdf"');
    expect(html).toContain('aria-label="Скачать Договор.docx"');
    expect(html).toContain('aria-label="Удалить Акт сверки.pdf"');
    expect(html).not.toContain('aria-label="Удалить Договор.docx"');
  });

  it('без права прикреплять — нет кнопки; пусто — «Файлов пока нет»', () => {
    const html = render({ items: [], canUpload: false });
    expect(html).toContain('Файлы · 0');
    expect(html).toContain('Файлов пока нет');
    expect(html).not.toContain('Прикрепить');
    expect(html).not.toContain('type="file"');
  });

  it('«глаз» показа на странице контрагента — только у файла с отметкой и при обработчике', () => {
    const shown = { hidden: false, label: 'Виден на странице контрагента. Скрыть' };
    const hidden = { hidden: true, label: 'Скрыт со страницы контрагента. Показать' };
    const marked = [
      { ...items[0]!, page: shown },
      { ...items[1]!, page: hidden },
      { id: '3', name: 'Задача.pdf', meta: 'PDF · 1 КБ', canDelete: false },
    ];
    const html = render({ items: marked, onPage: vi.fn() });
    expect(html).toContain('data-pgf="on"');
    expect(html).toContain('data-pgf="off"');
    expect(html).toContain('aria-label="Виден на странице контрагента. Скрыть: Акт сверки.pdf"');
    expect(html.match(/data-pgf=/g)).toHaveLength(2);
    // Без обработчика кнопки нет.
    expect(render({ items: marked })).not.toContain('data-pgf');
  });

  it('примечание — строкой под типом и размером; «Изменить» — только где можно и при обработчике (прототип v95)', () => {
    const noted = [
      { ...items[0]!, note: 'Скан с печатью', canEdit: true },
      { ...items[1]!, note: null, canEdit: false },
    ];
    const html = render({ items: noted, onEdit: vi.fn() });
    expect(html).toContain('Скан с печатью');
    expect(html.match(/data-file-note=/g)).toHaveLength(1);
    expect(html).toContain('title="Примечание к файлу"');
    expect(html).toContain('aria-label="Изменить Акт сверки.pdf"');
    expect(html).not.toContain('aria-label="Изменить Договор.docx"');
    // Без обработчика кнопки нет.
    expect(render({ items: noted })).not.toContain('data-file-edit');
  });

  it('пока файлы загружаются, кнопка недоступна и подписана «Загрузка…»', () => {
    const html = render({ busy: true });
    expect(html).toContain('Загрузка…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/);
  });
});
