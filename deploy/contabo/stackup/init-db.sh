#!/bin/sh
# Runs ONCE, on the database volume's first initialisation.
#
# Creates StackUp's two-role model (see db/bootstrap.sql in the app repo):
#
#   stackup_migrator — owns the schema, used ONLY by the migration runner.
#                      BYPASSRLS so the trusted workspace-provisioning
#                      function can insert the first workspace row.
#   stackup_app      — the runtime role. NOBYPASSRLS, never owns tables, so
#                      FORCE ROW LEVEL SECURITY binds every query it runs.
#                      This is the whole tenant-isolation model — do not
#                      grant it BYPASSRLS, ever.
#
# Unlike db/bootstrap.sql (which makes stackup_dev + stackup_test) this
# creates a single production database: `stackup`.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
	CREATE ROLE stackup_migrator LOGIN PASSWORD '${STACKUP_MIGRATOR_PASSWORD}' BYPASSRLS;
	CREATE ROLE stackup_app      LOGIN PASSWORD '${STACKUP_APP_PASSWORD}' NOBYPASSRLS;
	CREATE DATABASE stackup OWNER stackup_migrator;
EOSQL

echo "stackup: roles and database created."
