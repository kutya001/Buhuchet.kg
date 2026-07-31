import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/telegram/notifier';

export async function POST(req: Request) {
  try {
    const update = await req.json();

    if (!update.message || !update.message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const telegramUserId = update.message.from.id;
    const username = update.message.from.username || null;
    const text = update.message.text.trim();

    // Извлекаем код из команды /start 8492 или просто введенного текста 8492
    const codeMatch = text.match(/\/start\s+(\d{4})/) || text.match(/^(\d{4})$/);

    if (codeMatch) {
      const code = codeMatch[1];
      const supabase = await createAdminClient();

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
          '❌ **Неверный или истекший код подтверждения.**\n\nСгенерируйте новый 4-значный код в профиле системы Buhuchet.kg.'
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
      await sendTelegramMessage(
        chatId,
        '👋 **Добро пожаловать в Buhuchet.kg Bot!**\n\nДля привязки аккаунта перейдите по ссылке из Вашего профиля Buhuchet.kg или отправьте полученный 4-значный код.'
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
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return NextResponse.json({ success: false, error: 'TELEGRAM_BOT_TOKEN не задан в Vercel / .env' });
    }

    // Если передан флаг ?action=info, запрашиваем текущую информацию
    if (searchParams.get('action') === 'info') {
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const info = await res.json();
      return NextResponse.json({ success: true, info });
    }

    // Иначе регистрируем webhookUrl в Telegram API
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const data = await res.json();

    return NextResponse.json({
      success: data.ok,
      message: data.ok ? 'Webhook успешно зарегистрирован в Telegram!' : 'Ошибка привязки Webhook',
      webhookUrl,
      telegramResponse: data,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой вызова setWebhook';
    return NextResponse.json({ success: false, error: errorMsg });
  }
}
