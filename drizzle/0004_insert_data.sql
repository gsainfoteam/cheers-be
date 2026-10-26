-- 약관 기준 데이터 (CRB-30). 마이그레이션이라 한 번만 실행됨
-- 새 버전은 행을 수정하지 말고 새 마이그레이션으로 추가 (user_consent 가 (type, version) 을 참조)
INSERT INTO "consent" ("type", "version", "is_required", "url") VALUES
	('privacy', '251022', true, 'https://terms.gistory.me/embedded/pot-g/privacy/251022'),
	('tos', '251022', true, 'https://terms.gistory.me/embedded/pot-g/tos/251022');
