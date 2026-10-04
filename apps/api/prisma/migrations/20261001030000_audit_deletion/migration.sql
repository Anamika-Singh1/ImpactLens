-- PostgreSQL 15+ supports clearing just the nullable column of a composite FK.
-- Keep the original repository UUID separately and prohibit every content edit.
BEGIN;
DROP TRIGGER audit_immutable ON "AuditEvent";
ALTER TABLE "AuditEvent" ADD COLUMN "repositoryRef" UUID;
UPDATE "AuditEvent" SET "repositoryRef" = "repositoryId";
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_repositoryId_workspaceId_fkey";
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_repositoryId_workspaceId_fkey"
  FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId")
  ON DELETE SET NULL ("repositoryId") ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION protect_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."repositoryId" IS NOT NULL THEN NEW."repositoryRef" := NEW."repositoryId"; END IF;
    RETURN NEW;
  END IF;
  IF OLD."repositoryId" IS NOT NULL AND NEW."repositoryId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "Repository" WHERE "id" = OLD."repositoryId")
    AND (to_jsonb(NEW) - 'repositoryId') = (to_jsonb(OLD) - 'repositoryId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit events are immutable; only parent removal can clear their live repository relation';
END; $$;
CREATE TRIGGER audit_immutable BEFORE INSERT OR UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION protect_audit_event();
COMMIT;
