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
