'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Upload, Camera, FileText, X, Loader2, CheckCircle2, AlertCircle, Folder, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPresignedUploadUrlAction, uploadFileDirectlyServerAction } from '@/app/dashboard/files/actions';
import type { FileCategory } from '@/types/database.types';
import { formatBytes } from '@/lib/utils';

export interface FileItemState {
  tempId: string;
  category_id: string;
  file_name: string;
  size_bytes: number;
  file_type: string;
  file_path_r2?: string;
  description: string;
  comment: string;
  progress?: number;
  uploading?: boolean;
  error?: string;
}

interface MultiFileDropzoneProps {
  categories: FileCategory[];
  files: FileItemState[];
  onFilesChange: (files: FileItemState[]) => void;
  disabled?: boolean;
}

export function MultiFileDropzone({
  categories,
  files,
  onFilesChange,
  disabled = false,
}: MultiFileDropzoneProps) {
  const [globalUploading, setGlobalUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Реф для хранения актуального списка файлов без старых замыканий
  const filesRef = useRef<FileItemState[]>(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const updateFileList = (updater: (prev: FileItemState[]) => FileItemState[]) => {
    const nextList = updater(filesRef.current);
    filesRef.current = nextList;
    onFilesChange(nextList);
  };

  const uploadFileToR2 = async (file: File, item: FileItemState) => {
    try {
      const mimeType = file.type && file.type.length > 0 ? file.type : 'image/jpeg';
      const cleanFileName = file.name || `scan_${Date.now()}.jpg`;

      // 1. Запрашиваем Presigned PUT URL от сервера
      const presignedRes = await getPresignedUploadUrlAction(cleanFileName, mimeType);

      let finalFileKey = '';

      if (presignedRes.success && presignedRes.data) {
        const { uploadUrl, fileKey, cleanContentType } = presignedRes.data;
        const targetType = cleanContentType || mimeType;

        // Попытка прямого XHR PUT в Cloudflare R2
        try {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            xhr.setRequestHeader('Content-Type', targetType);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                updateFileList((prev) =>
                  prev.map((f) => (f.tempId === item.tempId ? { ...f, progress: percent } : f))
                );
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`Status ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error('CORS / Network Error'));
            xhr.send(file);
          });

          finalFileKey = fileKey;
        } catch (directErr) {
          console.warn('Прямой XHR PUT заблокирован браузером/CORS. Переключение на надежный Серверный Прокси-Загрузчик R2...', directErr);

          // 2. ДВУХУРОВНЕВЫЙ ФОЛЛБЭК: Отправка файла через Server Action прямо на наш бэкенд Buhuchet.kg
          const formData = new FormData();
          formData.append('file', file);

          const serverRes = await uploadFileDirectlyServerAction(formData);
          if (serverRes.success && serverRes.data) {
            finalFileKey = serverRes.data.fileKey;
          } else {
            throw new Error(serverRes.error || 'Ошибка серверной загрузки в Cloudflare R2');
          }
        }
      } else {
        // Если Presigned URL сразу не сгенерировался — пробуем прямой серверный прокси
        const formData = new FormData();
        formData.append('file', file);
        const serverRes = await uploadFileDirectlyServerAction(formData);

        if (serverRes.success && serverRes.data) {
          finalFileKey = serverRes.data.fileKey;
        } else {
          throw new Error(serverRes.error || 'Ошибка загрузки в R2');
        }
      }

      // 3. Обновляем статус 100% готовности R2
      updateFileList((prev) =>
        prev.map((f) =>
          f.tempId === item.tempId
            ? { ...f, file_path_r2: finalFileKey, progress: 100, uploading: false, error: undefined }
            : f
        )
      );
    } catch (err: any) {
      console.error('Ошибка R2:', err);
      updateFileList((prev) =>
        prev.map((f) =>
          f.tempId === item.tempId
            ? { ...f, uploading: false, error: err.message || 'Сбой загрузки' }
            : f
        )
      );
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setGlobalUploading(true);
    const selectedFiles = Array.from(e.target.files);

    const defaultCategory = categories[0]?.id || '268dda23-d839-429d-bec2-aae391cffb00';

    const newItems: FileItemState[] = selectedFiles.map((file, idx) => {
      const rawName = file.name || `photo_${idx}.jpg`;
      const isCameraPhoto = rawName.startsWith('image') || rawName.startsWith('photo') || rawName.includes('blob');
      const name = isCameraPhoto ? `Фото_скан_${Date.now()}_${idx + 1}.jpg` : rawName;

      return {
        tempId: `${Date.now()}-${idx}`,
        category_id: defaultCategory,
        file_name: name,
        size_bytes: file.size,
        file_type: (file.type || '').includes('pdf') ? 'pdf' : 'image',
        description: `Скан ${name}`,
        comment: '',
        progress: 0,
        uploading: true,
      };
    });

    // Сразу добавляем новые файлы в список
    updateFileList((prev) => [...prev, ...newItems]);

    // Запускаем асинхронную двухуровневую загрузку каждого файла
    for (let i = 0; i < selectedFiles.length; i++) {
      await uploadFileToR2(selectedFiles[i], newItems[i]);
    }

    setGlobalUploading(false);
    e.target.value = '';
  };

  const handleRemoveFile = (tempId: string) => {
    updateFileList((prev) => prev.filter((f) => f.tempId !== tempId));
  };

  const handleFileItemChange = (tempId: string, field: keyof FileItemState, value: string) => {
    updateFileList((prev) =>
      prev.map((f) => (f.tempId === tempId ? { ...f, [field]: value } : f))
    );
  };

  return (
    <div className="space-y-4">
      {/* Скрытые инпуты для стандартного файла и для нативной КАМЕРЫ */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf"
        onChange={handleFileSelect}
        disabled={disabled || globalUploading}
        className="hidden"
      />

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        disabled={disabled || globalUploading}
        className="hidden"
      />

      {/* Кнопки выбора файлов */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => !disabled && !globalUploading && cameraInputRef.current?.click()}
          disabled={disabled || globalUploading}
          className="p-4 rounded-xl border-2 border-dashed border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all flex flex-col items-center justify-center text-center space-y-2 cursor-pointer active:scale-95 min-h-[48px]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <Camera className="h-6 w-6" />
          </div>
          <div>
            <span className="font-bold text-sm text-emerald-300">📸 Сделать снимки сканов</span>
            <p className="text-[11px] text-emerald-400/70">Запуск нативной камеры смартфона</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => !disabled && !globalUploading && fileInputRef.current?.click()}
          disabled={disabled || globalUploading}
          className="p-4 rounded-xl border-2 border-dashed border-border bg-card hover:bg-muted hover:border-blue-500/50 transition-all flex flex-col items-center justify-center text-center space-y-2 cursor-pointer active:scale-95 min-h-[48px]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
            <Folder className="h-6 w-6" />
          </div>
          <div>
            <span className="font-bold text-sm text-foreground">📁 Выбрать сканы / PDF</span>
            <p className="text-[11px] text-muted-foreground">Из памяти смартфона или ПК</p>
          </div>
        </button>
      </div>

      {globalUploading && (
        <div className="flex items-center justify-center space-x-2 py-3 text-blue-400 bg-blue-500/10 rounded-xl border border-blue-500/20">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Передача файлов в защищённое облако...</span>
        </div>
      )}

      {/* Список прикрепленных файлов */}
      {files.length > 0 && (
        <div className="space-y-3 pt-2">
          <Label className="text-xs font-mono uppercase text-muted-foreground">
            Сканы для сохранения ({files.length})
          </Label>

          {files.map((file) => (
            <div
              key={file.tempId}
              className="p-4 rounded-xl bg-card border border-border space-y-3 shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 flex-shrink-0">
                    {file.uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                    ) : (
                      <FileCheck className="h-5 w-5 text-emerald-400" />
                    )}
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {formatBytes(file.size_bytes)} • {file.file_path_r2 ? '✅ Готов к сохранению (R2)' : 'Загрузка...'}
                    </p>
                  </div>
                </div>

                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(file.tempId)}
                    className="h-9 w-9 p-0 text-slate-500 hover:text-red-400 min-h-[44px]"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                )}
              </div>

              {file.uploading && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>Загрузка в R2</span>
                    <span>{file.progress || 0}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-200"
                      style={{ width: `${file.progress || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {file.error && (
                <div className="text-xs text-red-400 flex items-center">
                  <AlertCircle className="h-3.5 w-3.5 mr-1" />
                  {file.error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-400">Категория *</Label>
                  <select
                    value={file.category_id}
                    onChange={(e) => handleFileItemChange(file.tempId, 'category_id', e.target.value)}
                    disabled={disabled}
                    className="w-full h-10 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-slate-100 focus:outline-none"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[11px] text-slate-400">Описание * (обязательно)</Label>
                  <Input
                    value={file.description}
                    onChange={(e) => handleFileItemChange(file.tempId, 'description', e.target.value)}
                    placeholder="Например: Устав компании с печатями"
                    disabled={disabled}
                    required
                    className="h-10 text-xs bg-slate-900 border-slate-800 text-slate-100 rounded-xl"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
