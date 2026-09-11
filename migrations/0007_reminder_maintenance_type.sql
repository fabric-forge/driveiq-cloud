-- Links a reminder/appointment to one of MAINTENANCE_SCHEDULE's canonical
-- types (see src/worker/core/maintenanceSchedule.ts — 'coolant',
-- 'drive_belt', 'spark_plugs', etc.), the same vocabulary maintenance_records
-- already uses. NULL for a reminder that doesn't correspond to a standard
-- schedule item (e.g. a one-off repair).
--
-- Lets driveiq-ui tell "this appointment already covers what the forecast
-- table is projecting" and hide the now-redundant Forecast card, instead of
-- showing both a scheduled appointment and a duplicate "Overdue" forecast
-- entry for the same service. Set by Aiana's create_reminder/update_reminder
-- tools (src/worker/routes/search.ts) when it recognizes the service as a
-- standard type; editable by hand via PATCH like any other field.

ALTER TABLE reminders ADD COLUMN maintenance_type TEXT;
