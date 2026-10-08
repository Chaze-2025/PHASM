PRAGMA foreign_keys = ON;

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  identity_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  category TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('established','local-legend','community-discovery')),
  access TEXT NOT NULL CHECK(access IN ('public','restricted','private','unknown')),
  tours TEXT NOT NULL CHECK(tours IN ('yes','no','unknown')),
  status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
  coordinate_precision TEXT NOT NULL CHECK(coordinate_precision IN ('exact','approximate')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  CHECK(access != 'private' OR coordinate_precision = 'approximate')
);
CREATE INDEX locations_geo ON locations(status, longitude, latitude);
CREATE INDEX locations_geo_lat ON locations(status, latitude, longitude);
CREATE INDEX locations_region ON locations(status, region, name, id);
CREATE INDEX locations_category ON locations(status, category, name, id);
CREATE INDEX locations_editorial ON locations(status, featured DESC, name, id);
CREATE INDEX locations_access ON locations(status, access, tours);

CREATE TABLE location_phenomena (
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  phenomenon TEXT NOT NULL,
  PRIMARY KEY(location_id, phenomenon)
);
CREATE INDEX phenomena_lookup ON location_phenomena(phenomenon, location_id);
CREATE TABLE location_sources (
  id INTEGER PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL CHECK(url LIKE 'https://%'),
  kind TEXT NOT NULL CHECK(kind IN ('history','reports','visiting')),
  UNIQUE(location_id, url, kind)
);
CREATE TABLE editorial_audit (
  id INTEGER PRIMARY KEY,
  location_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Phase 3 data foundation only. No public writing endpoint is enabled.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  auth_subject TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','editor','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  experience TEXT NOT NULL CHECK(experience IN ('reported','none','unspecified')),
  approximate_visit_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected','removed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX reviews_location_status ON reviews(location_id,status,created_at DESC);
CREATE TABLE review_phenomena (review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE, phenomenon TEXT NOT NULL, PRIMARY KEY(review_id,phenomenon));
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  uploader_id TEXT REFERENCES users(id),
  location_id TEXT REFERENCES locations(id),
  review_id TEXT REFERENCES reviews(id),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  license TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected','removed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE review_replies (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE review_reactions (review_id TEXT REFERENCES reviews(id), user_id TEXT REFERENCES users(id), PRIMARY KEY(review_id,user_id));
CREATE TABLE content_reports (id TEXT PRIMARY KEY, reporter_id TEXT REFERENCES users(id), entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE moderation_actions (id TEXT PRIMARY KEY, moderator_id TEXT NOT NULL REFERENCES users(id), entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE appeals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), moderation_action_id TEXT NOT NULL REFERENCES moderation_actions(id), body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE location_suggestions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), private_payload_json TEXT NOT NULL CHECK(json_valid(private_payload_json)), status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE collection_locations (collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE, location_id TEXT REFERENCES locations(id), PRIMARY KEY(collection_id,location_id));

CREATE TABLE editorial_content (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('case-file','encyclopedia','trail')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  sources_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sources_json)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE editorial_content_locations (content_id TEXT REFERENCES editorial_content(id) ON DELETE CASCADE, location_id TEXT REFERENCES locations(id), position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(content_id,location_id));

CREATE VIRTUAL TABLE locations_fts USING fts5(name, city, state, country, content='locations', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
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
