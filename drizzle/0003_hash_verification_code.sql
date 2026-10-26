-- 인증번호를 원문 대신 HMAC-SHA256(hex, 64자)으로 저장 (CRB-31)
-- 진행 중인 요청의 원문 코드는 더 이상 확인할 수 없으므로 지움 (사용자는 다시 받으면 됨)
DELETE FROM "student_email_verification";--> statement-breakpoint
ALTER TABLE "student_email_verification" ALTER COLUMN "code" SET DATA TYPE varchar(64);
