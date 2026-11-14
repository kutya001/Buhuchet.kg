import { describe, expect, it } from 'vitest';
import { dropAddressParam, linkedRecordId, type AddressHost } from './record-link';

// Ссылка «Открыть» из сообщения бота (прототип v97 `tgOpenBtn`): номер записи в адресе и чистый адрес
// после открытия карточки.

function host(href: string) {
  const calls: { state: unknown; url: string }[] = [];
  const h: AddressHost = {
    location: { href },
    history: {
      state: { tree: 1 },
      replaceState: (state, _title, url) => {
        calls.push({ state, url: String(url) });
      },
    },
  };
  return { h, calls };
}

describe('ссылка на запись из сообщения бота', () => {
  it('номер записи — только uuid', () => {
    const id = '54fb3290-78be-4ef8-b171-2523fa41b081';
    expect(linkedRecordId(id)).toBe(id);
    expect(linkedRecordId(id.toUpperCase())).toBe(id.toUpperCase());
    for (const bad of [null, '', '15', `${id}x`, `${id}/../x`, '<script>'])
      expect(linkedRecordId(bad)).toBeNull();
  });

  it('параметр убирается из адреса без перехода, остальное остаётся; состояние истории — прежнее', () => {
    const { h, calls } = host(
      'https://buhuchet.kg/app/reports/all?report=54fb3290-78be-4ef8-b171-2523fa41b081',
    );
    dropAddressParam('report', h);
    expect(calls).toEqual([{ state: { tree: 1 }, url: '/app/reports/all' }]);
    const more = host('https://buhuchet.kg/app/tasks/mine?task=1&plate=late#top');
    dropAddressParam('task', more.h);
    expect(more.calls).toEqual([{ state: { tree: 1 }, url: '/app/tasks/mine?plate=late#top' }]);
  });

  it('параметра нет — адрес не трогается', () => {
    const { h, calls } = host('https://buhuchet.kg/app/tasks/mine?plate=late');
    dropAddressParam('task', h);
    expect(calls).toEqual([]);
  });
});
