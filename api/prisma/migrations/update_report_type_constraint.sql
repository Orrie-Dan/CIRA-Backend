-- Migration to update report_type_check constraint to include all new report types
-- This allows: roads, bridges, water, power, sanitation, telecom, public_building, pothole, streetlight, sidewalk, drainage, other

-- Drop the existing constraint
ALTER TABLE report DROP CONSTRAINT IF EXISTS report_type_check;

-- Add the new constraint with all allowed types
ALTER TABLE report ADD CONSTRAINT report_type_check 
  CHECK (type IN (
    'roads', 
    'bridges', 
    'water', 
    'power', 
    'sanitation', 
    'telecom', 
    'public_building', 
    'pothole', 
    'streetlight', 
    'sidewalk', 
    'drainage', 
    'other'
  ));















