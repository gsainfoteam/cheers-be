import { randomUUID } from "crypto";
import { extname } from "path";
import { FileDirectory } from "./file.constants";

/**
 * builds a unique S3 object key, e.g. business-card/<uuid>.jpg
 * @param directory FileDirectory
 * @param originalName string original file name, used only for the extension
 * @returns string
 */
export function generateFileKey(
  directory: FileDirectory,
  originalName: string,
): string {
  return `${directory}/${randomUUID()}${extname(originalName).toLowerCase()}`;
}
