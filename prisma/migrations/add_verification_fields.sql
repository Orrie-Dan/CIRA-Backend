-- Add email and phone verification fields to user_account table
ALTER TABLE user_account 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false NOT NULL;





