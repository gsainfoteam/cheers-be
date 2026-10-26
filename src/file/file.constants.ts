export const FileDirectory = {
  BUSINESS_CARD: "business-card",
  ATTACHMENT: "attachment",
} as const;

export type FileDirectory = (typeof FileDirectory)[keyof typeof FileDirectory];

// 업로드 용도. 업로드 URL 발급 API와 confirmUpload가 이 값으로 정책을 고름
export const FilePurpose = {
  BUSINESS_CARD: "business_card",
  // 재학생 이력서 · 포트폴리오
  ATTACHMENT: "attachment",
} as const;

export type FilePurpose = (typeof FilePurpose)[keyof typeof FilePurpose];

// 확정 전 업로드 위치. 버킷 lifecycle이 이 prefix를 1일 뒤 삭제
export const TEMP_PREFIX = "tmp/";

export interface FileUploadPolicy {
  directory: FileDirectory;
  maxSize: number;
  // Content-Type → 저장할 확장자
  allowedContentTypes: Record<string, string>;
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
  },
  [FilePurpose.ATTACHMENT]: {
    directory: FileDirectory.ATTACHMENT,
    maxSize: 20 * 1024 * 1024,
    allowedContentTypes: {
      "application/pdf": "pdf",
    },
  },
};
