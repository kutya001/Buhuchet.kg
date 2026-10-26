import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  safeHref,
  StatusHistory,
  StatusHistoryDetails,
  type StatusHistoryRow,
} from './status-history';
import {
  StatusMini,
  StatusMiniNone,
  StatusNone,
  StatusPill,
  StatusScale,
  StatusScales,
  type StatusScaleProps,
} from './status-scale';

const labels: StatusScaleProps['labels'] = {
  moveTo: (name) => `Перевести в «${name}»`,
  rollbackTo: (name) => `Откатить в «${name}»`,
  rollbackMark: 'откатить',
  sideOnStep: (n, name) => `на шаге ${n} «${name}»`,
};
const steps = [
  { code: 'todo', label: 'К сдаче', at: '01.10.2026 09:00' },
  { code: 'in_progress', label: 'В работе', at: '05.10.2026 14:20' },
  { code: 'submitted', label: 'Сдан' },
];

/** Элементы дерева, которые подходят под условие (обработчики вызываются напрямую). */
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
type StepButton = {
  onClick?: () => void;
  title?: string;
  'aria-current'?: string;
  'aria-disabled'?: boolean;
  tabIndex?: number;
  className: string;
};
const buttons = (tree: ReactNode) => find<StepButton>(tree, (el) => el.type === 'button');

