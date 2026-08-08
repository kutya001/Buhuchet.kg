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

  // 🟢 ОПТИМИЗАЦИЯ 1: Если нет авторизационной куки Supabase (`sb-`), пропускаем анонимный визит на лендинг мгновенно
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
  if (pathname === '/' && !hasAuthCookie) {
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

  // 🟢 ОПТИМИЗАЦИЯ 2: Для prefetch-запросов Next.js (ховеры/скролл)
  const isPrefetch =
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-middleware-prefetch') === '1' ||
    request.headers.get('next-router-prefetch') === '1';

  if (isPrefetch && hasAuthCookie) {
    return supabaseResponse;
  }

  // Обновляем сессию пользователя только для страниц, где требуется авторизация
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ПУБЛИЧНЫЕ МАРШРУТЫ (Лендинг, Логин, Регистрация)
  const isPublicRoute = pathname === '/' || pathname === '/login' || pathname === '/register';

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

    // Если пользователь — не утвержденный сотрудник
    if (pathname.startsWith('/dashboard') && pathname !== '/dashboard/pending') {
      if (
        dbUser &&
        !dbUser.is_super_admin &&
        dbUser.role !== 'owner' &&
        dbUser.company_id &&
        !dbUser.role_id
      ) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard/pending';
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
