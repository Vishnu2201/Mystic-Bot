-- Allows administrator-created VPS instances that do not originate from a ticket.
-- Safe to run repeatedly against an existing Mystic Bot database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vps_instances'
  ) THEN
    ALTER TABLE vps_instances
      ALTER COLUMN ticket_id DROP NOT NULL;
  END IF;
END $$;
