import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/telegram/notifier';

export async function POST(req: Request) {
  try {
    // 0. Авторизация по секретному токену X-Telegram-Bot-Api-Secret-Token
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret.trim() !== '') {
      const receivedToken = req.headers.get('x-telegram-bot-api-secret-token');
      if (receivedToken !== webhookSecret.trim()) {
        return NextResponse.json({ error: 'Unauthorized: invalid secret token' }, { status: 401 });
      }
    }

    const update = await req.json();

    if (!update.message || !update.message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const telegramUserId = update.message.from.id;
    const username = update.message.from.username || null;
    const text = update.message.text.trim();

    const supabase = await createAdminClient();

    // Запись события в системные логи аудита
    await supabase.from('telegram_logs').insert({
      chat_id: chatId,
      username,
      message_text: text,
      status: 'received',
    });

    // Проверяем, ввёл ли пользователь 4-значный код (например: 8737 или /start 8737)
    const codeMatch = text.match(/\/start\s+(\d{4})/) || text.match(/^(\d{4})$/);

    if (codeMatch) {
      const code = codeMatch[1];

      // 1. Поиск активного неистекшего кода
      const { data: verification, error } = await supabase
        .from('telegram_verification_codes')
        .select('*, company:companies(*)')
        .eq('code', code)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle();

      if (error || !verification) {
        await sendTelegramMessage(
          chatId,
          '❌ **Неверный или истекший код подтверждения.**\n\nСгенерируйте новый 4-значный код в личной панели Buhuchet.kg и отправьте его сюда.'
        );
        return NextResponse.json({ ok: true });
      }

      const companyObj = Array.isArray(verification.company) ? verification.company[0] : verification.company;
      const companyName = companyObj?.name || 'Организация';

      // 2. Сохраняем привязку Telegram
      const { error: saveError } = await supabase
        .from('telegram_connections')
        .upsert(
          {
            user_id: verification.user_id,
            company_id: verification.company_id,
            telegram_chat_id: chatId,
            telegram_user_id: telegramUserId,
            telegram_username: username,
          },
          { onConflict: 'user_id,company_id' }
        );

      if (saveError) {
        await sendTelegramMessage(chatId, `⚠️ Ошибка сохранения связи: ${saveError.message}`);
        return NextResponse.json({ ok: true });
      }

      // 3. Удаляем использованный код
      await supabase
        .from('telegram_verification_codes')
        .delete()
        .eq('id', verification.id);

      await sendTelegramMessage(
        chatId,
        `✅ **Аккаунт успешно привязан!**\n\nВы подключены к уведомлениям компании **${companyName}** в платформе Buhuchet.kg.`
      );
    } else {
      // На /start или любой иной текст шлем справку о платформе и просим ввести 4-значный код
      await sendTelegramMessage(
        chatId,
        '👋 **Добро пожаловать в ЭДО Платформу Buhuchet.kg!**\n\n' +
          'Buhuchet.kg — это облачная система электронного бухгалтерского документооборота в Кыргызской Республике. Платформа предназначена для моментального обмена первичными документами (ЭСФ, АВР, накладные, акты сверки) и автоматической выгрузки в 1С.\n\n' +
          'Пожалуйста, введите **4-значный код подтверждения** из вашего личного кабинета для завершения привязки.'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Telegram Webhook Error]:', err);
    return NextResponse.json({ ok: true });
  }
}

/**
 * GET запрос для проверки статуса или быстрой привязки setWebhook из браузера
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const host = req.headers.get('host') || 'buhuchet.kg';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
    const rawToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!rawToken) {
      return NextResponse.json({ success: false, error: 'TELEGRAM_BOT_TOKEN не задан в Vercel / .env' });
    }
    const token = rawToken.trim();
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    // Если передан флаг ?action=info, запрашиваем текущую информацию
    if (searchParams.get('action') === 'info') {
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const info = await res.json();
      return NextResponse.json({ success: true, info });
    }

    // Регистрируем webhookUrl в Telegram API с заголовочным секретом
    let setWebhookEndpoint = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    if (webhookSecret && webhookSecret.trim() !== '') {
      setWebhookEndpoint += `&secret_token=${encodeURIComponent(webhookSecret.trim())}`;
    }

    const res = await fetch(setWebhookEndpoint);
    const data = await res.json();

    return NextResponse.json({
      success: data.ok,
      message: data.ok ? 'Webhook успешно зарегистрирован в Telegram с защищенным секретом!' : 'Ошибка привязки Webhook',
      webhookUrl,
      telegramResponse: data,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой вызова setWebhook';
    return NextResponse.json({ success: false, error: errorMsg });
  }
}
