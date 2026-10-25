import { loadStorageConfig } from '../config';
import { createS3Storage, explainStorageError } from '../storage';

// Создать корзину файлов, если её нет (локально, в CI и в docker-compose).
const config = loadStorageConfig();
try {
  await createS3Storage(config).ensureBucket();
} catch (error) {
  console.error(explainStorageError(error, config.S3_BUCKET));
  process.exit(1);
}
console.log(`Корзина «${config.S3_BUCKET}» готова.`);
