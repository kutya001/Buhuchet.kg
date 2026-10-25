import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecordChangedNotice } from './record-changed';

const props = {
  message: 'Запись изменена другим пользователем',
  reloadLabel: 'Перечитать',
};

/** Кнопка внутри разметки компонента (без DOM: компонент — обычная функция). */
function buttonOf(tree: ReactNode): ReactElement<{ onClick: () => void; disabled: boolean }> {
  const found: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<{ children?: ReactNode }>(n)) return;
    if (n.type === 'button') found.push(n);
    walk(n.props.children);
  };
  walk(tree);
  return found[0] as ReactElement<{ onClick: () => void; disabled: boolean }>;
}

describe('RecordChangedNotice — предупреждение при 409 record_changed', () => {
  it('показывает текст из словаря и кнопку «Перечитать»', () => {
    const html = renderToStaticMarkup(<RecordChangedNotice {...props} onReload={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Запись изменена другим пользователем');
    expect(html).toContain('>Перечитать</button>');
    expect(html).not.toContain('disabled=""');
  });

  it('кнопка перечитывает запись', () => {
    const onReload = vi.fn();
    buttonOf(RecordChangedNotice({ ...props, onReload })).props.onClick();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('пока запись перечитывается, кнопка неактивна', () => {
    const html = renderToStaticMarkup(
      <RecordChangedNotice {...props} onReload={() => {}} reloading />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });
});
