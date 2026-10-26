import { UserType } from "@src/auth/auth.types";

export const FileDirectory = {
  BUSINESS_CARD: "business-card",
} as const;

export type FileDirectory = (typeof FileDirectory)[keyof typeof FileDirectory];

// 업로드 URL 발급 API의 purpose 값
export const FilePurpose = {
  BUSINESS_CARD: "business_card",
} as const;

export type FilePurpose = (typeof FilePurpose)[keyof typeof FilePurpose];

// 확정 전 업로드 위치. 버킷 lifecycle이 이 prefix를 1일 뒤 삭제
export const TEMP_PREFIX = "tmp/";

export interface FileUploadPolicy {
  directory: FileDirectory;
  maxSize: number;
  // Content-Type → 저장할 확장자
  allowedContentTypes: Record<string, string>;
  allowedUserTypes: UserType[];
}

export const FILE_UPLOAD_POLICIES: Record<FilePurpose, FileUploadPolicy> = {
  [FilePurpose.BUSINESS_CARD]: {
    directory: FileDirectory.BUSINESS_CARD,
    maxSize: 10 * 1024 * 1024,
    allowedContentTypes: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/heic": "heic",
      "image/heif": "heif",
    },
    allowedUserTypes: ["graduated"],
  },
};
