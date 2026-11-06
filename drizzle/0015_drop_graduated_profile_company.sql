-- 0014 이후 이전 버전 pod가 회사 없이 저장한 프로필(company_alias_pk IS NULL)을 회사에 연결 (0014 backfill과 같은 정규화 규칙)
-- 기존 표기(company_name.normalized_name)와 맞지 않는 이름은 회사 · 표기를 새로 만들고 어드민이 확인하도록 needs_review = true.
-- 회사 이름은 그중 가장 먼저 저장된 원문. 같은 이름의 회사가 이미 있으면 그 회사에 표기를 붙임
INSERT INTO "company_alias" ("name", "needs_review")
SELECT DISTINCT ON (lower(regexp_replace(regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))) regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g'), true
FROM "graduated_profile" gp
WHERE gp."company_alias_pk" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "company_name" cn
    WHERE cn."normalized_name" = lower(regexp_replace(regexp_replace(normalize(gp."company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
  )
ORDER BY lower(regexp_replace(regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')), "created_at", "graduated_pk"
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "company_name" ("alias_pk", "name", "normalized_name")
SELECT ca."pk", p."name", p."normalized_name"
FROM (
  SELECT DISTINCT ON (lower(regexp_replace(regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')))
    regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g') AS "name",
    lower(regexp_replace(regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) AS "normalized_name"
  FROM "graduated_profile"
  WHERE "company_alias_pk" IS NULL
  ORDER BY lower(regexp_replace(regexp_replace(normalize("company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')), "created_at", "graduated_pk"
) p
JOIN "company_alias" ca ON ca."name" = p."name"
ON CONFLICT ("normalized_name") DO NOTHING;--> statement-breakpoint
UPDATE "graduated_profile" SET "company_alias_pk" = cn."alias_pk"
FROM "company_name" cn
WHERE "graduated_profile"."company_alias_pk" IS NULL
  AND cn."normalized_name" = lower(regexp_replace(regexp_replace(normalize("graduated_profile"."company", NFC), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'));--> statement-breakpoint
ALTER TABLE "graduated_profile" ALTER COLUMN "company_alias_pk" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "graduated_profile" DROP COLUMN "company";
