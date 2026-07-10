begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- PostgreSQL requires UPDATE on at least one column before SELECT ... FOR UPDATE.
-- The mutex helper never updates rows, so expose only the inert timestamp column
-- instead of restoring table-wide UPDATE to the no-login mutator role.
grant update (created_at)
  on table gioia_private.schedule_day_locks
  to gioia_mutator;

commit;
