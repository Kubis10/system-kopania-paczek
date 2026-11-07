CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CLIENT', 'COURIER', 'ADMIN')),
  is_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sensitive_data (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT,
  default_address TEXT
);

CREATE TABLE IF NOT EXISTS parcels (
  id UUID PRIMARY KEY,
  tracking_number TEXT NOT NULL UNIQUE,
  sender_id UUID NOT NULL REFERENCES users(id),
  courier_id UUID REFERENCES users(id),
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  weight NUMERIC(6, 2) NOT NULL CHECK (weight > 0 AND weight <= 25),
  dimensions JSONB,
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED')),
  pickup_code_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parcels_tracking_number_idx ON parcels(tracking_number);
CREATE INDEX IF NOT EXISTS parcels_sender_created_idx ON parcels(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS parcels_courier_status_idx ON parcels(courier_id, status);

CREATE TABLE IF NOT EXISTS parcel_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parcel_id UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED')),
  location TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parcel_status_history_parcel_time_idx ON parcel_status_history(parcel_id, timestamp);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  ip_address INET,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs(timestamp DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);