'use client';

import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Plus, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FileCategory } from '@/types/database.types';

export interface FileItemState {
  tempId: string;
  category_id: string;
  file_name: string;
  file_size: string;
  file_type: string;
  description: string;
  comment: string;
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setUploading(true);

    const newItems: FileItemState[] = Array.from(e.target.files).map((file, idx) => {
      const formattedSize =
        file.size > 1024 * 1024
          ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.round(file.size / 1024)} KB`;

      // Дефолтное определение категории
      const defaultCategory = categories[0]?.id || '';

      return {
        tempId: `${Date.now()}-${idx}`,
        category_id: defaultCategory,
        file_name: file.name,
        file_size: formattedSize,
        file_type: file.type.includes('pdf') ? 'pdf' : 'image',
        description: `Скан документа ${file.name}`,
        comment: '',
      };
    });

    setTimeout(() => {
      onFilesChange([...files, ...newItems]);
      setUploading(false);
    }, 500);
  };

  const handleRemoveFile = (tempId: string) => {
    onFilesChange(files.filter((f) => f.tempId !== tempId));
  };

  const handleFileItemChange = (tempId: string, field: keyof FileItemState, value: string) => {
    onFilesChange(
      files.map((f) => {
        if (f.tempId === tempId) {
          return { ...f, [field]: value };
        }
        return f;
      })
    );
  };

  return (
    <div className="space-y-4">
      {/* Drop Area Button */}
      <div
        onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
        className={`p-5 rounded-xl border-2 border-dashed transition-all text-center cursor-pointer ${
          disabled || uploading
            ? 'opacity-50 border-slate-800 bg-slate-900/20 cursor-not-allowed'
            : 'border-slate-800 bg-slate-900/40 hover:border-blue-500/50 hover:bg-slate-900/70'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf"
          onChange={handleFileSelect}
          disabled={disabled || uploading}
          className="hidden"
        />

        {uploading ? (
          <div className="flex items-center justify-center space-x-2 py-2 text-blue-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">Загрузка и прикрепление файлов...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 mb-1">
              <Upload className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-slate-200">
              Нажмите для мультизагрузки файлов (PDF, PNG, JPG)
            </p>
            <p className="text-xs text-slate-500">Вы можете прикрепить несколько сканов одновременно</p>
          </div>
        )}
      </div>

      {/* Список загруженных файлов с обязательными полями */}
      {files.length > 0 && (
        <div className="space-y-3">
          <Label className="text-xs font-mono uppercase text-slate-400">
            Прикрепленные файлы ({files.length})
          </Label>

          {files.map((file, idx) => (
            <div
              key={file.tempId}
              className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 flex-shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-medium text-white truncate">{file.file_name}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{file.file_size}</p>
                  </div>
                </div>

                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(file.tempId)}
                    className="h-8 w-8 p-0 text-slate-500 hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Поля файла */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* Категория */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-400">Категория файла *</Label>
                  <select
                    value={file.category_id}
                    onChange={(e) => handleFileItemChange(file.tempId, 'category_id', e.target.value)}
                    disabled={disabled}
                    className="w-full h-8 rounded border border-slate-800 bg-slate-900 px-2 text-xs text-slate-100 focus:outline-none"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Описание (Обязательное) */}
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-[11px] text-slate-400">Описание файла * (обязательно)</Label>
                  <Input
                    value={file.description}
                    onChange={(e) => handleFileItemChange(file.tempId, 'description', e.target.value)}
                    placeholder="Например: Оригинал накладной с печатью получателя"
                    disabled={disabled}
                    required
                    className="h-8 text-xs bg-slate-900 border-slate-800 text-slate-100"
                  />
                </div>

                {/* Дополнительный комментарий */}
                <div className="space-y-1 md:col-span-3">
                  <Label className="text-[11px] text-slate-500">Дополнительный комментарий</Label>
                  <Input
                    value={file.comment}
                    onChange={(e) => handleFileItemChange(file.tempId, 'comment', e.target.value)}
                    placeholder="Примечания по файлу..."
                    disabled={disabled}
                    className="h-8 text-xs bg-slate-900/60 border-slate-800 text-slate-300"
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
