import { randomUUID } from "crypto";
import { FileDirectory, TEMP_PREFIX } from "./file.constants";

/**
 * builds a unique temporary S3 object key, e.g. tmp/business-card/<userPk>/<uuid>.jpg
 * @param directory FileDirectory
 * @param userPk string owner of the file
 * @param extension string without the leading dot
 * @returns string
 */
export function generateTempFileKey(
  directory: FileDirectory,
  userPk: string,
  extension: string,
): string {
  return `${TEMP_PREFIX}${directory}/${userPk}/${randomUUID()}.${extension}`;
}

/**
 * checks that a temporary key was issued to this user for this directory
 * so a user cannot register someone else's upload
 */
export function isUserTempFileKey(
  directory: FileDirectory,
  userPk: string,
  key: string,
): boolean {
  const prefix = `${TEMP_PREFIX}${directory}/${userPk}/`;
  const rest = key.slice(prefix.length);
  return key.startsWith(prefix) && rest.length > 0 && !rest.includes("/");
}

/**
 * tmp/business-card/<userPk>/<uuid>.png → business-card/<userPk>/<uuid>.jpg
 * the extension follows the detected content, not the type requested for the upload URL
 * @param tempKey string
 * @param extension string without the leading dot
 */
export function toConfirmedFileKey(tempKey: string, extension: string): string {
  const key = tempKey.slice(TEMP_PREFIX.length);
  return `${key.slice(0, key.lastIndexOf("."))}.${extension}`;
}

// detectFileMimeType이 읽는 앞부분 바이트 수
export const FILE_SIGNATURE_LENGTH = 12;

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// ISO BMFF(ftyp) major brand → MIME 타입
const HEIF_BRANDS: Record<string, string> = {
  heic: "image/heic",
  heix: "image/heic",
  heim: "image/heic",
  heis: "image/heic",
  mif1: "image/heif",
  msf1: "image/heif",
};

/**
 * detects the MIME type from the file's leading bytes (magic numbers),
 * not from the Content-Type the client sent
 * @param buffer Buffer at least the first FILE_SIGNATURE_LENGTH bytes
 * @returns string | undefined undefined if the format is not supported
 */
export function detectFileMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.toString("latin1", 4, 8) === "ftyp") {
    return HEIF_BRANDS[buffer.toString("latin1", 8, 12)];
  }
  return undefined;
}
