import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;

  // 🟢 ИСКЛЮЧЕНИЕ 1: Публичные API эндпоинты (Telegram Webhook)
  if (pathname.startsWith('/api/telegram/webhook')) {
    return NextResponse.next();
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

  // Если неавторизованный пользователь пытается зайти в защищенную зону (/dashboard или /super-admin)
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

    // Редирект авторизованного с страниц логина/регистрации
    if (pathname === '/login' || pathname === '/register') {
      const url = request.nextUrl.clone();
      url.pathname = dbUser?.is_super_admin ? '/super-admin' : '/dashboard';
      return NextResponse.redirect(url);
    }

    // Если Суперадмин переходит на /dashboard -> редирект на /super-admin
    if (pathname === '/dashboard' && dbUser?.is_super_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/super-admin';
      return NextResponse.redirect(url);
    }

    const isSuperAdmin = !!dbUser?.is_super_admin;
    const isOwner = dbUser?.role === 'owner';
    const hasCompany = !!dbUser?.company_id;
    const hasApprovedRole = !!dbUser?.role_id;
    const hasActiveCompany = isSuperAdmin || (hasCompany && (isOwner || hasApprovedRole));

    // Проверка доступа к /onboarding:
    // Только пользователи без компании, которые зарегистрировались как владельцы или создают организацию
    if (pathname.startsWith('/onboarding')) {
      if (hasCompany || (!isOwner && !isSuperAdmin && user.user_metadata?.account_type === 'employee')) {
        const url = request.nextUrl.clone();
        url.pathname = hasActiveCompany ? '/dashboard' : '/dashboard/pending';
        return NextResponse.redirect(url);
      }
    }

    // Если пользователь авторизован, но не имеет активной компании:
    // Разрешаем ТОЛЬКО /dashboard/pending и /dashboard/profile
    if (pathname.startsWith('/dashboard')) {
      const isAllowedGuestRoute =
        pathname === '/dashboard/pending' ||
        pathname.startsWith('/dashboard/profile');

      if (!hasActiveCompany && !isAllowedGuestRoute) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard/pending';
        return NextResponse.redirect(url);
      }

      // Если у пользователя уже есть активная компания, но он зашел на /dashboard/pending
      if (hasActiveCompany && pathname === '/dashboard/pending') {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|api/telegram/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
  ],
};
