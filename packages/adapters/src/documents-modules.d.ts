// Модули распознавателя без своих типов: подключаются как есть (documents.ts — loadPdfJs, loadLangs).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
declare module '@tesseract.js-data/rus' {
  export const langPath: string;
}
declare module '@tesseract.js-data/kir' {
  export const langPath: string;
}
