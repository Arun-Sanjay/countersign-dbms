-- 0006 · Ingestion worker: record a failure that happens OUTSIDE project_push.
--
-- project_push (0005) already counts its own attempts: on an error inside the projection it
-- marks the delivery 'failed', leaves the queue message to reappear after the visibility
-- timeout, and archives it as a dead letter after 5 attempts. A worker can also fail BEFORE
-- the projection, e.g. MongoDB is unreachable while writing the raw log (step 2 of the
-- inbox -> log -> projection contract). ingest_fail records that attempt the same way, so
-- ingest_event.attempts / status / error tell the whole story and a message that can never
-- be logged does not circle the queue forever.
--
-- Delivery semantics (api/app/worker.py): at-least-once. A message is only archived after a
-- successful projection (or as a dead letter), so a crash at any point means the message is
-- read again after its visibility timeout. Every step is idempotent (Mongo _id = delivery id,
-- ON CONFLICT keys in project_push), so processing a message twice changes nothing.
--
-- Append-only like 0002-0005: one new function, nothing existing is altered.

CREATE FUNCTION public.ingest_fail(p_delivery_id TEXT, p_error TEXT, p_max_attempts INT DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    ev     public.ingest_event%ROWTYPE;
    v_dead BOOLEAN := false;
BEGIN
    SELECT * INTO ev FROM public.ingest_event WHERE delivery_id = p_delivery_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown delivery %', p_delivery_id
            USING ERRCODE = 'no_data_found', DETAIL = 'delivery_not_found';
    END IF;
    -- a finished delivery stays finished (a late failure report from a slow worker)
    IF ev.status IN ('projected', 'ignored') THEN
        RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', ev.status,
                                  'attempts', ev.attempts, 'dead_letter', false, 'changed', false);
    END IF;

    UPDATE public.ingest_event
    SET status   = 'failed',
        attempts = attempts + 1,
        error    = left('worker: ' || coalesce(nullif(btrim(p_error), ''), 'unknown error'), 2000)
    WHERE delivery_id = p_delivery_id
    RETURNING * INTO ev;

    IF ev.attempts >= greatest(coalesce(p_max_attempts, 5), 1) THEN
        PERFORM private.ingest_archive(ev.msg_id);      -- dead letter, kept in pgmq.a_github_ingest
        v_dead := ev.msg_id IS NOT NULL;
    END IF;
    RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', ev.status,
                              'attempts', ev.attempts, 'dead_letter', v_dead, 'changed', true);
END $$;

REVOKE ALL ON FUNCTION public.ingest_fail(TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_fail(TEXT, TEXT, INT) TO service_role;
