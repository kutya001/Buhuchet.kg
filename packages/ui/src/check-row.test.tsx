import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckRow, Hint } from './check-row';
import { Chip } from './chip';
import { Timeline } from './timeline';

// Строки учётной политики, плашки дней напоминаний и лента истории «Моей организации» (прототип
// controls.css `.check-row`, `.sw`; grid.css `.chip`; cards.css `ul.tl`).

const noop = () => undefined;

describe('строка с переключателем', () => {
  it('переключатель с ролью switch, название жирным, пояснение под ним, строки разделены чертой', () => {
    const html = renderToStaticMarkup(
      <CheckRow checked onChange={noop} label="Задачи" data-feat-row="tasks">
        <Hint>Модуль задач</Hint>
      </CheckRow>,
    );
    expect(html).toContain('data-feat-row="tasks"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('checked=""');
    expect(html).toContain('<b>Задачи</b>');
    expect(html).toContain('Модуль задач');
    expect(html).toContain('border-b');
    expect(html).toContain('last:border-b-0');
    expect(html).toContain('cursor-pointer');
  });

  it('галочка без роли switch; недоступная строка — без указателя; plain — название обычным шрифтом', () => {
    const check = renderToStaticMarkup(
      <CheckRow kind="check" compact disabled checked={false} onChange={noop} label="Отчёты" />,
    );
    expect(check).not.toContain('role="switch"');
    expect(check).toContain('disabled=""');
    expect(check).toContain('py-1');
    expect(check).toMatch(/<label class="[^"]*py-1 "/);
    expect(check).not.toContain('<b>');
    const plain = renderToStaticMarkup(
      <CheckRow plain checked onChange={noop} label="Повторять при просрочке" />,
    );
    expect(plain).toContain('role="switch"');
    expect(plain).not.toContain('<b>');
  });
});

describe('плашка', () => {
  it('с onClear — крестик с подписью; без — только текст', () => {
    const html = renderToStaticMarkup(
      <Chip id="7" clear="Убрать" onClear={noop}>
        за 7 дней
      </Chip>,
    );
    expect(html).toContain('data-chip="7"');
    expect(html).toContain('aria-label="Убрать"');
    expect(html).toContain('за 7 дней');
    expect(renderToStaticMarkup(<Chip>за 3 дня</Chip>)).not.toContain('<button');
  });
});

describe('лента истории', () => {
  it('дата и время слева, текст и кто справа, подпись списка', () => {
    const html = renderToStaticMarkup(
      <Timeline
        label="История"
        items={[
          { id: 'a', date: '26.10.2026', time: '10:05', text: 'Включена функция', who: 'Эркин С.' },
        ]}
      />,
    );
    expect(html).toContain('aria-label="История"');
    expect(html).toContain('26.10.2026<br/>10:05');
    expect(html).toContain('Включена функция');
    expect(html).toContain('Эркин С.');
    expect(html.match(/data-timeline-item/g)).toHaveLength(1);
  });
});
