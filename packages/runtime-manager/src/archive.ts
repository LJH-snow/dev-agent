import { createHash } from "node:crypto";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";

import { RuntimeManagerError } from "./errors.js";
import { isSafeRelativePath, resolveWithin } from "./security.js";

const TAR_BLOCK_SIZE = 512;
const ZERO_BLOCK = Buffer.alloc(TAR_BLOCK_SIZE);

function fieldString(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "").trim();
}

function fieldOctal(buffer: Buffer, start: number, length: number): number {
  const value = fieldString(buffer, start, length).replace(/\0/g, "").trim();
  if (value === "") return 0;
  if (!/^[0-7]+$/.test(value)) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an invalid tar number");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an unsafe tar number");
  }
  return parsed;
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.equals(ZERO_BLOCK);
}

function validateChecksum(header: Buffer): void {
  const expectedText = fieldString(header, 148, 8).replace(/\0/g, "").trim();
  if (!/^[0-7]+$/.test(expectedText)) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an invalid tar checksum");
  const expected = Number.parseInt(expectedText, 8);
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index] ?? 0;
  }
  if (actual !== expected) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive checksum is invalid");
}

function entryName(header: Buffer): string {
  const name = fieldString(header, 0, 100);
  const prefix = fieldString(header, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function parsePaxAttributes(data: Buffer): Record<string, string> {
  const attributes: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains a malformed PAX header");
    const lengthText = data.subarray(offset, space).toString("ascii");
    if (!/^[0-9]+$/.test(lengthText)) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains a malformed PAX length");
    const recordLength = Number(lengthText);
    if (!Number.isSafeInteger(recordLength) || recordLength <= space - offset || offset + recordLength > data.length) {
      throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an unsafe PAX length");
    }
    const record = data.subarray(offset, offset + recordLength).toString("utf8");
    if (!record.endsWith("\n")) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains a malformed PAX record");
    const equals = record.indexOf("=");
    if (equals <= 0) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains a malformed PAX record");
    attributes[record.slice(0, equals)] = record.slice(equals + 1, -1);
    offset += recordLength;
  }
  return attributes;
}

function paxSize(attributes: Record<string, string>, fallback: number): number {
  const value = attributes.size;
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an invalid PAX size");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an unsafe PAX size");
  return parsed;
}

function archivePath(destination: string, entry: string): string {
  if (!isSafeRelativePath(entry)) {
    throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an unsafe path");
  }
  try {
    return resolveWithin(destination, entry);
  } catch {
    throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive path escapes the staging directory");
  }
}

export async function extractTarGz(archive: Uint8Array, destination: string): Promise<void> {
  let tar: Buffer;
  try {
    tar = gunzipSync(Buffer.from(archive));
  } catch {
    throw new RuntimeManagerError("ARCHIVE_INVALID", "Runtime archive is not a valid gzip stream");
  }

  await mkdir(destination, { recursive: true, mode: 0o700 });
  const entries = new Set<string>();
  let globalPax: Record<string, string> = {};
  let localPax: Record<string, string> = {};
  let offset = 0;
  let sawTerminator = false;
  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;
    if (isZeroBlock(header)) {
      sawTerminator = true;
      break;
    }
    validateChecksum(header);

    const headerSize = fieldOctal(header, 124, 12);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156] ?? 0);
    if (type === "x" || type === "g") {
      if (offset + headerSize > tar.length) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive extended header is truncated");
      const attributes = parsePaxAttributes(tar.subarray(offset, offset + headerSize));
      if (type === "g") globalPax = { ...globalPax, ...attributes };
      else localPax = { ...localPax, ...attributes };
      offset += Math.ceil(headerSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
      continue;
    }
    if (type === "L" || type === "K") {
      throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains unsupported GNU link metadata");
    }

    const attributes = { ...globalPax, ...localPax };
    localPax = {};
    const name = attributes.path ?? entryName(header);
    if (!name) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an unnamed entry");
    const normalized = name.replace(/\/$/, "");
    if (!normalized) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains an invalid directory entry");
    if (entries.has(normalized)) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains duplicate entries");
    entries.add(normalized);

    const mode = fieldOctal(header, 100, 8) & 0o7777;
    const size = paxSize(attributes, headerSize);
    const outputPath = archivePath(destination, normalized);

    if (type !== "0" && type !== "5") {
      throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive contains unsupported links or special files");
    }
    if (offset + size > tar.length) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive entry is truncated");

    if (type === "5") {
      if (size !== 0) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive directory contains data");
      await mkdir(outputPath, { recursive: true, mode: mode || 0o755 });
      if (mode) await chmod(outputPath, mode);
    } else {
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o755 });
      await writeFile(outputPath, tar.subarray(offset, offset + size), { mode: mode || 0o644 });
      if (mode) await chmod(outputPath, mode);
    }

    offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  if (!sawTerminator) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive is missing its tar terminator");
  if (offset > tar.length) throw new RuntimeManagerError("ARCHIVE_INVALID", "Archive has a truncated tar block");
}

export async function hashFile(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  const file = await import("node:fs").then(({ createReadStream }) => createReadStream(filePath));
  for await (const chunk of file) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

export async function verifyExecutableFile(filePath: string): Promise<void> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    throw new RuntimeManagerError("HEALTH_CHECK_FAILED", "Runtime binary is missing");
  }
  if (!info.isFile() || (info.mode & 0o111) === 0) {
    throw new RuntimeManagerError("HEALTH_CHECK_FAILED", "Runtime binary is not executable");
  }
}

