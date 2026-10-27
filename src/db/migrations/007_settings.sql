-- 007_settings.sql: store-wide rates/limits that admins can change at runtime.
-- A row overrides the environment default; deleting the row restores the default.
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
