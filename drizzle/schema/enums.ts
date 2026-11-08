import { pgEnum } from "drizzle-orm/pg-core";

/*
CREATE TYPE "user_status" AS ENUM ('pending', 'active');
CREATE TYPE "user_type" AS ENUM ('student', 'graduated');
CREATE TYPE "oauth_provider" AS ENUM ('google', 'apple', 'naver');
CREATE TYPE "attachment_kind" AS ENUM ('cv', 'portfolio');
CREATE TYPE "attachment_source" AS ENUM ('file', 'link');
CREATE TYPE "notification_event" AS ENUM ('coffee_chat_requested', 'contact_shared');
CREATE TYPE "notification_channel" AS ENUM ('email', 'kakao_alimtalk');
CREATE TYPE "notification_status" AS ENUM ('sent', 'failed');
CREATE TYPE "notification_delivery_status" AS ENUM ('pending', 'delivered', 'failed', 'unknown');
CREATE TYPE "admin_account_role" AS ENUM ('admin', 'superadmin');
CREATE TYPE "admin_access_target_type" AS ENUM ('business_card');
*/

// 가입 진행 중이면 pending, 추가 정보 입력까지 마치면 active
export const userStatus = pgEnum("user_status", ["pending", "active"]);

export const userType = pgEnum("user_type", ["student", "graduated"]);

export const oauthProvider = pgEnum("oauth_provider", [
  "google",
  "apple",
  "naver",
]);

export const attachmentKind = pgEnum("attachment_kind", ["cv", "portfolio"]);

// file: S3 object key + file_name, link: 외부 URL
export const attachmentSource = pgEnum("attachment_source", ["file", "link"]);

export const notificationEvent = pgEnum("notification_event", [
  "coffee_chat_requested",
  "contact_shared",
]);

export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "kakao_alimtalk",
]);

export const notificationStatus = pgEnum("notification_status", [
  "sent",
  "failed",
]);

// 알림톡 접수 뒤 카카오 단계의 최종 결과 (알리고 전송결과 조회, CRB-77).
// pending: 결과 대기, delivered: 도달, failed: 카카오 단계 실패, unknown: 24시간이 지나도 결과를 받지 못함
export const notificationDeliveryStatus = pgEnum(
  "notification_delivery_status",
  ["pending", "delivered", "failed", "unknown"],
);

// superadmin만 어드민 계정을 등록 · 변경 · 삭제할 수 있음
export const adminAccountRole = pgEnum("admin_account_role", [
  "admin",
  "superadmin",
]);

// 어드민이 열람한 개인정보 종류
export const adminAccessTargetType = pgEnum("admin_access_target_type", [
  "business_card",
  // 개발용 회원 완전탈퇴 (CRB-72). 열람이 아니라 삭제 기록
  "dev_user_hard_delete",
]);
