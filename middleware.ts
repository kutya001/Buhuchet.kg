import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

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

  // Обновляем сессию пользователя
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

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
    // Редирект авторизованного с страниц логина/регистрации
    if (pathname === '/login' || pathname === '/register') {
      const { data: dbUser } = await supabase
        .from('users')
        .select('is_super_admin')
        .eq('id', user.id)
        .single();

      const url = request.nextUrl.clone();
      url.pathname = dbUser?.is_super_admin ? '/super-admin' : '/dashboard';
      return NextResponse.redirect(url);
    }

    // Если Суперадмин переходит на обычную главную дашборда (/dashboard) -> редиректим на /super-admin
    if (pathname === '/dashboard') {
      const { data: dbUser } = await supabase
        .from('users')
        .select('is_super_admin')
        .eq('id', user.id)
        .single();

      if (dbUser?.is_super_admin) {
        const url = request.nextUrl.clone();
        url.pathname = '/super-admin';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
