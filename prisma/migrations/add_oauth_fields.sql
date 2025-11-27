-- Add OAuth fields to user_account table
-- Make password_hash nullable for OAuth users
ALTER TABLE user_account 
ALTER COLUMN password_hash DROP NOT NULL;

-- Add provider and provider_id columns
ALTER TABLE user_account 
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS provider_id TEXT;

-- Create unique constraint on provider and provider_id combination
CREATE UNIQUE INDEX IF NOT EXISTS user_account_provider_provider_id_key 
ON user_account(provider, provider_id) 
WHERE provider IS NOT NULL AND provider_id IS NOT NULL;





