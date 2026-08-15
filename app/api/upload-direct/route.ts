import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { r2Client, r2BucketName } from '@/lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export async function POST(req: NextRequest) {
  try {
    const adminSupabase = await createAdminClient();
    
    // Получаем авторизованного пользователя из сессии
    const authHeader = req.headers.get('authorization');
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || undefined
    );

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, error: 'Файл не передан в форму' }, { status: 400 });
    }

    // Определяем компании из формовых данных или пользователя
    const companyIdFromForm = formData.get('company_id') as string;
    let targetCompanyId = companyIdFromForm;

    if (!targetCompanyId && user) {
      const { data: prof } = await adminSupabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();
      targetCompanyId = prof?.company_id || 'system';
    }

    if (!targetCompanyId) {
      targetCompanyId = 'anonymous';
    }

    // Если загрузка идет от конкретной организации — проверяем квоту Облачного диска
    if (targetCompanyId && targetCompanyId !== 'anonymous' && targetCompanyId !== 'system') {
      const { assertCanUploadFile } = await import('@/lib/auth/subscription-lock');
      await assertCanUploadFile(targetCompanyId, file.size);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uniqueId = Math.random().toString(36).substring(2, 10);
    const safeFileName = (file.name || 'scan.jpg').replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `companies/${targetCompanyId}/${year}/${month}/${uniqueId}-${safeFileName}`;

    let cleanContentType = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!cleanContentType || cleanContentType === 'application/octet-stream') {
      cleanContentType = safeFileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    }

    await r2Client.send(
      new PutObjectCommand({
        Bucket: r2BucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: cleanContentType,
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        fileKey,
      },
    });
  } catch (err: any) {
    console.error('[API Direct Upload Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Ошибка загрузки в R2' },
      { status: 500 }
    );
  }
}
