import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://buhuchet.kg';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/register', '/onboarding'],
        disallow: ['/uchet/', '/admin/', '/api/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
