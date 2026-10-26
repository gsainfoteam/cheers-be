import { randomUUID } from "crypto";
import { FILE_EXTENSIONS, FileDirectory } from "./file.constants";

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
 * @param buffer Buffer
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

/**
 * builds a unique S3 object key, e.g. business-card/<uuid>.jpg
 * the extension comes from the detected MIME type, not the original file name
 * @param directory FileDirectory
 * @param mimeType string detected MIME type (detectFileMimeType)
 * @returns string
 */
export function generateFileKey(
  directory: FileDirectory,
  mimeType: string,
): string {
  const extension = FILE_EXTENSIONS[mimeType];
  return `${directory}/${randomUUID()}${extension ? `.${extension}` : ""}`;
}
