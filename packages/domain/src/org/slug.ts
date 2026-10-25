/** Транслитерация для адресов страниц (прототип core/utils.js, TRL). */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  ң: 'ng',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

const SLUG_MAX = 30;

/**
 * Латинское имя для адреса страницы по названию: «ОсОО «Бухгалтер Плюс»» → buhgalter-plyus.
 * Форма собственности в начале и кавычки отбрасываются (прототип core/utils.js, slugOf).
 */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*(осоо|оао|зао|ао|оо|ип|гп|мп|чп|ф\/х|кх|оф)\s+/, '')
    .replace(/[«»"'“”„]/g, '')
    .replace(/[а-яёңөү]/g, (c) => TRANSLIT[c] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

/** Первый свободный адрес: name, name-2, name-3… (прототип core/utils.js, slugFree). */
export function slugFree(base: string, taken: readonly string[]): string {
  const b = base.length >= 3 ? base : (base ? `${base}-org` : 'org').slice(0, SLUG_MAX);
  let slug = b;
  for (let i = 2; taken.includes(slug); i++) {
    const tail = `-${i}`;
    slug = b.slice(0, SLUG_MAX - tail.length).replace(/-+$/, '') + tail;
  }
  return slug;
}

/** Адрес страницы организации: 3–30 символов, строчные латинские буквы, цифры и дефис. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]{3,30}$/.test(slug);
}
