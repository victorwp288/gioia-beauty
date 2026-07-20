const SHA256 = /^[0-9a-f]{64}$/u;

export const LOCAL_POSTGRES_RECOVERY_EVIDENCE_SQL = `
  with table_evidence as (
    select 'migration_runs'::text as table_name, count(*)::integer as row_count,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex') as sha256
    from gioia_private.migration_runs value
    union all
    select 'migration_records', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by run_id, source_collection, source_record_id),
        '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.migration_records value
    union all
    select 'migration_quarantine', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.migration_quarantine value
    union all
    select 'schedule_entries', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.schedule_entries value
    union all
    select 'vacations', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.vacations value
    union all
    select 'newsletter_subscribers', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.newsletter_subscribers value
    union all
    select 'domain_change_log', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by sequence_id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.domain_change_log value
    union all
    select 'command_requests', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.command_requests value
    union all
    select 'email_outbox', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.email_outbox value
    union all
    select 'cutover_write_control', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by singleton), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.cutover_write_control value
    union all
    select 'cutover_transition_log', count(*)::integer,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by sequence_id), '[]'::jsonb)::text, 'sha256'), 'hex')
    from gioia_private.cutover_transition_log value
  ), migration_evidence as (
    select count(*)::integer as count,
      pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
        to_jsonb(value) order by version), '[]'::jsonb)::text, 'sha256'), 'hex')
        as sha256
    from supabase_migrations.schema_migrations value
  ), sequence_evidence as (
    select 'migration_quarantine_id_seq'::text as sequence_name,
      last_value::bigint as last_value, is_called
    from gioia_private.migration_quarantine_id_seq
    union all
    select 'domain_change_log_sequence_id_seq', last_value::bigint, is_called
    from gioia_private.domain_change_log_sequence_id_seq
    union all
    select 'newsletter_consent_events_sequence_id_seq',
      last_value::bigint, is_called
    from gioia_private.newsletter_consent_events_sequence_id_seq
    union all
    select 'email_dead_letter_events_sequence_id_seq',
      last_value::bigint, is_called
    from gioia_private.email_dead_letter_events_sequence_id_seq
    union all
    select 'cutover_transition_log_sequence_id_seq',
      last_value::bigint, is_called
    from gioia_private.cutover_transition_log_sequence_id_seq
    union all
    select 'cutover_canary_events_sequence_id_seq',
      last_value::bigint, is_called
    from gioia_private.cutover_canary_events_sequence_id_seq
  )
  select pg_catalog.jsonb_build_object(
    'tables', (select pg_catalog.jsonb_object_agg(table_name,
      pg_catalog.jsonb_build_object('count', row_count, 'sha256', sha256))
      from table_evidence),
    'migrations', (select pg_catalog.jsonb_build_object(
      'count', count, 'sha256', sha256) from migration_evidence),
    'sequences', (select pg_catalog.jsonb_object_agg(sequence_name,
      pg_catalog.jsonb_build_object(
        'lastValue', last_value, 'isCalled', is_called))
      from sequence_evidence),
    'activeScheduleOverlaps', (select count(*)::integer
      from gioia_private.schedule_entries left_entry
      join gioia_private.schedule_entries right_entry
        on left_entry.id < right_entry.id
       and left_entry.local_date = right_entry.local_date
       and left_entry.occupied_span && right_entry.occupied_span
      where left_entry.status in ('confirmed', 'completed', 'active')
        and right_entry.status in ('confirmed', 'completed', 'active')),
    'activeVacationOverlaps', (select count(*)::integer
      from gioia_private.vacations left_vacation
      join gioia_private.vacations right_vacation
        on left_vacation.id < right_vacation.id
       and left_vacation.date_span && right_vacation.date_span
      where left_vacation.status = 'active'
        and right_vacation.status = 'active'),
    'cutoverMode', (select mode from gioia_private.cutover_write_control
      where singleton)
  ) as evidence
`;

