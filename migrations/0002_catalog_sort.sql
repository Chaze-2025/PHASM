-- Match the public catalog's case-insensitive ordering so pagination reads
-- directly from the index instead of sorting every published record.
DROP INDEX locations_editorial;
CREATE INDEX locations_editorial ON locations(status, featured DESC, name COLLATE NOCASE, id);
