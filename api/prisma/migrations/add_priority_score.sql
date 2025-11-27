-- Add priority_score column to report table
ALTER TABLE report 
ADD COLUMN IF NOT EXISTS priority_score DECIMAL(10, 2);

-- Create index on priority_score for faster sorting
CREATE INDEX IF NOT EXISTS report_priority_score_idx ON report(priority_score DESC);

-- Update existing reports with initial priority scores
-- This will be calculated by the application on next confirmation or via batch job





