import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RequestHandler } from "express";
import multer from "multer";

/**
 * Delivery-proof photo uploads.
 *
 * Local disk for development; production wants the same S3-compatible object
 * storage as the contract PDFs, and only this module changes.
 *
 * Filenames are random rather than derived from what the client sent: an
 * uploaded name is untrusted input, and letting it reach the filesystem is how
 * path traversal happens.
 */

const STORAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "storage",
  "proofs",
);

mkdirSync(STORAGE_DIR, { recursive: true });

/** A phone photo, not a scan. 8 MB is generous for one. */
const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
]);

// Annotated because pnpm's isolated node_modules makes multer's inferred
// middleware type unnameable from here.
export const proofUpload: RequestHandler = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, STORAGE_DIR),
    filename: (_req, file, done) => {
      const extension = ALLOWED.get(file.mimetype) ?? ".bin";
      done(null, `${randomBytes(16).toString("hex")}${extension}`);
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (!ALLOWED.has(file.mimetype)) {
      // Surfaced by the error middleware as a readable 400.
      done(new Error("Delivery proof must be a JPEG, PNG, WebP or HEIC photo"));
      return;
    }
    done(null, true);
  },
}).single("proof");
