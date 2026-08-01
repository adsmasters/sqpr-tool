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

-- TEIL 2 (zwingend!): Der PRIMARY KEY war ebenfalls (spid, asin) und blockiert
-- sonst weiterhin je Marktplatz eigene Zeilen (Worker faellt dann still aufs
-- alte Verhalten zurueck und ueberschreibt wieder).
ALTER TABLE sqp_asin_meta DROP CONSTRAINT sqp_asin_meta_pkey;
ALTER TABLE sqp_asin_meta ADD PRIMARY KEY (spid, asin, marketplace);
-- Unique-Key aus Teil 1 ist damit redundant
ALTER TABLE sqp_asin_meta DROP CONSTRAINT sqp_asin_meta_spid_asin_mkt_key;

-- Danach: GitHub-Action "ASIN Meta Refresh" (sqp-ingest) starten.
-- Der Worker schreibt die Titel je Marktplatz neu und raeumt Zeilen auf,
-- die nicht mehr im aktuellen Produktbericht stehen (z.B. die IT-Titel,
-- die faelschlich unter DE gespeichert wurden).
