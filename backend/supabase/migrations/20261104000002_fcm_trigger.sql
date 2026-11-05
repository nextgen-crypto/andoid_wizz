-- FCM push trigger: fires send-push edge function on every notification INSERT.
-- Requires:
--   1. pg_net extension enabled (Supabase Dashboard → Database → Extensions → pg_net)
--   2. `supabase functions deploy send-push`
--   3. Replace YOUR_PROJECT_REF below with your Supabase project reference ID
--      (the subdomain in your Supabase URL, e.g. "abcdefghijklmnop")
--   4. `supabase secrets set FIREBASE_SA_JSON='...'`

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_push_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _url  text := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push';
  _key  text := current_setting('app.service_role_key', true);
BEGIN
  -- Skip self-notifications
  IF NEW.user_id = NEW.actor_id THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := _url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || _key
    ),
    body    := jsonb_build_object(
      'user_id', NEW.user_id,
      'kind',    NEW.kind,
      'text',    NEW.text
    )
  );

  RETURN NEW;
END;
$$;

-- Set the service role key once so the trigger can read it:
-- ALTER DATABASE postgres SET app.service_role_key = 'your-service-role-key-here';
-- (Run the ALTER DATABASE command manually in Supabase SQL Editor after replacing the value)

DROP TRIGGER IF EXISTS after_notification_insert_push ON public.notifications;
CREATE TRIGGER after_notification_insert_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_notification();
