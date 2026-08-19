CREATE TABLE IF NOT EXISTS pricing_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(50) NOT NULL UNIQUE,

    ram_gb INTEGER NOT NULL,
    vcpu INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,

    price_inr NUMERIC(10,2) NOT NULL,
    price_usd NUMERIC(10,2) NOT NULL,

    currency_note VARCHAR(255),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pricing_ipv4 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    duration_months INTEGER NOT NULL UNIQUE,

    price_inr NUMERIC(10,2) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);