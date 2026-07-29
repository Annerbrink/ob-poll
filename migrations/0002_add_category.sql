-- Whether the fixture is a men's ('herr') or women's ('dam') match, so the
-- widget can label it. NULL for polls created before the column existed.
ALTER TABLE polls ADD COLUMN category TEXT;
