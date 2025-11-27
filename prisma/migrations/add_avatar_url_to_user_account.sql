-- Add avatar_url column to user_account table
ALTER TABLE user_account
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

