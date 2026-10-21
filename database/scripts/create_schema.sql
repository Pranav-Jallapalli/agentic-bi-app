CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS retail_transactions (
  source_row BIGINT PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  invoice_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  customer_id TEXT,
  country TEXT NOT NULL,
  line_revenue NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  is_cancellation BOOLEAN GENERATED ALWAYS AS (invoice_no ILIKE 'C%') STORED
);

CREATE INDEX IF NOT EXISTS retail_transactions_invoice_date_idx
  ON retail_transactions (invoice_date);
CREATE INDEX IF NOT EXISTS retail_transactions_stock_code_idx
  ON retail_transactions (stock_code);
CREATE INDEX IF NOT EXISTS retail_transactions_country_idx
  ON retail_transactions (country);
CREATE INDEX IF NOT EXISTS retail_transactions_customer_id_idx
  ON retail_transactions (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dataset_imports (
  dataset_key TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  source_url TEXT NOT NULL,
  license TEXT NOT NULL,
  attribution TEXT NOT NULL,
  imported_rows BIGINT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
