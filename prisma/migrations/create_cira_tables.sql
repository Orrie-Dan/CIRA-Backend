-- CIRA Database Schema Creation
-- This script creates all required tables for the CIRA application

-- Create user_account table
CREATE TABLE IF NOT EXISTS user_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen', 'officer', 'admin')),
  provider TEXT,
  provider_id TEXT,
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS user_account_email_idx ON user_account(email);
CREATE INDEX IF NOT EXISTS user_account_role_idx ON user_account(role);

-- Create report table
CREATE TABLE IF NOT EXISTS report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('roads', 'bridges', 'water', 'power', 'sanitation', 'telecom', 'public_building', 'pothole', 'streetlight', 'sidewalk', 'drainage', 'other')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'rejected')),
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address_text TEXT,
  province TEXT,
  district TEXT,
  sector TEXT,
  reporter_id UUID REFERENCES user_account(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES user_account(id) ON DELETE SET NULL,
  organization_id UUID,
  priority_score DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS report_status_idx ON report(status);
CREATE INDEX IF NOT EXISTS report_type_idx ON report(type);
CREATE INDEX IF NOT EXISTS report_reporter_id_idx ON report(reporter_id);
CREATE INDEX IF NOT EXISTS report_assigned_to_idx ON report(assigned_to);
CREATE INDEX IF NOT EXISTS report_location_idx ON report(latitude, longitude);

-- Create photo table
CREATE TABLE IF NOT EXISTS photo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS photo_report_id_idx ON photo(report_id);

-- Create qc_slip table
CREATE TABLE IF NOT EXISTS qc_slip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID UNIQUE NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES user_account(id) ON UPDATE NO ACTION,
  work_summary TEXT NOT NULL,
  photos TEXT[] DEFAULT '{}',
  approved BOOLEAN DEFAULT false NOT NULL,
  approved_by UUID REFERENCES user_account(id) ON UPDATE NO ACTION,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS qc_slip_report_id_idx ON qc_slip(report_id);
CREATE INDEX IF NOT EXISTS qc_slip_officer_id_idx ON qc_slip(officer_id);
CREATE INDEX IF NOT EXISTS qc_slip_approved_idx ON qc_slip(approved);

-- Create notification table (if needed)
CREATE TABLE IF NOT EXISTS notification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  read BOOLEAN DEFAULT false,
  related_report_id UUID REFERENCES report(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_user_id_idx ON notification(user_id);
CREATE INDEX IF NOT EXISTS notification_read_idx ON notification(read);


