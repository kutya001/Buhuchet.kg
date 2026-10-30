import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  confirmFooter,
  dialogClass,
  WindowFrame,
  type WindowFrameProps,
  type WindowLabels,
} from './modal';
import { canMaximize, closesAtOnce, WindowStack } from './window-stack';

const LABELS: WindowLabels = {
  maximize: 'На весь экран',
  restore: 'Свернуть окно',
  maximizeHint: '(двойной клик по заголовку)',
  close: 'Закрыть',
  cancel: 'Отмена',
  confirm: 'Подтвердить',
  discardTitle: 'Закрыть без сохранения?',
  discardText: 'В форме есть несохранённые изменения. Если закрыть сейчас, они пропадут.',
  discardOk: 'Закрыть',
  tabPosition: (n, total) => `${n} из ${total}`,
};

function frame(props: Partial<WindowFrameProps> = {}): WindowFrameProps {
  return {
    titleId: 't1',
    title: 'Отчеты для сдачи',
    sub: 'База знаний',
    children: <p>Описание модуля</p>,
    size: 'narrow',
    narrow: false,
    canMax: true,
    max: false,
    phone: false,
    labels: LABELS,
    onToggleMax: () => {},
    onClose: () => {},
    onCoverDown: () => {},
    ...props,
  };
}

/** Элементы нужного типа внутри разметки (без DOM: компонент без хуков — обычная функция). */
function find<P>(tree: ReactNode, match: (el: ReactElement<P>) => boolean): ReactElement<P>[] {
  const found: ReactElement<P>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<{ children?: ReactNode }>(n)) return;
    if (match(n as ReactElement<P>)) found.push(n as ReactElement<P>);
    walk(n.props.children);
  };
  walk(tree);
  return found;
}

type ButtonProps = { onClick: () => void; 'aria-label'?: string; className: string };
const byLabel = (tree: ReactNode, label: string) =>
  find<ButtonProps>(tree, (el) => el.type === 'button' && el.props['aria-label'] === label)[0]!;

