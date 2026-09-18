-- lovable-cron-fallback-reviewed: 288 runs/day; campanhas agendadas e retentativas precisam ser processadas com atraso máximo de cinco minutos, e o executor é idempotente e limitado.
DO $$
DECLARE
  v_existing bigint;
BEGIN
  SELECT jobid INTO v_existing FROM cron.job WHERE jobname = 'whatsapp-campaign-dispatch';
  IF v_existing IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing);
  END IF;

  PERFORM cron.schedule(
    'whatsapp-campaign-dispatch',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://nexus-ai-voice-memories.lovable.app/api/public/whatsapp-campaign-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END
$$;