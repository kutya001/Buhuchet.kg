'use client';

import { cpGlossIndex, cpGlossSplit, cpHelpCap, type CpGloss } from '@buhuchet/domain';
import { FloatingPanel, Icon, iconButtonClass } from '@buhuchet/ui';
import { useEffect, useEffectEvent, useMemo, type RefObject } from 'react';
import { useT } from '../l10n/provider';

/*
 * «Словарик» на странице контрагента (доработки 15.11.2026, пункт 4; прототип v120 `cphGloss`,
 * `cphGlossPop`): слово подчёркнуто пунктиром один раз в разделе (первое появление), не внутри кнопок,
 * ссылок, заголовков, меток и чисел; по нажатию — облачко с объяснением.
 *
 * Как в прототипе, слова ищутся в готовой разметке страницы, а не в каждом тексте отдельно: тексты
 * разделов собирают разные модули. Узел текста React остаётся на месте (в нём — начало текста), слово и
 * остаток встают после него; после каждой правки разметки React (MutationObserver — до отрисовки) всё
 * возвращается как было и ищется заново. Узлы React не удаляются и не переносятся — React их находит.
 */

/** Где ищутся слова: строка состояния и разделы (прототип `.pub-state,.pub-s`). */
const SCOPES = '[data-pub-state],section[data-sec]';

/** Внутри чего слова не подчёркиваются (прототип `CPH_GSKIP`). */
const SKIP =
  'button,a,input,select,textarea,label,h1,h2,h3,h4,svg,option,[data-pill],[data-no-gloss],.font-mono,.tabular-nums';

/** Слово с пунктиром (прототип `.pub-gl`). */
const WORD_CLASS =
  'm-0 inline cursor-help rounded-[3px] border-0 bg-transparent p-0 [font:inherit] text-inherit [text-align:inherit] underline decoration-faint decoration-dotted decoration-[1.5px] underline-offset-[3px] hover:bg-row-hover hover:decoration-current focus-visible:bg-row-hover focus-visible:decoration-current';

const OBSERVE: MutationObserverInit = { childList: true, characterData: true, subtree: true };

interface Split {
  /** Узел текста React: в нём — начало текста до первого слова. */
  node: Text;
  full: string;
  head: string;
  added: Node[];
}

function wordButton(i: number, text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = WORD_CLASS;
  b.dataset.pubGl = String(i);
  b.setAttribute('aria-haspopup', 'dialog');
  b.title = title;
  b.textContent = text;
  return b;
}

/**
 * Подчёркивает слова «Словарика» в разделах `root` и открывает облачко по нажатию: `open` — слово и
 * кнопка, у которой встаёт облачко.
 */
export function usePageGlossary(
  root: RefObject<HTMLElement | null>,
  gloss: readonly CpGloss[],
  open: (i: number, anchor: HTMLElement) => void,
): void {
  const t = useT();
  const title = t('cph.gloss.what');
  const index = useMemo(() => cpGlossIndex(gloss), [gloss]);
  const onOpen = useEffectEvent(open);
  useEffect(() => {
    const el = root.current;
    if (!el || !index.rx) return;
    let splits: Split[] = [];
    // Вернуть разметку, как её оставил React: текст, который React сменил сам, не трогается.
    const undo = (changed: ReadonlySet<Node>) => {
      for (const s of splits) {
        for (const n of s.added) n.parentNode?.removeChild(n);
        if (s.node.isConnected && !changed.has(s.node) && s.node.nodeValue === s.head) {
          s.node.nodeValue = s.full;
        }
      }
      splits = [];
    };
    const apply = () => {
      for (const scope of el.querySelectorAll<HTMLElement>(SCOPES)) {
        const used = new Set<number>();
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            n.nodeValue?.trim() && !n.parentElement?.closest(SKIP)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT,
        });
        const nodes: Text[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
        for (const node of nodes) {
          const full = node.nodeValue ?? '';
          const parts = cpGlossSplit(full, index, used);
          if (parts.every((p) => typeof p === 'string')) continue;
          const head = typeof parts[0] === 'string' ? parts[0] : '';
          const rest = typeof parts[0] === 'string' ? parts.slice(1) : parts;
          const added = rest.map((p) =>
            typeof p === 'string' ? document.createTextNode(p) : wordButton(p.i, p.text, title),
          );
          node.nodeValue = head;
          node.after(...added);
          splits.push({ node, full, head, added });
        }
      }
    };
    const observer = new MutationObserver((records) => {
      const changed = new Set<Node>();
      for (const r of records) if (r.type === 'characterData') changed.add(r.target);
      observer.disconnect();
      undo(changed);
      apply();
      observer.takeRecords();
      observer.observe(el, OBSERVE);
    });
    const click = (e: MouseEvent) => {
      const b = (e.target as Element | null)?.closest<HTMLElement>('[data-pub-gl]');
      if (!b || !el.contains(b)) return;
      e.preventDefault();
      onOpen(Number(b.dataset.pubGl), b);
    };
    apply();
    observer.observe(el, OBSERVE);
    el.addEventListener('click', click);
    return () => {
      observer.disconnect();
      el.removeEventListener('click', click);
      undo(new Set());
    };
  }, [root, index, title]);
}

/**
 * Облачко слова «Словарика» (прототип `cphGlossPop`): слово с большой буквы и объяснение. Закрывается
 * крестиком, нажатием мимо, Esc и «Назад»; страница остаётся на месте.
 */
export function GlossPop({
  word,
  anchor,
  onClose,
}: {
  word: CpGloss;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const t = useT();
  const title = cpHelpCap(word.w);
  return (
    <FloatingPanel anchor={anchor} label={title} onClose={onClose}>
      <div
        data-pub-gloss-pop=""
        className="flex max-w-[min(320px,calc(100vw-24px))] flex-col gap-1.5"
      >
        <div className="flex items-center gap-2">
          <b className="flex-1 text-[14px]">{title}</b>
          <button
            type="button"
            className={`${iconButtonClass('sm')} max-md:min-h-11 max-md:min-w-11`}
            aria-label={t('cph.gloss.close')}
            onClick={() => {
              onClose();
              anchor.focus({ preventScroll: true });
            }}
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
        <p className="m-0 text-[13.5px] leading-[1.5] max-md:text-[16px]">{word.x}</p>
      </div>
    </FloatingPanel>
  );
}
