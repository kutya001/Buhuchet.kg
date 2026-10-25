import { loadStorageConfig } from '../config';
import { createS3Storage } from '../storage';

// Создать корзину файлов, если её нет (локально, в CI и в docker-compose).
const config = loadStorageConfig();
await createS3Storage(config).ensureBucket();
console.log(`Корзина «${config.S3_BUCKET}» готова.`);
