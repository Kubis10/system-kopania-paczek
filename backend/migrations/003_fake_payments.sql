ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PAID')),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

UPDATE parcels
SET payment_status = 'PAID', paid_at = created_at
WHERE status <> 'CREATED' AND payment_status = 'UNPAID';

UPDATE parcels
SET payload = payload || jsonb_build_object('paymentStatus', payment_status, 'paidAt', paid_at);