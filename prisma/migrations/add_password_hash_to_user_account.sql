-- Add password_hash column to user_account table if it doesn't exist
ALTER TABLE user_account 
ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

-- Update existing rows to have a placeholder (users should reset their password)
-- In production, you might want to handle this differently
UPDATE user_account 
SET password_hash = '$2b$10$PLACEHOLDER.PASSWORD.HASH.REQUIRES.RESET' 
WHERE password_hash = '' OR password_hash IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE user_account 
ALTER COLUMN password_hash SET NOT NULL;















