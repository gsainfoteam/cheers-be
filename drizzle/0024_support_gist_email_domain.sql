-- Custom SQL migration file, put your code below! --
-- GIST 재학생 메일은 기존 gm.gist.ac.kr 외에 gist.ac.kr도 사용한다.
-- school_email_domain은 인증과 학과 목록의 공통 기준이므로 같은 GIST 학교(pk 1)에 매핑한다.
INSERT INTO "school_email_domain" ("school_pk", "domain") VALUES
  (1, 'gist.ac.kr');
