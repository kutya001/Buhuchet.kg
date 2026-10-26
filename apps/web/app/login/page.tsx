import { redirect } from 'next/navigation';
import { LoginScreen } from '../../src/auth/login-screen';
import { canEnter } from '../../src/shell/modules';
import { loadMe } from '../../src/shell/server';

/**
 * Страница входа (задача #13). Вошедшего ведёт в программу; кто вошёл с временным паролем и ещё не
 * сменил его, сразу видит смену пароля — в программу его не пускает и макет `app/app/layout.tsx`.
 */
export default async function LoginPage() {
  const me = await loadMe();
  const mustChange = me?.user.mustChangePassword ? me : null;
  if (canEnter(me)) redirect('/app');
  return <LoginScreen me={mustChange} />;
}
