-- =====================================================================
-- 02_organization_model_procurement.sql
-- ORGANIZATION, DEVICE_MODEL, PROCUREMENT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ORGANIZATION: operators (hosts), owners, manufacturers and buyers.
-- ---------------------------------------------------------------------
CREATE TABLE organization (
    org_id       uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text  NOT NULL,
    short_name   text,
    org_type     text  CHECK (org_type IN (
                     'gmina', 'school', 'ngo', 'company', 'osp', 'psp',
                     'hospital', 'religious')),
    nip          varchar(10)  UNIQUE CHECK (nip   IS NULL OR nip   ~ '^[0-9]{10}$'),
    regon        varchar(14)  UNIQUE CHECK (regon IS NULL OR regon ~ '^([0-9]{9}|[0-9]{14})$'),
    wikidata_id  text         UNIQUE CHECK (wikidata_id IS NULL OR wikidata_id ~ '^Q[0-9]+$'),
    phone        text,
    email        text,
    website      text
);

COMMENT ON TABLE  organization IS 'Any organisation: AED host/operator, owner, manufacturer or procurement buyer.';
COMMENT ON COLUMN organization.org_type IS 'gmina|school|ngo|company|osp|psp|hospital|religious; NULL when unknown.';

CREATE INDEX organization_name_trgm ON organization USING gin (name gin_trgm_ops);


-- ---------------------------------------------------------------------
-- DEVICE_MODEL: AED model catalogue (e.g. Philips HeartStart FRx).
-- ---------------------------------------------------------------------
CREATE TABLE device_model (
    model_id             uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_org_id  uuid     REFERENCES organization (org_id) ON DELETE RESTRICT,
    name                 text     NOT NULL,
    fully_automatic      boolean,
    battery_life_months  integer  CHECK (battery_life_months IS NULL OR battery_life_months > 0),
    pads_life_months     integer  CHECK (pads_life_months    IS NULL OR pads_life_months    > 0),

    CONSTRAINT device_model_name_uq UNIQUE NULLS NOT DISTINCT (manufacturer_org_id, name)
);

COMMENT ON COLUMN device_model.fully_automatic IS 'true = shocks automatically; false = semi-automatic (shock button).';

CREATE INDEX device_model_manufacturer_idx ON device_model (manufacturer_org_id);


-- ---------------------------------------------------------------------
-- PROCUREMENT: purchase notices (TED, BZP, e-Zamówienia), CPV 33182100.
-- ---------------------------------------------------------------------
CREATE TABLE procurement (
    procurement_id  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_org_id    uuid    REFERENCES organization (org_id) ON DELETE RESTRICT,
    platform        text    NOT NULL CHECK (platform IN ('TED', 'BZP', 'eZamowienia')),
    notice_number   text    NOT NULL,
    notice_type     text    CHECK (notice_type IN ('cn', 'can')),
    published_at    date,
    cpv_codes       text[]  NOT NULL DEFAULT '{}',
    units_aed       integer CHECK (units_aed IS NULL OR units_aed >= 0),
    value_pln       numeric(14, 2) CHECK (value_pln IS NULL OR value_pln >= 0),
    url             text,

    CONSTRAINT procurement_notice_uq UNIQUE (platform, notice_number)
);

COMMENT ON TABLE  procurement IS 'Public-procurement notices that prove AED purchases. No locations.';
COMMENT ON COLUMN procurement.notice_number IS 'e.g. TED publication-number 808445-2026.';
COMMENT ON COLUMN procurement.notice_type IS 'cn = contract notice (cn-standard), can = contract award (can-standard).';
COMMENT ON COLUMN procurement.cpv_codes IS 'All CPV codes of the notice; AED is 33182100.';
COMMENT ON COLUMN procurement.units_aed IS 'Number of AEDs bought, when stated (often not).';

CREATE INDEX procurement_buyer_idx     ON procurement (buyer_org_id);
CREATE INDEX procurement_published_idx ON procurement (published_at);
CREATE INDEX procurement_cpv_gin       ON procurement USING gin (cpv_codes);
