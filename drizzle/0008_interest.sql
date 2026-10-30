CREATE TABLE "interest" (
	"pk" integer PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "interest_name_unique" UNIQUE("name")
);

--> statement-breakpoint
-- 재학생 고정 관심 분야 seed (CRB-55). pk는 한 번 정하면 바꾸지 않음. 추가 · 수정은 어드민(CRB-58)에서
INSERT INTO "interest" ("pk", "name", "sort_order") VALUES
	(1, '반도체', 1),
	(2, '소프트웨어', 2),
	(3, '인공지능', 3),
	(4, '데이터 사이언스', 4),
	(5, '로보틱스', 5),
	(6, '신소재', 6),
	(7, '에너지·환경', 7),
	(8, '바이오·헬스케어', 8),
	(9, '물리·광과학', 9),
	(10, '수학·통계', 10),
	(11, '금융·핀테크', 11),
	(12, '창업·스타트업', 12);
