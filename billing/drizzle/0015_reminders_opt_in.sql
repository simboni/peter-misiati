-- Reminders ship OFF for workspaces that already exist.
--
-- orgProfile.remindersEnabled defaults to true so a NEW workspace has chasing
-- working from day one, with no back catalogue to sweep. An EXISTING workspace
-- is the opposite case: switching it on silently would chase every unpaid
-- invoice on file, including ones settled in cash months ago and never marked
-- paid. Those clients would be asked for money they have already handed over.
--
-- So every workspace that exists at this migration starts disabled and opts in
-- from Settings, where the copy says what will happen. The UPDATE is a no-op on
-- a fresh database, which has no rows yet.

ALTER TABLE `org_profile` ADD `reminder_max_age` integer DEFAULT 90 NOT NULL;--> statement-breakpoint
UPDATE `org_profile` SET `reminders_enabled` = 0;
