import type { MetadataRoute } from 'next';

// Программа за входом и страницы контрагентов не индексируются.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
