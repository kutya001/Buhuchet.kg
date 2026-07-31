'use client';

import React, { useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Plus, Camera, FileText, FolderOpen, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPresignedUploadUrlAction } from '@/app/dashboard/files/actions';
import { uploadFileToArchiveAction } from '@/app/dashboard/files/archive-actions';

export function MobileFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Показываем плавающую кнопку FAB СТРОГО ТОЛЬКО В РЕЕСТРЕ ФАЙЛОВ!
  if (pathname !== '/dashboard/files') {
    return null;
  }

  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploading(true);

    try {
      const file = e.target.files[0];
      const presignedRes = await getPresignedUploadUrlAction(file.name, file.type);

      if (presignedRes.success && presignedRes.data) {
        const { uploadUrl, fileKey } = presignedRes.data;

        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        // Сохраняем в личный архив
        await uploadFileToArchiveAction({
          category_id: 'Товарные накладные',
          file_name: `Фото_скан_${Date.now()}.jpg`,
          file_size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
          file_type: 'image',
          file_path_r2: fileKey,
          description: `Скан с нативной камеры смартфона ${new Date().toLocaleDateString('ru-RU')}`,
          comment: 'Загружено через мобильную кнопку FAB',
        });

        setIsOpen(false);
        router.push('/dashboard/files');
      }
    } catch (err) {
      console.error('Ошибка быстрой съёмки через FAB:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {/* Скрытый инпут нативной камеры */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraCapture}
        className="hidden"
      />

      {/* Круглая Плавающая Кнопка FAB под правый палец (Только на мобильных в Реестре Файлов) */}
      <div className="md:hidden fixed bottom-20 right-4 z-40">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl shadow-blue-600/50 border border-blue-400/40 backdrop-blur-xl active:scale-95 transition-all"
          aria-label="Быстрые действия"
        >
          <Plus className="h-7 w-7" />
        </button>
      </div>

      {/* Нативная Нижняя Шторка (Bottom Sheet) быстрых действий */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full bg-card border-t border-border rounded-t-3xl p-6 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-300">
            {/* Полоска-индикатор шторки */}
            <div className="w-12 h-1.5 bg-border rounded-full mx-auto mb-2 opacity-80" />

            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-base font-bold text-foreground">Быстрые Действия</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {uploading ? (
              <div className="flex items-center justify-center space-x-2 py-6 text-blue-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm font-medium">Передача снимка в Cloudflare R2...</span>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                {/* 1. Нативная Камера */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full min-h-[52px] p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center space-x-3 active:scale-98 transition-all"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <span className="font-bold text-sm text-emerald-300 block">📸 Сделать фото скана</span>
                    <span className="text-[11px] text-emerald-400/70">Запуск нативной камеры смартфона</span>
                  </div>
                </button>

                {/* 2. Создать документ */}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    router.push('/dashboard/documents/new');
                  }}
                  className="w-full min-h-[52px] p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center space-x-3 active:scale-98 transition-all"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <span className="font-bold text-sm text-blue-300 block">📝 Создать документ</span>
                    <span className="text-[11px] text-blue-400/70">Отправка накладной партнеру</span>
                  </div>
                </button>

                {/* 3. Загрузить в Архив */}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    router.push('/dashboard/files');
                  }}
                  className="w-full min-h-[52px] p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center space-x-3 active:scale-98 transition-all"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-purple-400">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <span className="font-bold text-sm text-purple-300 block">📁 Личный Архив Файлов</span>
                    <span className="text-[11px] text-purple-400/70">Внутреннее хранилище компании</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
