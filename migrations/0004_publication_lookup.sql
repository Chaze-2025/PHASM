-- Bound the reads used by repeatable catalog publication as the catalog grows.
-- These additive indexes preserve every record, row ID and relationship.
CREATE INDEX IF NOT EXISTS editorial_audit_location_action
  ON editorial_audit(location_id, action);
CREATE INDEX IF NOT EXISTS locations_identity_fields
  ON locations(name COLLATE NOCASE, city COLLATE NOCASE,
               state COLLATE NOCASE, country COLLATE NOCASE);
