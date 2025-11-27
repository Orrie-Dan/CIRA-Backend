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