function nonnegativeInteger(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

export function parseLocalPostgresRecoveryEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LOCAL_RECOVERY_EVIDENCE_INVALID");
  }
  if (
    value.cutoverMode !== "frozen" ||
    nonnegativeInteger(
      value.activeScheduleOverlaps,
      "LOCAL_RECOVERY_OVERLAP_INVALID",
    ) !== 0 ||
    nonnegativeInteger(
      value.activeVacationOverlaps,
      "LOCAL_RECOVERY_OVERLAP_INVALID",
    ) !== 0
  ) {
    throw new Error("LOCAL_RECOVERY_INVARIANT_FAILED");
  }
  const tables = value.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    throw new Error("LOCAL_RECOVERY_TABLE_EVIDENCE_INVALID");
  }
  for (const name of [
    "migration_runs",
    "migration_records",
    "migration_quarantine",
    "schedule_entries",
    "vacations",
    "newsletter_subscribers",
    "domain_change_log",
    "command_requests",
    "email_outbox",
    "cutover_write_control",
    "cutover_transition_log",
  ]) {
    const evidence = tables[name];
    if (
      !evidence ||
      typeof evidence !== "object" ||
      !SHA256.test(String(evidence.sha256 ?? ""))
    ) {
      throw new Error("LOCAL_RECOVERY_TABLE_EVIDENCE_INVALID");
    }
    nonnegativeInteger(evidence.count, "LOCAL_RECOVERY_TABLE_EVIDENCE_INVALID");
  }
  if (
    !value.migrations ||
    typeof value.migrations !== "object" ||
    !SHA256.test(String(value.migrations.sha256 ?? "")) ||
    nonnegativeInteger(
      value.migrations.count,
      "LOCAL_RECOVERY_MIGRATIONS_INVALID",
    ) < 1
  ) {
    throw new Error("LOCAL_RECOVERY_MIGRATIONS_INVALID");
  }
  const sequences = value.sequences;
  if (!sequences || typeof sequences !== "object" || Array.isArray(sequences)) {
    throw new Error("LOCAL_RECOVERY_SEQUENCES_INVALID");
  }
  const expectedSequences = [
    "migration_quarantine_id_seq",
    "domain_change_log_sequence_id_seq",
    "newsletter_consent_events_sequence_id_seq",
    "email_dead_letter_events_sequence_id_seq",
    "cutover_transition_log_sequence_id_seq",
    "cutover_canary_events_sequence_id_seq",
  ];
  if (
    Object.keys(sequences).sort().join("|") !==
    expectedSequences.sort().join("|")
  ) {
    throw new Error("LOCAL_RECOVERY_SEQUENCES_INVALID");
  }
  for (const sequence of Object.values(sequences)) {
    if (
      !sequence ||
      typeof sequence !== "object" ||
      typeof sequence.isCalled !== "boolean" ||
      nonnegativeInteger(
        sequence.lastValue,
        "LOCAL_RECOVERY_SEQUENCES_INVALID",
      ) < 1
    ) {
      throw new Error("LOCAL_RECOVERY_SEQUENCES_INVALID");
    }
  }
  return Object.freeze(value);
}

export function parseLocalPostgresRecoveryPsql(stdout) {
  if (typeof stdout !== "string")
    throw new Error("LOCAL_RECOVERY_OUTPUT_INVALID");
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("LOCAL_RECOVERY_OUTPUT_INVALID");
  try {
    return parseLocalPostgresRecoveryEvidence(JSON.parse(lines[0]));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("LOCAL_RECOVERY_OUTPUT_INVALID");
    throw error;
  }
}

export function assertLocalPostgresRecoveryMatch(source, restored) {
  const sourceJson = JSON.stringify(parseLocalPostgresRecoveryEvidence(source));
  const restoredJson = JSON.stringify(
    parseLocalPostgresRecoveryEvidence(restored),
  );
  if (sourceJson !== restoredJson) throw new Error("LOCAL_RECOVERY_MISMATCH");
  return true;
}
