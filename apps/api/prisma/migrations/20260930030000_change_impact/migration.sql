ALTER TABLE "Analysis" ADD COLUMN "input" JSONB,
  ADD COLUMN "result" JSONB,
  ADD COLUMN "inputHash" CHAR(64),
  ADD COLUMN "resultHash" CHAR(64),
  ADD COLUMN "engineVersion" VARCHAR(30);
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_impact_complete" CHECK (
  ("input" IS NULL AND "result" IS NULL AND "inputHash" IS NULL AND "resultHash" IS NULL AND "engineVersion" IS NULL)
  OR ("input" IS NOT NULL AND "result" IS NOT NULL AND "inputHash" IS NOT NULL AND "resultHash" IS NOT NULL AND "engineVersion" IS NOT NULL AND status = 'COMPLETED')
);
CREATE FUNCTION protect_impact_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."input" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed impact comparisons are immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Analysis_immutable_impact" BEFORE UPDATE ON "Analysis"
FOR EACH ROW EXECUTE FUNCTION protect_impact_analysis();
