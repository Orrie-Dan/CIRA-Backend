-- Update User Role Constraint
-- This migration adds 'officer' to the allowed role values in the user_account table

ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_role_check;

ALTER TABLE user_account ADD CONSTRAINT user_account_role_check 
  CHECK (role IN ('citizen', 'officer', 'admin'));















