CREATE OR REPLACE FUNCTION public.delete_voice_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.voice_campaigns%ROWTYPE;
  v_has_history boolean;
BEGIN
  SELECT * INTO v_campaign
  FROM public.voice_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_role(auth.uid(), v_campaign.account_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_campaign.status IN ('running', 'scheduled') THEN
    RAISE EXCEPTION 'campaign_is_active' USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.voice_campaign_contacts
    WHERE campaign_id = p_campaign_id
      AND voice_call_id IS NOT NULL
  ) INTO v_has_history;

  IF v_has_history OR COALESCE(v_campaign.placed_count, 0) > 0 THEN
    RAISE EXCEPTION 'campaign_has_call_history' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.voice_campaigns WHERE id = p_campaign_id;

  RETURN jsonb_build_object('deleted', true, 'campaign_id', p_campaign_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_voice_campaign(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_voice_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_voice_campaign(uuid) TO service_role;