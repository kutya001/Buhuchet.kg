'use client';

import { useEffect, type RefObject } from 'react';
import {
  columnWidth,
  FORM_GAP,
  KV_GAP,
  PACK_QUERY,
  packFormCells,
  packKvItems,
  type ControlInfo,
  type FormCell,
  type PackPlace,
} from './form-pack';

let canvas: HTMLCanvasElement | null = null;

/** Ширина строки шрифтом элемента (как textW прототипа): по ней поле решает, помещается ли оно. */
function textWidth(text: string, el: Element): number {
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return 0;
  const style = getComputedStyle(el);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(text).width;
}

const FIXED_TYPES = new Set([
  'date',
  'month',
  'time',
  'week',
  'number',
  'datetime-local',
  'hidden',
]);

function describeControl(el: Element): ControlInfo {
  if (el.hasAttribute('data-segments')) {
    return {
      kind: 'segments',
      widths: Array.from(el.children, (b) => textWidth(b.textContent?.trim() ?? '', b)),
    };
  }
  if (el instanceof HTMLSelectElement) {
    const widths = Array.from(el.options, (o) => textWidth(o.textContent?.trim() ?? '', el));
    return { kind: 'select', multiple: el.multiple, widestOption: Math.max(0, ...widths) };
  }
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (FIXED_TYPES.has(type)) return { kind: 'fixed' };
  if (type === 'checkbox' || type === 'radio') {
    const label = el.closest('label');
    return {
      kind: 'check',
      labelWidth: label ? textWidth(label.textContent?.trim() ?? '', label) : null,
    };
  }
  const mode = el.getAttribute('inputmode');
  return mode === 'decimal' || mode === 'numeric' ? { kind: 'fixed' } : { kind: 'text' };
}

/** Ребёнок формы: поле (`Field`), пустая ячейка выравнивания или что-то другое на всю ширину. */
function describeCell(el: HTMLElement): FormCell {
  if (!el.hasAttribute('data-field')) {
    return el.tagName === 'DIV' && el.childNodes.length === 0 && !el.className ? 'spacer' : 'wide';
  }
  const label = el.querySelector(':scope > label');
  const controls = Array.from(el.querySelectorAll('input, select, [data-segments]')).filter(
    (c) => !c.closest('[data-hint]') && !c.parentElement?.closest('[data-segments]'),
  );
  return {
    field: {
      full: el.hasAttribute('data-full'),
      labelWidth: label ? textWidth(label.textContent?.trim() ?? '', label) : null,
      block: el.querySelector('textarea, input[type=file], table, [data-block]') !== null,
      controls: controls.map(describeControl),
    },
  };
}

function shown(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getAttribute('data-pack') === 'hidden';
}

/**
 * Компоновка формы (`mode="form"`) или карточки просмотра (`mode="kv"`) на телефоне до 600 px, как
 * mobile-pack.js прототипа: детям ставится `data-pack` (half, full, hidden), контейнеру — `data-packed`;
 * классы раскладки — у `FormGrid` и `KeyValues`. Пересчитывается само, когда поля появляются и
 * пропадают, меняется текст подписи или ширина (поворот экрана). На ПК атрибутов нет.
 */
export function useFormPack(ref: RefObject<HTMLElement | null>, mode: 'form' | 'kv'): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const media = window.matchMedia(PACK_QUERY);
    let frame = 0;
    const apply = () => {
      frame = 0;
      const kids = Array.from(root.children) as HTMLElement[];
      if (!media.matches) {
        root.removeAttribute('data-packed');
        for (const kid of kids) kid.removeAttribute('data-pack');
        return;
      }
      const visible = kids.filter(shown);
      const column = columnWidth(root.clientWidth, mode === 'form' ? FORM_GAP : KV_GAP);
      const places: PackPlace[] =
        mode === 'form'
          ? packFormCells(visible.map(describeCell), column)
          : packKvItems(
              visible.map((item) => {
                const value = item.querySelector('[data-kv-value]') ?? item;
                return {
                  block: item.querySelector('table, ul, [data-block]') !== null,
                  lineWidths: item.innerText
                    .split('\n')
                    .map((line) => textWidth(line.trim(), value)),
                };
              }),
              column,
            );
      visible.forEach((kid, i) => kid.setAttribute('data-pack', places[i]!));
      root.setAttribute('data-packed', '');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    schedule();
    media.addEventListener('change', schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    // Свои атрибуты data-pack и data-packed в фильтр не входят: иначе раскладка вызывала бы сама себя.
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style'],
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      media.removeEventListener('change', schedule);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [ref, mode]);
}
