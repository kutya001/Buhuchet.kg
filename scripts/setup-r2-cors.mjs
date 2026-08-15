import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { loadEnv } from './benchmarks/utils.mjs';

loadEnv();

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const bucketName = process.env.R2_BUCKET_NAME || 'buhuchet-scans';
const customEndpoint = process.env.R2_ENDPOINT;

const endpoint = customEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

if (!accessKeyId || !secretAccessKey) {
  console.error('❌ Ошибка: R2_ACCESS_KEY_ID и R2_SECRET_ACCESS_KEY должны быть заданы в .env.local');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: endpoint || undefined,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function main() {
  console.log(`📡 Применение CORS политики для Cloudflare R2 бакета "${bucketName}"...`);
  console.log(`🌐 Endpoint: ${endpoint}`);

  const corsRules = [
    {
      AllowedOrigins: [
        'https://www.buhuchet.kg',
        'https://buhuchet.kg',
        'http://localhost:3000',
        'http://localhost:3001',
      ],
      AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'x-amz-request-id', 'Content-Type', 'Content-Length'],
      MaxAgeSeconds: 3600,
    },
  ];

  try {
    const putCommand = new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: corsRules,
      },
    });

    await client.send(putCommand);
    console.log('✅ CORS конфигурация успешно применена к бакету Cloudflare R2!');

    try {
      const getCommand = new GetBucketCorsCommand({ Bucket: bucketName });
      const res = await client.send(getCommand);
      console.log('📋 Подтвержденные правила CORS в бакете:');
      console.log(JSON.stringify(res.CORSRules, null, 2));
    } catch (e) {
      console.log('ℹ️ CORS установлен.');
    }
  } catch (err) {
    console.error('❌ Ошибка применения CORS к бакету R2:', err);
    process.exit(1);
  }
}

main();
