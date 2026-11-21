-- =====================================================================
-- 01_admin_unit_address.sql
-- ADMIN_UNIT (TERYT hierarchy) and ADDRESS (PRG / EMUiA address points).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ADMIN_UNIT: voivodeship > powiat > gmina > locality.
-- teryt_code holds TERC codes for voivodeship/powiat/gmina and the
-- SIMC id for localities.
-- ---------------------------------------------------------------------
CREATE TABLE admin_unit (
    teryt_code    varchar(10)  PRIMARY KEY,
    level         text         NOT NULL
                  CHECK (level IN ('voivodeship', 'powiat', 'gmina', 'locality')),
    name          text         NOT NULL,
    parent_teryt  varchar(10)  REFERENCES admin_unit (teryt_code)
                               ON UPDATE CASCADE ON DELETE RESTRICT,
    population    integer      CHECK (population IS NULL OR population >= 0),
    boundary      geometry(MultiPolygon, 4326),

    CONSTRAINT admin_unit_code_digits CHECK (teryt_code ~ '^[0-9]+$'),
    CONSTRAINT admin_unit_not_own_parent CHECK (parent_teryt IS DISTINCT FROM teryt_code),
    -- Only voivodeships are roots of the hierarchy.
    CONSTRAINT admin_unit_parent_required
        CHECK ((level = 'voivodeship') = (parent_teryt IS NULL))
);

COMMENT ON TABLE  admin_unit IS 'TERYT administrative hierarchy (TERC + SIMC). Self-referencing via parent_teryt.';
COMMENT ON COLUMN admin_unit.teryt_code IS 'TERC code (voivodeship/powiat/gmina) or SIMC id (locality).';
COMMENT ON COLUMN admin_unit.population IS 'GUS population, for coverage statistics (AEDs per capita).';

CREATE INDEX admin_unit_parent_idx   ON admin_unit (parent_teryt);
CREATE INDEX admin_unit_level_idx    ON admin_unit (level);
CREATE INDEX admin_unit_boundary_gix ON admin_unit USING gist (boundary);


-- ---------------------------------------------------------------------
-- ADDRESS: normalised address, ideally linked to the national PRG register.
-- ---------------------------------------------------------------------
CREATE TABLE address (
    address_id      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    prg_address_id  text         UNIQUE,
    teryt_simc      varchar(10)  REFERENCES admin_unit (teryt_code)
                                 ON UPDATE CASCADE ON DELETE SET NULL,
    street          text,
    house_number    text,
    postcode        varchar(6)   CHECK (postcode IS NULL OR postcode ~ '^[0-9]{2}-[0-9]{3}$'),
    city            text,
    point           geography(Point, 4326)
);

COMMENT ON TABLE  address IS 'Normalised postal address; geocoded against PRG/GUGiK where possible.';
COMMENT ON COLUMN address.prg_address_id IS 'Identifier of the address point in PRG / EMUiA.';
COMMENT ON COLUMN address.teryt_simc IS 'Locality (SIMC) in admin_unit.';

CREATE INDEX address_teryt_simc_idx ON address (teryt_simc);
CREATE INDEX address_point_gix      ON address USING gist (point);
CREATE INDEX address_street_trgm    ON address USING gin (street gin_trgm_ops);
