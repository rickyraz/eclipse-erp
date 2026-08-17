-- owner: process
-- reviewed: 2026-08-17
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: enforce Process workflow and job state transitions at the database boundary

CREATE OR REPLACE FUNCTION process.enforce_workflow_run_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, process
AS $$
BEGIN
  IF NEW.status::text <> 'running' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'workflow_runs_state_transition_check',
      MESSAGE = 'workflow runs must start in running state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION process.enforce_job_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, process
AS $$
BEGIN
  IF NEW.status::text <> 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'process_jobs_state_transition_check',
      MESSAGE = 'jobs must start in pending state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION process.enforce_workflow_run_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, process
AS $$
BEGIN
  IF OLD.status::text IN ('succeeded', 'manual_recovery')
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'workflow_runs_state_transition_check',
      MESSAGE = 'invalid workflow run state transition';
  END IF;

  IF OLD.status::text = 'running'
    AND NEW.status::text NOT IN ('running', 'succeeded', 'manual_recovery') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'workflow_runs_state_transition_check',
      MESSAGE = 'invalid workflow run state transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION process.enforce_job_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, process
AS $$
BEGIN
  IF OLD.status::text IN ('completed', 'failed', 'manual_recovery')
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'process_jobs_state_transition_check',
      MESSAGE = 'invalid job state transition';
  END IF;

  IF OLD.status::text = 'pending'
    AND NEW.status::text NOT IN ('pending', 'leased') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'process_jobs_state_transition_check',
      MESSAGE = 'invalid job state transition';
  ELSIF OLD.status::text = 'leased'
    AND NEW.status::text NOT IN ('leased', 'pending', 'completed', 'failed', 'manual_recovery') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'process_jobs_state_transition_check',
      MESSAGE = 'invalid job state transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_runs_initial_state
BEFORE INSERT ON process.workflow_runs
FOR EACH ROW
EXECUTE FUNCTION process.enforce_workflow_run_initial_state();

CREATE TRIGGER jobs_initial_state
BEFORE INSERT ON process.jobs
FOR EACH ROW
EXECUTE FUNCTION process.enforce_job_initial_state();

CREATE TRIGGER workflow_runs_state_transition
BEFORE UPDATE ON process.workflow_runs
FOR EACH ROW
EXECUTE FUNCTION process.enforce_workflow_run_state_transition();

CREATE TRIGGER jobs_state_transition
BEFORE UPDATE ON process.jobs
FOR EACH ROW
EXECUTE FUNCTION process.enforce_job_state_transition();
