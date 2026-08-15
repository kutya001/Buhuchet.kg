import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;

  // 🟢 ИСКЛЮЧЕНИЕ 1: Публичные API эндпоинты (Telegram Webhook, Upload Direct)
  if (pathname.startsWith('/api/telegram/webhook') || pathname.startsWith('/api/upload-direct')) {
    return NextResponse.next();
  }

  // 🟢 АВТОМАТИЧЕСКИЕ 308-РЕДИРЕКТЫ СО СТАРЫХ МАРШРУТОВ
  if (pathname === '/super-admin' || pathname.startsWith('/super-admin/')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/super-admin/, '/admin');
    return NextResponse.redirect(url, 308);
  }

  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/dashboard/, '/uchet');
    return NextResponse.redirect(url, 308);
  }

  // 🟢 ОПТИМИЗАЦИЯ 1: Если нет авторизационной куки Supabase (`sb-`), пропускаем анонимный визит на публичные страницы мгновенно
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
  const isPublicRoute = pathname === '/' || pathname === '/login' || pathname === '/register';

  if (isPublicRoute && !hasAuthCookie) {
    return supabaseResponse;
  }

  // 🟢 ОПТИМИЗАЦИЯ 2: Для всех prefetch-запросов Next.js (ховеры меню, скролл, роутинг) пропускаем сетевые вызовы БД
  const isPrefetch =
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-middleware-prefetch') === '1' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('x-next-prefetch') === '1';

  if (isPrefetch) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Обновляем сессию пользователя только для страниц, где требуется авторизация
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Если неавторизованный пользователь пытается зайти в защищенную зону (/uchet или /admin)
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Если заходит авторизованный пользователь
  if (user) {
    const { data: dbUser } = await supabase
      .from('users')
      .select('company_id, role, role_id, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperAdmin = !!dbUser?.is_super_admin;
    const isOwner = dbUser?.role === 'owner';
    const hasCompany = !!dbUser?.company_id;
    const hasApprovedRole = !!dbUser?.role_id;
    const hasActiveCompany = isSuperAdmin || (hasCompany && (isOwner || hasApprovedRole));

    // Редирект авторизованного с страниц логина/регистрации
    if (pathname === '/login' || pathname === '/register') {
      const url = request.nextUrl.clone();
      url.pathname = isSuperAdmin ? '/admin' : (hasActiveCompany ? '/uchet' : '/uchet/pending');
      return NextResponse.redirect(url);
    }

    // 🔒 Защита контура /admin/*: Доступ только для суперадминистратора
    if (pathname.startsWith('/admin')) {
      if (!isSuperAdmin) {
        const url = request.nextUrl.clone();
        url.pathname = hasActiveCompany ? '/uchet' : '/uchet/pending';
        return NextResponse.redirect(url);
      }
    }

    // Проверка доступа к /onboarding:
    if (pathname.startsWith('/onboarding')) {
      if (hasCompany || (!isOwner && !isSuperAdmin && user.user_metadata?.account_type === 'employee')) {
        const url = request.nextUrl.clone();
        url.pathname = isSuperAdmin ? '/admin' : (hasActiveCompany ? '/uchet' : '/uchet/pending');
        return NextResponse.redirect(url);
      }
    }

    // 🔒 Защита контура /uchet/*:
    if (pathname.startsWith('/uchet')) {
      // Суперадминистратор имеет доступ ко всем контурам, но для обычных пользователей:
      if (!isSuperAdmin) {
        const isAllowedGuestRoute =
          pathname === '/uchet/pending' ||
          pathname.startsWith('/uchet/profile');

        if (!hasActiveCompany && !isAllowedGuestRoute) {
          const url = request.nextUrl.clone();
          url.pathname = '/uchet/pending';
          return NextResponse.redirect(url);
        }

        // Если у пользователя уже есть активная компания, но он зашел на /uchet/pending
        if (hasActiveCompany && pathname === '/uchet/pending') {
          const url = request.nextUrl.clone();
          url.pathname = '/uchet';
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|api/telegram/webhook|api/upload-direct|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
  ],
};
