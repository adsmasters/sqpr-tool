-- Bulk Sheet Upload Tabellen
-- In Supabase SQL Editor ausführen

CREATE TABLE IF NOT EXISTS sqpr_bulk_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL,
    report_date_start date,
    report_date_end date,
    row_count integer,
    asin_count integer,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sqpr_bulk_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bulk_report_id uuid NOT NULL REFERENCES sqpr_bulk_reports(id) ON DELETE CASCADE,
    client_id uuid NOT NULL,
    asin text,
    sku text,
    search_term text NOT NULL,
    match_type text,
    campaign_name text,
    ad_group_name text,
    impressions integer DEFAULT 0,
    clicks integer DEFAULT 0,
    spend numeric(12,2) DEFAULT 0,
    orders integer DEFAULT 0,
    units integer DEFAULT 0,
    sales numeric(12,2) DEFAULT 0,
    acos numeric(8,4),
    roas numeric(8,4),
    cpc numeric(8,4),
    cvr numeric(8,4)
);

CREATE INDEX IF NOT EXISTS idx_sqpr_bulk_rows_bulk_report ON sqpr_bulk_rows(bulk_report_id);
CREATE INDEX IF NOT EXISTS idx_sqpr_bulk_rows_client ON sqpr_bulk_rows(client_id);
CREATE INDEX IF NOT EXISTS idx_sqpr_bulk_rows_asin ON sqpr_bulk_rows(asin);

-- ASIN-Level SQPR Tabellen
CREATE TABLE IF NOT EXISTS sqpr_asin_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL,
    asin text NOT NULL,
    report_date_start date,
    report_date_end date,
    row_count integer,
    uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sqpr_asin_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asin_report_id uuid NOT NULL REFERENCES sqpr_asin_reports(id) ON DELETE CASCADE,
    client_id uuid NOT NULL,
    asin text NOT NULL,
    search_query text,
    search_query_score numeric(8,4),
    search_query_volume integer,
    impressions_total integer,
    impressions_brand integer,
    impressions_brand_share numeric(8,6),
    clicks_total integer,
    clicks_brand integer,
    clicks_brand_share numeric(8,6),
    cart_adds_total integer,
    cart_adds_brand integer,
    cart_adds_brand_share numeric(8,6),
    purchases_total integer,
    purchases_brand integer,
    purchases_brand_share numeric(8,6)
);

CREATE INDEX IF NOT EXISTS idx_sqpr_asin_rows_report ON sqpr_asin_rows(asin_report_id);
CREATE INDEX IF NOT EXISTS idx_sqpr_asin_rows_client ON sqpr_asin_rows(client_id);
CREATE INDEX IF NOT EXISTS idx_sqpr_asin_rows_asin ON sqpr_asin_rows(asin);
