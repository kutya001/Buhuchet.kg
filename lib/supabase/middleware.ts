import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Получаем текущего пользователя для рефреша токена
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Публичные маршруты
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register');
  const isOnboardingRoute = pathname.startsWith('/onboarding');
  const isSuperAdminRoute = pathname.startsWith('/admin');

  // 1. Если пользователь не авторизован и заходит на защищенный маршрут
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 2. Если пользователь авторизован и заходит на /login
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/uchet';
    return NextResponse.redirect(url);
  }

  // 3. Проверяем наличие привязанной компании у пользователя
  if (user && !isAuthRoute && !isSuperAdminRoute) {
    const { data: profile } = await supabase
      .from('users')
      .select('company_id, is_super_admin')
      .eq('id', user.id)
      .single();

    // Если у пользователя нет компании и он не суперадмин, редиректим на /onboarding
    if (!profile?.company_id && !profile?.is_super_admin && !isOnboardingRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }

    // Если компания есть, но пользователь снова пытается зайти на /onboarding
    if (profile?.company_id && isOnboardingRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/uchet';
      return NextResponse.redirect(url);
    }
  }

  // 4. Защита маршрута /super-admin
  if (user && isSuperAdminRoute) {
    const { data: profile } = await supabase
      .from('users')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/uchet';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
