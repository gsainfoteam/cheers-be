CREATE TABLE "aligo_alert_state" (
	"pk" smallint PRIMARY KEY NOT NULL,
	"alerted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alimtalk_template" (
	"event" "notification_event" PRIMARY KEY NOT NULL,
	"tpl_code" varchar(64) DEFAULT '' NOT NULL,
	"title" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"button_name" varchar(14) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- 지금까지 코드에 있던 템플릿 문구. tpl_code는 비워 두고 서버가 뜰 때 KAKAO_TEMPLATE_* 환경변수로 채움 (비어 있으면 어드민에서 입력)
INSERT INTO "alimtalk_template" ("event", "tpl_code", "title", "message", "button_name") VALUES
  ('coffee_chat_requested', '', '☕️ 커피챗 요청 안내', E'재학생 회원으로부터 새로운 커피챗 요청이 도착했어요\n요청 내용을 확인하고 커피챗 가능 여부를 알려주세요 :)', 'Cheers에서 확인하기'),
  ('contact_shared', '', '☕️ 연락처 공유 안내', E'회원님의 커피챗 요청에 대해 선배가 연락처를 공유했어요\n연락처를 확인하고 커피챗 일정을 잡아볼까요?', 'Cheers에서 확인하기');--> statement-breakpoint
INSERT INTO "aligo_alert_state" ("pk") VALUES (1);
