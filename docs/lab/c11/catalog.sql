-- Read-only catalog query for the C11 schema appendix (run by gen_schema_listing.py).
-- One JSON document: every base table of schemas public and private with its columns,
-- constraints, extra indexes, triggers and RLS policies; every view; every function.
SELECT json_build_object(
  'server', current_setting('server_version'),
  'migrations', (SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
  'tables', (
    SELECT json_agg(t ORDER BY t->>'schema' DESC, t->>'name') FROM (
      SELECT json_build_object(
        'schema', n.nspname, 'name', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
        'comment', obj_description(c.oid, 'pg_class'),
        'columns', (SELECT json_agg(json_build_object(
              'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull,
              'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity, 'generated', a.attgenerated)
              ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
        'constraints', (SELECT json_agg(json_build_object('name', k.conname, 'type', k.contype,
              'def', pg_get_constraintdef(k.oid, true)) ORDER BY
              CASE k.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 WHEN 'x' THEN 3 ELSE 4 END, k.conname)
            FROM pg_constraint k WHERE k.conrelid = c.oid),
        'indexes', (SELECT json_agg(pg_get_indexdef(i.indexrelid) ORDER BY ic.relname)
            FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE i.indrelid = c.oid AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)),
        'triggers', (SELECT json_agg(t.tgname || ': ' || regexp_replace(pg_get_triggerdef(t.oid, true),
              '^CREATE (CONSTRAINT )?TRIGGER \S+ ', '') ORDER BY t.tgname)
            FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
        'policies', (SELECT json_agg(json_build_object('name', p.policyname, 'cmd', p.cmd,
              'roles', p.roles::text, 'permissive', p.permissive) ORDER BY p.policyname)
            FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname)
      ) AS t
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p')) s),
  'views', (SELECT json_agg(json_build_object('schema', n.nspname, 'name', c.relname,
        'options', c.reloptions::text,
        'columns', (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0))
        ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('v', 'm')),
  'functions', (SELECT json_agg(json_build_object('schema', n.nspname, 'name', p.proname,
        'args', pg_get_function_arguments(p.oid), 'returns', pg_get_function_result(p.oid),
        'definer', p.prosecdef, 'volatility', p.provolatile, 'lang', l.lanname)
        ORDER BY n.nspname, p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname IN ('public', 'private', 'app') AND p.prokind = 'f')
);
