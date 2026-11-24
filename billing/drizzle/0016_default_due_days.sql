-- Default payment terms, in days after the issue date.
--
-- A new invoice previously had no due date unless someone remembered to pick
-- one, and isChaseable() refuses any invoice without a due date — so the
-- reminders engine could never act on an invoice created the normal way. 30
-- days is the common default for Kenyan SMEs and can be changed per workspace
-- (0 means due on receipt).
ALTER TABLE `org_profile` ADD `default_due_days` integer DEFAULT 30 NOT NULL;
