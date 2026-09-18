CREATE OR REPLACE FUNCTION public.claim_whatsapp_campaign_recipients(p_limit integer DEFAULT 5)
RETURNS SETOF public.whatsapp_campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_campaigns
     SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
   WHERE status = 'scheduled' AND scheduled_for <= now();

  RETURN QUERY
  WITH ready AS (
    SELECT r.id
      FROM public.whatsapp_campaign_recipients r
      JOIN public.whatsapp_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'queued'
       AND r.dispatch_after <= now()
       AND c.status = 'running'
       AND (
         SELECT count(*)
           FROM public.whatsapp_campaign_recipients sent
          WHERE sent.campaign_id = c.id
            AND sent.sent_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
       ) < c.daily_limit
     ORDER BY r.dispatch_after, r.id
     FOR UPDATE OF r SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 20)
  ), claimed AS (
    UPDATE public.whatsapp_campaign_recipients r
       SET status = 'generating', attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
      FROM ready
     WHERE r.id = ready.id
     RETURNING r.*
  )
  SELECT * FROM claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_whatsapp_campaign_recipients(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_campaign_recipients(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_whatsapp_campaign_totals(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_campaigns c
     SET sent_count = s.sent_count,
         replied_count = s.replied_count,
         skipped_count = s.skipped_count,
         failed_count = s.failed_count,
         status = CASE
           WHEN c.status = 'running' AND s.pending_count = 0 THEN 'completed'
           ELSE c.status
         END,
         finished_at = CASE
           WHEN c.status = 'running' AND s.pending_count = 0 THEN COALESCE(c.finished_at, now())
           ELSE c.finished_at
         END,
         updated_at = now()
    FROM (
      SELECT campaign_id,
             count(*) FILTER (WHERE status IN ('sent','replied'))::integer AS sent_count,
             count(*) FILTER (WHERE status = 'replied')::integer AS replied_count,
             count(*) FILTER (WHERE status = 'skipped')::integer AS skipped_count,
             count(*) FILTER (WHERE status = 'failed')::integer AS failed_count,
             count(*) FILTER (WHERE status IN ('queued','generating','sending'))::integer AS pending_count
        FROM public.whatsapp_campaign_recipients
       WHERE campaign_id = p_campaign_id
       GROUP BY campaign_id
    ) s
   WHERE c.id = s.campaign_id;
$$;
REVOKE ALL ON FUNCTION public.refresh_whatsapp_campaign_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_whatsapp_campaign_totals(uuid) TO service_role;