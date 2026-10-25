// Вызывается один раз при запуске сервера (не при `next build`): без нужных настроек сайт не стартует,
// а процесс завершается с понятным списком того, чего не хватает (как worker).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertWebConfig } = await import('@buhuchet/api/runtime');
    try {
      assertWebConfig();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
