-- Coordinates, photos and prose are not FTS columns. Avoid rewriting the
-- name/locality search index when an update leaves all indexed values intact.
DROP TRIGGER locations_fts_update;
CREATE TRIGGER locations_fts_update AFTER UPDATE ON locations
WHEN old.rowid IS NOT new.rowid
  OR old.name IS NOT new.name
  OR old.city IS NOT new.city
  OR old.state IS NOT new.state
  OR old.country IS NOT new.country
BEGIN
  INSERT INTO locations_fts(locations_fts,rowid,name,city,state,country)
    VALUES('delete',old.rowid,old.name,old.city,old.state,old.country);
  INSERT INTO locations_fts(rowid,name,city,state,country)
    VALUES(new.rowid,new.name,new.city,new.state,new.country);
END;
