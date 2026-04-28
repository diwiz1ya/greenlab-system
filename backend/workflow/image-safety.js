"use strict";

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function normalizeImageMimeType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!type) return "";
  if (type === "image/jpg") return "image/jpeg";
  return type;
}

function getImageExtensionByMimeType(mimeType) {
  const type = normalizeImageMimeType(mimeType);
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

function detectImageMimeTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";

  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4E
    && buffer[3] === 0x47
    && buffer[4] === 0x0D
    && buffer[5] === 0x0A
    && buffer[6] === 0x1A
    && buffer[7] === 0x0A
  ) {
    return "image/png";
  }

  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  const gifHeader = buffer.toString("ascii", 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }

  return "";
}

function parseImageDataUrl(dataUrl) {
  const source = String(dataUrl || "").trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(source);
  if (!match) {
    throw new Error("Invalid image format.");
  }
  const declaredMimeType = normalizeImageMimeType(match[1]);
  if (!declaredMimeType.startsWith("image/")) {
    throw new Error("Invalid image MIME type.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Empty image.");
  }
  return {
    declaredMimeType,
    buffer
  };
}

function validateImageBuffer(buffer, options = {}) {
  const declaredMimeType = normalizeImageMimeType(options.declaredMimeType);
  const maxBytes = Number(options.maxBytes) > 0
    ? Math.trunc(Number(options.maxBytes))
    : DEFAULT_MAX_IMAGE_BYTES;

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Image was not provided.");
  }
  if (buffer.length > maxBytes) {
    throw new Error(`Image is too large (>${Math.floor(maxBytes / (1024 * 1024))}MB).`);
  }

  const detectedMimeType = detectImageMimeTypeFromBuffer(buffer);
  if (!detectedMimeType || !allowedMimeTypes.has(detectedMimeType)) {
    throw new Error("File is not a supported image (JPEG/PNG/WEBP/GIF).");
  }

  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
    throw new Error("File MIME type does not match the image signature.");
  }

  return {
    mimeType: detectedMimeType,
    extension: getImageExtensionByMimeType(detectedMimeType),
    sizeBytes: buffer.length
  };
}

module.exports = {
  parseImageDataUrl,
  validateImageBuffer
};
