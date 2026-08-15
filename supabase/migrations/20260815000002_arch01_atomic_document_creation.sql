-- =============================================================================
-- МИГРАЦИЯ 20260815000002: АТОМАРНОЕ СОЗДАНИЕ ДОКУМЕНТОВ И ФАЙЛОВ (ARCH-01)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_document_atomic(
    p_company_id UUID,
    p_author_id UUID,
    p_sender_company_id UUID,
    p_receiver_company_id UUID,
    p_doc_number TEXT,
    p_doc_date DATE,
    p_doc_type TEXT,
    p_status TEXT,
    p_comment TEXT,
    p_mock_file_name TEXT,
    p_mock_file_size BIGINT,
    p_files JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_doc_id UUID;
    v_new_doc RECORD;
    v_file JSONB;
    v_inserted_files JSONB := '[]'::JSONB;
    v_file_record RECORD;
BEGIN
    -- 1. Атомарное создание записи документа в documents
    INSERT INTO public.documents (
        company_id,
        author_id,
        sender_company_id,
        receiver_company_id,
        doc_number,
        doc_date,
        doc_type,
        status,
        comment,
        mock_file_name,
        mock_file_size
    ) VALUES (
        p_company_id,
        p_author_id,
        p_sender_company_id,
        p_receiver_company_id,
        p_doc_number,
        p_doc_date,
        p_doc_type,
        p_status,
        p_comment,
        p_mock_file_name,
        p_mock_file_size
    )
    RETURNING * INTO v_new_doc;

    v_doc_id := v_new_doc.id;

    -- 2. Атомарная вставка прикрепленных файлов в таблицу files и регистрация в file_owners
    IF p_files IS NOT NULL AND jsonb_array_length(p_files) > 0 THEN
        FOR v_file IN SELECT * FROM jsonb_array_elements(p_files)
        LOOP
            INSERT INTO public.files (
                company_id,
                document_id,
                category_id,
                file_name,
                size_bytes,
                file_type,
                file_path_r2,
                description,
                comment,
                is_internal,
                is_legal_doc
            ) VALUES (
                p_company_id,
                v_doc_id,
                (v_file->>'category_id')::UUID,
                v_file->>'file_name',
                COALESCE((v_file->>'size_bytes')::BIGINT, 1572864),
                COALESCE(v_file->>'file_type', 'pdf'),
                v_file->>'file_path_r2',
                COALESCE(v_file->>'description', 'Прикрепленный скан ' || (v_file->>'file_name')),
                v_file->>'comment',
                false,
                false
            )
            RETURNING * INTO v_file_record;

            -- Регистрация владельца в file_owners для Copy-on-Write
            INSERT INTO public.file_owners (
                file_id,
                company_id,
                is_original_creator
            ) VALUES (
                v_file_record.id,
                p_company_id,
                true
            )
            ON CONFLICT (file_id, company_id) DO NOTHING;
        END LOOP;
    END IF;

    -- 3. Создание записи в журнале документа document_logs
    INSERT INTO public.document_logs (
        document_id,
        user_id,
        old_status,
        new_status,
        comment
    ) VALUES (
        v_doc_id,
        p_author_id,
        NULL,
        p_status,
        CASE WHEN p_status = 'sent' THEN 'Документ отправлен адресату' ELSE 'Документ сохранен как черновик' END
    );

    RETURN to_jsonb(v_new_doc);
END;
$$;
