-- Create the app_settings table to store application-wide settings
-- This table uses a key-value pattern for flexibility

CREATE TABLE IF NOT EXISTS app_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update updated_at on row updates
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_app_settings_updated_at();

-- Enable Row Level Security
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Only admins can view settings (we'll check admin status in application code)
CREATE POLICY "Admins can view settings"
  ON app_settings FOR SELECT
  USING (true); -- We'll filter by admin in application code

-- Only admins can insert settings
CREATE POLICY "Admins can insert settings"
  ON app_settings FOR INSERT
  WITH CHECK (true); -- We'll filter by admin in application code

-- Only admins can update settings
CREATE POLICY "Admins can update settings"
  ON app_settings FOR UPDATE
  USING (true) -- We'll filter by admin in application code
  WITH CHECK (true);

-- Insert default setting for campaign logging (enabled by default)
INSERT INTO app_settings (setting_key, setting_value, description)
VALUES ('campaign_logging_enabled', 'true', 'Enable or disable logging of campaign changes (excluding admin screen changes)')
ON CONFLICT (setting_key) DO NOTHING;

-- Add comments
COMMENT ON TABLE app_settings IS 'Application-wide settings stored as key-value pairs';
COMMENT ON COLUMN app_settings.setting_key IS 'Unique key for the setting';
COMMENT ON COLUMN app_settings.setting_value IS 'Value of the setting (stored as text, can be parsed as needed)';
COMMENT ON COLUMN app_settings.description IS 'Human-readable description of what this setting controls';
