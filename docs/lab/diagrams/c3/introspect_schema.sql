-- Read-only catalog introspection of the applied schema (migrations 0001-0004).
-- Produces one JSON document: tables -> columns (with PK/FK/NOT NULL/UNIQUE flags) and FKs.
WITH t AS (
  SELECT c.oid, n.nspname AS schema, c.relname AS name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND (n.nspname = 'public' OR (n.nspname = 'private' AND c.relname = 'note'))
), cols AS (
  SELECT t.schema, t.name, a.attnum, a.attname,
         format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
         a.attgenerated <> '' AS generated,
         EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = t.oid AND k.contype = 'p' AND a.attnum = ANY(k.conkey)) AS pk,
         EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = t.oid AND k.contype = 'f' AND a.attnum = ANY(k.conkey)) AS fk,
         EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = t.oid AND k.contype = 'u' AND k.conkey = ARRAY[a.attnum]) AS uq
  FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
), fks AS (
  SELECT t.schema, t.name, k.conname,
         (SELECT array_agg(a.attname ORDER BY u.ord) FROM unnest(k.conkey) WITH ORDINALITY u(n, ord)
            JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n) AS cols,
         rn.nspname AS ref_schema, r.relname AS ref_table,
         (SELECT array_agg(a.attname ORDER BY u.ord) FROM unnest(k.confkey) WITH ORDINALITY u(n, ord)
            JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n) AS ref_cols,
         CASE k.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
                            WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
  FROM t JOIN pg_constraint k ON k.conrelid = t.oid AND k.contype = 'f'
  JOIN pg_class r ON r.oid = k.confrelid JOIN pg_namespace rn ON rn.oid = r.relnamespace
)
SELECT json_build_object(
  'tables', (SELECT json_agg(json_build_object('schema', schema, 'name', name,
                'columns', (SELECT json_agg(json_build_object('name', attname, 'type', type, 'not_null', attnotnull,
                              'pk', pk, 'fk', fk, 'unique', uq, 'generated', generated) ORDER BY attnum)
                            FROM cols WHERE cols.schema = t.schema AND cols.name = t.name)) ORDER BY schema, name) FROM t),
  'fks', (SELECT json_agg(row_to_json(fks) ORDER BY schema, name, conname) FROM fks));