describe('шкала статусов (прототип scaleFull)', () => {
  it('пройденный шаг — галочка, текущий — номер цветом статуса, следующий — пунктир и нажатие переводит', () => {
    const onStep = vi.fn();
    const tree = StatusScale({
      title: 'Сдача',
      steps,
      index: 1,
      tone: 'blue',
      next: ['submitted'],
      onStep,
      labels,
    });
    const [done, current, next] = buttons(tree);
    expect(done!.props['aria-disabled']).toBe(true);
    expect(done!.props.tabIndex).toBe(-1);
    expect(current!.props['aria-current']).toBe('step');
    expect(current!.props.className).toContain('bg-info-bg');
    expect(next!.props.className).toContain('border-dashed');
    expect(next!.props.title).toBe('Перевести в «Сдан»');
    next!.props.onClick!();
    expect(onStep).toHaveBeenCalledWith('submitted');

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('>Сдача</span>');
    expect(html).toContain('data-no-swipe');
    expect(html).toContain('aria-label="Сдача"');
    // Номер текущего шага — светлый текст на залитом кружке не ниже 4,5 : 1 (`*-btn`).
    expect(html).toContain('bg-info-btn text-on-accent');
    // Дата и время — у пройденного и текущего шага, у будущего нет.
    expect(html).toContain('01.10.2026 09:00');
    expect(html).toContain('05.10.2026 14:20');
    // На телефоне — столбиком во всю ширину, дата справа.
    expect(html).toContain('max-md:flex-col');
    expect(html).toContain('max-md:ml-auto');
  });

  it('шаг для отката — оранжевая пунктирная рамка с «откатить»; без права (back пустой) не нажимается', () => {
    const onBack = vi.fn();
    const props = { title: 'Сдача', steps, index: 2, tone: 'green' as const, labels, onBack };
    const withRight = StatusScale({ ...props, back: 'in_progress' });
    const back = buttons(withRight)[1]!;
    expect(back.props.className).toContain('border-caution/45');
    expect(back.props.title).toBe('Откатить в «В работе»');
    back.props.onClick!();
    expect(onBack).toHaveBeenCalledWith('in_progress');
    expect(renderToStaticMarkup(withRight)).toContain('откатить');

    const without = StatusScale({ ...props, back: null });
    expect(buttons(without).filter((b) => b.props.onClick)).toEqual([]);
    expect(renderToStaticMarkup(without)).not.toContain('откатить');
  });

  it('следующий шаг поверх пройденного (из архива снова «Обслуживается») — как следующий, а не серый', () => {
    const tree = StatusScale({
      title: 'Обслуживание',
      steps: [
        { code: 'active', label: 'Обслуживается' },
        { code: 'paused', label: 'Приостановлен' },
        { code: 'archived', label: 'В архиве' },
      ],
      index: 2,
      tone: 'faint',
      next: ['active'],
      labels,
    });
    const first = buttons(tree)[0]!;
    expect(first.props.title).toBe('Перевести в «Обслуживается»');
    expect(first.props.className).toContain('text-ink');
    expect(first.props.className).not.toContain('text-muted');
    expect(renderToStaticMarkup(tree)).toContain('border-accent text-accent bg-pane-alt');
  });

  it('откат только на предыдущий шаг: будущий шаг откатом не становится', () => {
    const tree = StatusScale({
      title: 'Сдача',
      steps,
      index: 0,
      tone: 'gray',
      back: 'submitted',
      labels,
    });
    expect(buttons(tree).filter((b) => b.props.onClick)).toEqual([]);
  });

  it('боковой статус — отметка на шаге с подписью «на шаге N «…»» и откат на этот же шаг', () => {
    const tree = StatusScale({
      title: 'Сдача',
      steps,
      index: 2,
      tone: 'orange',
      side: { label: 'Требует исправления', tone: 'red', at: '10.10.2026 11:00' },
      next: ['submitted'],
      back: 'submitted',
      labels,
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Требует исправления');
    expect(html).toContain('на шаге 3 «Сдан»');
    expect(html).toContain('10.10.2026 11:00');
    expect(html).toContain('bg-danger-btn');
    // «Сдан» — и следующий шаг (сдать снова), и шаг для отката: нажатие переводит.
    const last = buttons(tree)[2]!;
    expect(last.props.title).toBe('Перевести в «Сдан»');
  });

  it('отметка подтверждения на шаге «Сдан» и закрытый шаг с причиной', () => {
    const tree = StatusScale({
      title: 'Сдача',
      steps,
      index: 1,
      tone: 'blue',
      next: ['submitted'],
      blocked: { submitted: 'Сначала оплатите налог' },
      hints: ['«Сдан»: Сначала оплатите налог'],
      labels,
    });
    const last = buttons(tree)[2]!;
    expect(last.props.onClick).toBeUndefined();
    expect(last.props.title).toBe('Сначала оплатите налог');
    expect(renderToStaticMarkup(tree)).toContain('«Сдан»: Сначала оплатите налог');

    const marked = renderToStaticMarkup(
      StatusScale({
        title: 'Сдача',
        steps,
        index: 2,
        tone: 'green',
        mark: { label: 'Ждёт подтверждения', tone: 'yellow', icon: 'hourglass' },
        labels,
      }),
    );
    expect(marked).toContain('Ждёт подтверждения');
    expect(marked).toContain('text-warn-label');
  });

  it('«Не требуется» — серая надпись вместо шкалы, с какого времени и «Снять»', () => {
    const onClick = vi.fn();
    const tree = StatusNone({
      title: 'Сдача',
      text: 'Не требуется — шкала не ведётся',
      since: 'с 12.10.2026 10:00',
      undo: { label: 'Снять «Не требуется»', onClick },
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Не требуется — шкала не ведётся');
    expect(html).toContain('с 12.10.2026 10:00');
    buttons(tree)[0]!.props.onClick!();
    expect(onClick).toHaveBeenCalled();
    expect(renderToStaticMarkup(StatusNone({ title: 'Оплата', text: 'x' }))).not.toContain(
      '<button',
    );
  });

  it('две шкалы — рядом на ПК и одна под другой на телефоне', () => {
    const html = renderToStaticMarkup(
      <StatusScales>
        <span>1</span>
        <span>2</span>
      </StatusScales>,
    );
    expect(html).toContain('flex-wrap');
    expect(html).toContain('max-md:flex-col');
  });
});

describe('компактная шкала (прототип scaleMini)', () => {
  it('точки шагов, «2/3» цветом статуса, название и время под ним с подсказкой', () => {
    const html = renderToStaticMarkup(
      <StatusMini
        count={3}
        index={1}
        tone="blue"
        label="В работе"
        title="Этап 2 из 3: В работе"
        at="05.10.2026 14:20"
        atTitle="Установлен 05.10.2026 14:20, Тилекова А."
      />,
    );
    expect(html).toContain('2/3');
    expect(html).toContain('text-info');
    expect(html).toContain('title="Этап 2 из 3: В работе"');
    expect(html).toContain('title="Установлен 05.10.2026 14:20, Тилекова А."');
    expect(html.match(/<i /g)).toHaveLength(3);
    expect(html).toContain('opacity-45');
  });

  it('без времени — только шкала; боковой статус — красная точка; отметка — значок с названием', () => {
    const html = renderToStaticMarkup(
      <StatusMini
        count={3}
        index={2}
        tone="orange"
        label="Требует исправления"
        side
        title="Этап 3 из 3"
        mark={{ label: 'Ждёт подтверждения', icon: 'hourglass', tone: 'yellow' }}
      />,
    );
    expect(html).not.toContain('<small');
    expect(html).toContain('border-danger bg-danger');
    expect(html).toContain('aria-label="Ждёт подтверждения"');
    expect(renderToStaticMarkup(<StatusMiniNone label="Не требуется" title="x" />)).toContain(
      'Не требуется',
    );
  });

  it('метка статуса — значок и название цветом статуса', () => {
    const html = renderToStaticMarkup(<StatusPill label="Отменена" tone="faint" icon="ban" />);
    expect(html).toContain('Отменена');
    expect(html).toContain('text-label');
  });
});

describe('«История статусов» (прототип statusHistHtml)', () => {
  const rows: StatusHistoryRow[] = [
    {
      key: '1',
      at: '01.10.2026 09:00',
      to: { label: 'К сдаче', tone: 'gray', icon: 'circle' },
      actor: 'Система',
      duration: '4 дня',
    },
    {
      key: '2',
      at: '05.10.2026 14:20',
      from: 'К сдаче',
      to: { label: 'В работе', tone: 'blue', icon: 'clock' },
      actor: 'Тилекова А.',
      note: 'взяла в работу',
      file: { name: 'выписка.pdf' },
      duration: '2 дня',
    },
    {
      key: '3',
      at: '07.10.2026 10:00',
      from: 'В работе',
      to: { label: 'К сдаче', tone: 'gray', icon: 'circle' },
      actor: 'Бекзат Т.',
      note: 'поставили по ошибке',
      rollback: true,
      duration: '19 дней',
      now: true,
    },
  ];
  const historyLabels = {
    when: 'Когда',
    status: 'Статус',
    who: 'Кто',
    note: 'Комментарий, файл',
    inStatus: 'В статусе',
    now: 'сейчас',
    rollback: 'Откат',
    whoLine: (name: string) => `Кто: ${name}`,
  };

  it('сверху новые: было → стало, кто, причина с пометкой «Откат», файл, время в статусе и итог', () => {
    const html = renderToStaticMarkup(
      <StatusHistory
        rows={rows}
        totals={[
          { label: 'К сдаче', duration: '23 дня' },
          { label: 'В работе', duration: '2 дня' },
        ]}
        labels={historyLabels}
      />,
    );
    expect(html.indexOf('07.10.2026 10:00')).toBeLessThan(html.indexOf('01.10.2026 09:00'));
    expect(html).toContain('В работе → </span>');
    expect(html).toContain('Откат');
    expect(html).toContain('поставили по ошибке');
    expect(html).toContain('выписка.pdf');
    expect(html).toContain('19 дней');
    expect(html).toContain(' · сейчас');
    expect(html).toContain('Кто: Тилекова А.');
    expect(html).toContain('К сдаче: <b>23 дня</b>');
    // Пустой комментарий — «—» на ПК, на телефоне строки нет.
    expect(html).toContain('max-md:hidden');
    // На телефоне — записи одна под другой (сетка вместо таблицы), шапки нет.
    expect(html).toContain('max-md:grid');
    expect(html).toMatch(/<thead class="max-md:hidden">/);
  });

  it('ссылка на файл — только путь сайта или https:, иначе одно имя', () => {
    expect(safeHref('/api/files/1')).toBe(true);
    expect(safeHref('https://s3.example/f.pdf?sig=1')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      '/\\evil',
      'http://x',
    ])
      expect(safeHref(bad), bad).toBe(false);
    const html = (href: string) =>
      renderToStaticMarkup(
        <StatusHistory
          rows={[{ ...rows[1]!, file: { name: 'выписка.pdf', href } }]}
          totals={[]}
          labels={historyLabels}
        />,
      );
    expect(html('/api/files/1')).toContain('href="/api/files/1"');
    expect(html('data:text/html,x')).not.toContain('href=');
  });

  it('пустая история — ничего; свёрнутая — строка со значком и стрелкой', () => {
    expect(
      renderToStaticMarkup(<StatusHistory rows={[]} totals={[]} labels={historyLabels} />),
    ).toBe('');
    const html = renderToStaticMarkup(
      <StatusHistoryDetails title="История статусов">
        <p>записи</p>
      </StatusHistoryDetails>,
    );
    expect(html).toMatch(/^<details/);
    expect(html).toContain('min-h-8');
    expect(html).toContain('История статусов');
  });
});
