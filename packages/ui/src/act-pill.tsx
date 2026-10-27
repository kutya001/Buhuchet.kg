import type { ReportAct } from '@buhuchet/domain';
import { pillClass } from './form';
import { Icon } from './icon';

/** Цвет метки по тому, что нужно сделать: сдача — синяя, уплата — зелёная, оба — переход от синего к зелёному. */
const ACT_TONES: Record<ReportAct, string> = {
  sub: 'bg-info-bg text-info-label',
  pay: 'bg-ok-bg text-ok',
  both: 'bg-linear-to-r from-info-bg to-ok-bg text-info-label',
};

/**
 * Цветная метка «Что нужно сделать» у вида отчёта (`actPill` прототипа, controls.css `.pill.actp`):
 * у сдачи — значок файла, у уплаты — монеты, у «Сдача + уплата» — оба. `label` — подпись из словаря.
 */
export function ActPill({
  act,
  label,
  size = 'sm',
}: {
  act: ReportAct;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <span data-pill data-act={act} className={`${pillClass(size)} gap-[3px] ${ACT_TONES[act]}`}>
      {act !== 'pay' ? <Icon name="file" size="sm" /> : null}
      {act !== 'sub' ? <Icon name="coins" size="sm" /> : null}
      {label}
    </span>
  );
}