describe('окно: шапка, «На весь экран», закрытие (ТЗ «Окна … и развёртывание на весь экран»)', () => {
  it('модальное окно с названием и строкой под ним; пока открыто, вкладки свайпом не листаются', () => {
    const html = renderToStaticMarkup(<WindowFrame {...frame()} />);
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="t1"');
    expect(html).toContain('data-window="true" data-overlay="true"');
    expect(html).toMatch(/<h2 id="t1"[^>]*>Отчеты для сдачи<\/h2>/);
    expect(html).toContain('>База знаний</div>');
    expect(html).toContain('<p>Описание модуля</p>');
    // Нижней строки нет, если кнопок действий нет.
    expect(html).not.toContain('border-t');
  });

  it('в шапке рядом с «Закрыть» — «На весь экран»; на ПК в подсказке — двойной клик по заголовку', () => {
    const html = renderToStaticMarkup(<WindowFrame {...frame()} />);
    expect(html).toContain(
      'aria-pressed="false" aria-label="На весь экран" title="На весь экран (двойной клик по заголовку)"',
    );
    expect(html).toContain('aria-label="Закрыть"');
    const phone = renderToStaticMarkup(<WindowFrame {...frame({ phone: true })} />);
    expect(phone).toContain('aria-label="На весь экран" title="На весь экран"');
  });

  it('развёрнутое окно: «Свернуть окно», во всё окно браузера с отступом 12 px, содержимое до 1600 px', () => {
    const html = renderToStaticMarkup(<WindowFrame {...frame({ max: true })} />);
    expect(html).toContain('aria-pressed="true" aria-label="Свернуть окно"');
    expect(html).toMatch(/class="fixed inset-0[^"]* p-3"/);
    expect(html).toContain('h-[calc(100dvh-24px)]');
    expect(html).toContain('*:max-w-[1600px]');
    // Форма ввода — колонкой до 980 px, шапка и кнопки — по той же колонке.
    const form = renderToStaticMarkup(
      <WindowFrame {...frame({ max: true, narrow: true, footer: <button>Сохранить</button> })} />,
    );
    expect(form).toContain('*:max-w-[980px]');
    expect(form).toContain('pl-[max(22px,calc((100%_-_980px)/2))]');
    expect(form).not.toContain('1600px');
  });

  it('у коротких подтверждений кнопки «На весь экран» нет', () => {
    expect(canMaximize('message')).toBe(false);
    expect(canMaximize('card')).toBe(true);
    expect(canMaximize('form')).toBe(true);
    const html = renderToStaticMarkup(<WindowFrame {...frame({ canMax: false })} />);
    expect(html).not.toContain('На весь экран');
    expect(html).toContain('aria-label="Закрыть"');
  });

  it('ширина на ПК — 580, 780 или 1100 px; на телефоне — шторка снизу, развёрнутая — весь экран', () => {
    expect(dialogClass('narrow', false)).toContain('w-[min(580px,100%)]');
    expect(dialogClass('mid', false)).toContain('w-[min(780px,100%)]');
    expect(dialogClass('wide', false)).toContain('h-[min(860px,calc(100dvh-48px))]');
    expect(dialogClass('mid', false)).toContain('max-md:max-h-[92dvh]');
    expect(dialogClass('mid', false)).toContain('max-md:rounded-b-none');
    expect(dialogClass('wide', false)).toContain('max-md:h-[92dvh]');
    const max = dialogClass('mid', true);
    expect(max).toContain('max-md:h-dvh');
    expect(max).toContain('max-md:rounded-none');
    // С учётом выреза экрана сверху и полоски «домой» снизу.
    expect(max).toContain('max-md:pt-[env(safe-area-inset-top,0px)]');
    expect(max).toContain('max-md:pb-[env(safe-area-inset-bottom,0px)]');
    // На ПК развёрнутое окно сохраняет скругление и тень.
    expect(max).toContain('rounded-2xl');
    expect(max).toContain('shadow-pop');
    // Окно подбора на телефоне — на весь экран и не развёрнутое; на ПК — обычного размера.
    const full = dialogClass('wide', false, true, true);
    expect(full).toContain('max-md:h-dvh');
    expect(full).not.toContain('max-md:h-[92dvh]');
    expect(full).toContain('w-[min(1100px,100%)]');
  });

  it('окно выезжает снизу при открытии; открытое сразу развёрнутым появляется без выезда', () => {
    expect(dialogClass('mid', false)).toContain('animate-slide-up');
    expect(dialogClass('mid', true, false)).not.toContain('animate-slide-up');
    expect(
      renderToStaticMarkup(<WindowFrame {...frame({ max: true, slide: false })} />),
    ).not.toContain('animate-slide-up');
  });

  it('фон — отдельный слой под окном: пока окно тянут вниз, светлеет только фон, окно непрозрачно', () => {
    const onCoverDown = vi.fn();
    const tree = WindowFrame(frame({ onCoverDown }));
    const [cover] = find<{ onPointerDown: () => void; className: string; children?: ReactNode }>(
      tree,
      (el) => typeof (el.props as { onPointerDown?: unknown }).onPointerDown === 'function',
    );
    expect(cover!.props.className).toContain('bg-cover');
    expect(cover!.props.children).toBeUndefined();
    cover!.props.onPointerDown();
    expect(onCoverDown).toHaveBeenCalledOnce();
  });

  it('ручка и шапка — места, за которые окно тянут вниз', () => {
    const html = renderToStaticMarkup(<WindowFrame {...frame()} />);
    expect(html.match(/data-swipe-handle="true"/g)).toHaveLength(2);
  });

  it('кнопки шапки: «На весь экран» разворачивает, «Закрыть» закрывает', () => {
    const onToggleMax = vi.fn();
    const onClose = vi.fn();
    const tree = WindowFrame(frame({ onToggleMax, onClose }));
    byLabel(tree, 'На весь экран').props.onClick();
    byLabel(tree, 'Закрыть').props.onClick();
    expect(onToggleMax).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('двойной клик по шапке на ПК разворачивает окно; по кнопке или на телефоне — нет', () => {
    const onToggleMax = vi.fn();
    const header = (props: Partial<WindowFrameProps>) =>
      find<{ onDoubleClick: (e: unknown) => void }>(
        WindowFrame(frame({ onToggleMax, ...props })),
        (el) => typeof (el.props as { onDoubleClick?: unknown }).onDoubleClick === 'function',
      )[0]!;
    const on = (closest: unknown) => ({ target: { closest: () => closest } });
    header({}).props.onDoubleClick(on(null));
    expect(onToggleMax).toHaveBeenCalledOnce();
    header({}).props.onDoubleClick(on({}));
    header({ phone: true }).props.onDoubleClick(on(null));
    header({ canMax: false }).props.onDoubleClick(on(null));
    expect(onToggleMax).toHaveBeenCalledOnce();
  });

  it('карточка с вкладками: ряд вкладок вверху содержимого, на телефоне — «N из M»', () => {
    const html = renderToStaticMarkup(
      <WindowFrame
        {...frame({
          tabs: {
            items: [
              { id: 'main', label: 'Основное', icon: 'user' },
              { id: 'cps', label: 'Контрагенты', icon: 'building', count: { value: 3 } },
            ],
            active: 'main',
            onSelect: () => {},
            label: 'Вкладки карточки',
          },
        })}
      />,
    );
    expect(html).toContain('role="tablist" aria-label="Вкладки карточки"');
    expect(html).toContain('-top-1.5');
    expect(html).toContain('1 из 2');
  });
});

describe('окно подтверждения', () => {
  it('«Отмена» и кнопка действия; опасное действие — красная кнопка', () => {
    const onCancel = vi.fn();
    const onOk = vi.fn();
    const tree = confirmFooter({ cancel: 'Отмена', ok: 'Закрыть', danger: true, onCancel, onOk });
    const [cancel, ok] = find<ButtonProps>(tree, (el) => el.type === 'button');
    expect(renderToStaticMarkup(<>{tree}</>)).toMatch(/>Отмена<\/button><button[^>]*>Закрыть</);
    expect(ok!.props.className).toContain('bg-danger-btn');
    cancel!.props.onClick();
    ok!.props.onClick();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onOk).toHaveBeenCalledOnce();
    const plain = confirmFooter({
      cancel: 'Отмена',
      ok: 'Подтвердить',
      danger: false,
      onCancel,
      onOk,
    });
    expect(find<ButtonProps>(plain, (el) => el.type === 'button')[1]!.props.className).toContain(
      'bg-accent',
    );
  });
});

describe('стопка открытых окон', () => {
  it('Esc и Tab — только у верхнего окна; закрытое окно уходит из стопки', () => {
    const stack = new WindowStack();
    const card = { kind: 'card' as const };
    const confirm = { kind: 'message' as const };
    const removeCard = stack.add(card);
    const removeConfirm = stack.add(confirm);
    expect(stack.isTop(confirm)).toBe(true);
    expect(stack.isTop(card)).toBe(false);
    removeConfirm();
    expect(stack.isTop(card)).toBe(true);
    removeCard();
    removeCard();
    expect(stack.size).toBe(0);
  });

  it('протяжка вниз и «Назад» закрывают сразу, кроме формы (или карточки с формой) с несохранёнными изменениями — она спрашивает', () => {
    expect(closesAtOnce({ kind: 'card' })).toBe(true);
    expect(closesAtOnce({ kind: 'form' })).toBe(true);
    expect(closesAtOnce({ kind: 'form', dirty: false })).toBe(true);
    expect(closesAtOnce({ kind: 'form', dirty: true })).toBe(false);
    // Карточке просмотра терять нечего, пока в ней нет формы с изменениями («Смена пароля» в «Мой профиль»).
    expect(closesAtOnce({ kind: 'card', dirty: false })).toBe(true);
    expect(closesAtOnce({ kind: 'card', dirty: true })).toBe(false);
    expect(closesAtOnce({ kind: 'message', dirty: true })).toBe(true);
  });

  it('выход спрашивает «Выйти без сохранения?», только если в открытой форме есть несохранённые изменения', () => {
    const stack = new WindowStack();
    const removeCard = stack.add({ kind: 'card' });
    const form = { kind: 'form' as const, dirty: false };
    const removeForm = stack.add(form);
    // Нетронутая форма — выход без вопроса (ТЗ; прототип спрашивал при любой открытой форме).
    expect(stack.hasUnsaved()).toBe(false);
    form.dirty = true;
    expect(stack.hasUnsaved()).toBe(true);
    removeForm();
    expect(stack.hasUnsaved()).toBe(false);
    removeCard();
  });
});
