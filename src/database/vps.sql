CREATE TABLE IF NOT EXISTS vps_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vps_number BIGSERIAL UNIQUE NOT NULL,

    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    ticket_id UUID UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
    plan_id UUID REFERENCES pricing_plans(id) ON DELETE SET NULL,

    plan_name VARCHAR(100) NOT NULL,
    location VARCHAR(50) NOT NULL,

    price_inr NUMERIC(10,2) NOT NULL,
    price_usd NUMERIC(10,2) NOT NULL,

    ram_gb INTEGER NOT NULL,
    vcpu INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,

    provider_instance_id VARCHAR(255) NOT NULL,
    hostname VARCHAR(255) NOT NULL,

    public_ipv4 INET,
    private_ipv4 INET,
    ipv6 INET,

    ssh_username VARCHAR(100) NOT NULL DEFAULT 'root',
    ssh_port INTEGER NOT NULL DEFAULT 22,

    billing_cycle_months INTEGER NOT NULL DEFAULT 1,
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
    renewal_count INTEGER NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'active',

    provisioned_by_discord_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vps_instances_customer_id
    ON vps_instances(customer_id);

CREATE INDEX IF NOT EXISTS idx_vps_instances_status
    ON vps_instances(status);

CREATE INDEX IF NOT EXISTS idx_vps_instances_expires_at
    ON vps_instances(expires_at);

CREATE TABLE IF NOT EXISTS vps_renewals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE RESTRICT,
    billing_cycle_months INTEGER NOT NULL,
    amount_inr NUMERIC(10,2) NOT NULL,
    amount_usd NUMERIC(10,2) NOT NULL,
    previous_expiry TIMESTAMPTZ NOT NULL,
    new_expiry TIMESTAMPTZ NOT NULL,
    renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    renewed_by_discord_id VARCHAR(32) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vps_renewals_vps_id
    ON vps_renewals(vps_id);

CREATE TABLE IF NOT EXISTS vps_expiry_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    expiry_date DATE NOT NULL,
    notice_type VARCHAR(30) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(vps_id, expiry_date, notice_type)
);
