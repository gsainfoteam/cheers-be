export const FileDirectory = {
  BUSINESS_CARD: "business-card",
} as const;

export type FileDirectory = (typeof FileDirectory)[keyof typeof FileDirectory];

export interface FileUploadPolicy {
  maxSize: number;
  allowedMimeTypes: string[];
}

export const BUSINESS_CARD_FILE_POLICY: FileUploadPolicy = {
  maxSize: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/heic", "image/heif"],
};

// 파일 내용에서 감지한 MIME 타입 → 저장할 확장자
export const FILE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};

// S3 사용자 메타데이터는 합쳐서 2KB까지라 원래 파일명은 앞부분만 저장
export const MAX_ORIGINAL_NAME_LENGTH = 100;
