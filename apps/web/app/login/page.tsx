import { RETURN_PARAM } from '@buhuchet/domain';
import { redirect } from 'next/navigation';
import { LoginScreen } from '../../src/auth/login-screen';
import { afterLogin } from '../../src/auth/return-to';
import { BrandIntro } from '../../src/shell/brand-intro';
import { canEnter } from '../../src/shell/modules';
import { loadMe } from '../../src/shell/server';

/**
 * Страница входа (задача #13). Вошедшего ведёт в программу; кто вошёл с временным паролем и ещё не
 * сменил его, сразу видит смену пароля — в программу его не пускает и макет `app/app/layout.tsx`.
 * `?next=/app/…` — страница программы, на которую вернуться после входа (задача #165). При загрузке страницы —
 * заставка с логотипом (прототип v78, buIntro в start.js), при переходе на неё с лендинга — без неё.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const returnTo = afterLogin((await searchParams)[RETURN_PARAM]);
  const me = await loadMe();
  const mustChange = me?.user.mustChangePassword ? me : null;
  if (canEnter(me)) redirect(returnTo);
  return (
    <>
      <BrandIntro onlyOnLoad />
      <LoginScreen me={mustChange} returnTo={returnTo} />
    </>
  );
}
