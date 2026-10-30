-- 이름을 OAuth에서 받지 않고 추가 정보 입력에서 받음 (CRB-52).
-- 가입 중인 유저에게 저장된 OAuth 이름을 비워서 직접 입력하게 함. 가입을 마친 유저의 이름은 유지
UPDATE "users" SET "name" = NULL, "updated_at" = now() WHERE "status" = 'pending';
