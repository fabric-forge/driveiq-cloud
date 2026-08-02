-- Distinguishes reminders the owner created themselves (category IS NULL)
-- from appointments Aiana creates via the create_reminder tool (see
-- src/worker/routes/search.ts) when the owner mentions a scheduled service
-- visit in conversation. driveiq-ui uses this to skip the "Ask Aiana" deep
-- link / spec lookup on appointment cards — there's no manual page to look
-- up for "Oil change at Kari Toyota, 9/15", only for a part or fluid.

ALTER TABLE reminders ADD COLUMN category TEXT;
