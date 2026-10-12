-- D1 applies each migration in a transaction with foreign keys enabled.
-- Rebuilding the parent table requires deferring the non-cascading references.
PRAGMA defer_foreign_keys = ON;

-- DROP TABLE executes ON DELETE CASCADE even with deferred checks. Preserve
-- both cascading child tables, including their source IDs, before rebuilding.
CREATE TABLE _withheld_location_phenomena AS SELECT * FROM location_phenomena;
CREATE TABLE _withheld_location_sources AS SELECT * FROM location_sources;

DROP TRIGGER locations_fts_insert;
DROP TRIGGER locations_fts_delete;
DROP TRIGGER locations_fts_update;
DROP TABLE locations_fts;

CREATE TABLE locations_withheld (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  identity_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  latitude REAL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL CHECK(longitude BETWEEN -180 AND 180),
  category TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('established','local-legend','community-discovery')),
  access TEXT NOT NULL CHECK(access IN ('public','restricted','private','unknown')),
  tours TEXT NOT NULL CHECK(tours IN ('yes','no','unknown')),
  status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
  coordinate_precision TEXT NOT NULL CHECK(coordinate_precision IN ('exact','approximate','withheld')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  CHECK(
    (coordinate_precision = 'withheld' AND latitude IS NULL AND longitude IS NULL)
    OR
    (coordinate_precision IN ('exact','approximate') AND latitude IS NOT NULL AND longitude IS NOT NULL)
  ),
  CHECK(access != 'private' OR coordinate_precision IN ('approximate','withheld'))
);

-- Keep rowids as well as public IDs so existing identities remain stable.
INSERT INTO locations_withheld (rowid, id, slug, identity_key, name, city, state, country, region, latitude, longitude, category, classification, access, tours, status, coordinate_precision, featured, updated_at, data_json)
SELECT rowid, id, slug, identity_key, name, city, state, country, region, latitude, longitude, category, classification, access, tours, status, coordinate_precision, featured, updated_at, data_json FROM locations;
DROP TABLE locations;
ALTER TABLE locations_withheld RENAME TO locations;

-- Preserve original citations for visitor sites that only publish over HTTP.
DROP TABLE location_sources;
CREATE TABLE location_sources (
  id INTEGER PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL CHECK(url LIKE 'https://%' OR url LIKE 'http://%'),
  kind TEXT NOT NULL CHECK(kind IN ('history','reports','visiting')),
  UNIQUE(location_id, url, kind)
);
INSERT INTO location_phenomena (location_id, phenomenon)
SELECT location_id, phenomenon FROM _withheld_location_phenomena;
INSERT INTO location_sources (id, location_id, title, url, kind)
SELECT id, location_id, title, url, kind FROM _withheld_location_sources;
DROP TABLE _withheld_location_phenomena;
DROP TABLE _withheld_location_sources;

CREATE INDEX locations_geo ON locations(status, longitude, latitude);
CREATE INDEX locations_geo_lat ON locations(status, latitude, longitude);
CREATE INDEX locations_region ON locations(status, region, name, id);
CREATE INDEX locations_category ON locations(status, category, name, id);
CREATE INDEX locations_editorial ON locations(status, featured DESC, name COLLATE NOCASE, id);
CREATE INDEX locations_access ON locations(status, access, tours);

CREATE VIRTUAL TABLE locations_fts USING fts5(name, city, state, country, content='locations', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
INSERT INTO locations_fts(locations_fts) VALUES('rebuild');
CREATE TRIGGER locations_fts_insert AFTER INSERT ON locations BEGIN
  INSERT INTO locations_fts(rowid,name,city,state,country) VALUES(new.rowid,new.name,new.city,new.state,new.country);
END;
CREATE TRIGGER locations_fts_delete AFTER DELETE ON locations BEGIN
  INSERT INTO locations_fts(locations_fts,rowid,name,city,state,country) VALUES('delete',old.rowid,old.name,old.city,old.state,old.country);
END;
CREATE TRIGGER locations_fts_update AFTER UPDATE ON locations BEGIN
  INSERT INTO locations_fts(locations_fts,rowid,name,city,state,country) VALUES('delete',old.rowid,old.name,old.city,old.state,old.country);
  INSERT INTO locations_fts(rowid,name,city,state,country) VALUES(new.rowid,new.name,new.city,new.state,new.country);
END;

PRAGMA defer_foreign_keys = OFF;
