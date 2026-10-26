import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, NothingFound } from './empty-state';

/** Кнопки внутри разметки (без DOM: компонент без хуков — обычная функция). */
function buttons(tree: ReactNode): ReactElement<{ onClick: () => void; className: string }>[] {
  const found: ReactElement<{ onClick: () => void; className: string }>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<{ children?: ReactNode }>(n)) return;
    if (n.type === 'button') found.push(n as never);
    walk(n.props.children);
  };
  walk(tree);
  return found;
}

describe('пустые состояния (ТЗ «Пустые состояния и первый вход»)', () => {
  it('значок, строка «что здесь будет», пояснение и кнопка первого действия', () => {
    const add = vi.fn();
    const props = {
      icon: 'building' as const,
      title: 'Здесь будут ваши клиенты',
      text: 'Добавьте контрагентов по одному или загрузите сразу списком из Excel.',
      actions: [
        {
          id: 'add',
          label: 'Добавить контрагента',
          icon: 'plus' as const,
          onClick: add,
          primary: true,
        },
        { id: 'excel', label: 'Загрузить из Excel', icon: 'paste' as const, onClick: () => {} },
      ],
    };
    const html = renderToStaticMarkup(<EmptyState {...props} />);
    expect(html).toContain('border-dashed');
    expect(html).toContain(
      '<b class="max-w-[520px] text-[15px] text-balance text-ink">Здесь будут ваши клиенты</b>',
    );
    expect(html).toContain('Добавьте контрагентов по одному');
    const [first, second] = buttons(EmptyState(props));
    // Первое действие — основная кнопка, остальные — обычные.
    expect(first!.props.className).toContain('bg-accent');
    expect(second!.props.className).toContain('bg-btn');
    first!.props.onClick();
    expect(add).toHaveBeenCalledOnce();
  });

  it('без пояснения и кнопок — только значок и строка', () => {
    const html = renderToStaticMarkup(<EmptyState icon="folder" title="Файлов пока нет" />);
    expect(html).not.toContain('<span');
    expect(html).not.toContain('<button');
  });

  it('при поиске или фильтре — «Ничего не найдено» со ссылкой «Сбросить фильтры»', () => {
    const onReset = vi.fn();
    const props = {
      title: 'Ничего не найдено',
      text: 'Под поиск и фильтры не подходит ни одна запись.',
      resetLabel: 'Сбросить фильтры',
      onReset,
    };
    const html = renderToStaticMarkup(<NothingFound {...props} />);
    expect(html).toContain('>Ничего не найдено</b>');
    expect(html).toMatch(
      /<button type="button" class="[^"]*underline[^"]*">Сбросить фильтры<\/button>/,
    );
    const [reset] = buttons(NothingFound(props).props.children);
    reset!.props.onClick();
    expect(onReset).toHaveBeenCalledOnce();
  });
});
