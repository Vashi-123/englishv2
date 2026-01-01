-- Add receipt storage columns to partner_payouts table for storing receipt files in Supabase Storage

ALTER TABLE partner_payouts
  ADD COLUMN IF NOT EXISTS receipt_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS receipt_storage_path TEXT;

