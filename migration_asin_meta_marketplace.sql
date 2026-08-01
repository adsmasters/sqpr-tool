-- Fix: sqp_asin_meta war nur (spid, asin) — bei Kunden mit mehreren Marktplätzen
-- auf derselben Seller-ID (Recoactiv DE + IT) hat der zuletzt gelaufene Marktplatz
-- die Titel des anderen überschrieben (italienische Titel im DE-Account).
-- Diese Migration macht die Tabelle marketplace-aware. Danach den
-- "ASIN Meta"-Worker (sqp-ingest) neu laufen lassen, damit die deutschen
-- Titel zurückgeschrieben und die IT-Titel als eigene Zeilen angelegt werden.
-- Ausführen im Supabase SQL-Editor.

ALTER TABLE sqp_asin_meta
  ADD COLUMN IF NOT EXISTS marketplace text NOT NULL DEFAULT 'DE';

-- alten Unique-Key (spid, asin) durch (spid, asin, marketplace) ersetzen
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.sqp_asin_meta'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.sqp_asin_meta DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE sqp_asin_meta
  ADD CONSTRAINT sqp_asin_meta_spid_asin_mkt_key UNIQUE (spid, asin, marketplace);
