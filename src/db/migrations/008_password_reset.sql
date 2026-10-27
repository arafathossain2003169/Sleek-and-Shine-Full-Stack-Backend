-- 008_password_reset.sql: allow the 'reset' purpose for one-time codes (forgot password).
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes
  ADD CONSTRAINT otp_codes_purpose_check CHECK (purpose IN ('register', 'login', 'reset'));
