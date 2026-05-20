-- Search Term Report Upload Tabellen
-- In Supabase SQL Editor ausführen

CREATE TABLE IF NOT EXISTS sqpr_str_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL,
    report_id uuid NOT NULL,
    row_count integer,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sqpr_str_terms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id uuid NOT NULL,
    client_id uuid NOT NULL,
    report_id uuid NOT NULL,
    search_term text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sqpr_str_terms_report_id ON sqpr_str_terms(report_id);
CREATE INDEX IF NOT EXISTS idx_sqpr_str_terms_client_id ON sqpr_str_terms(client_id);
