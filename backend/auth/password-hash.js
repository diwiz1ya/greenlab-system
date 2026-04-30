const crypto = require("node:crypto");

const REDACTED_PASSWORD_VALUE = "__legacy_removed__";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyHashedPassword(password, storedHash) {
  const text = String(storedHash || "");
  const parts = text.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) {
    return false;
  }

  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

async function ensurePasswordHashes(userRepository) {
  const rows = await userRepository.listPasswordRows();
  for (const row of rows) {
    const storedHash = String(row.password_hash || "").trim();
    const hasValidHash = storedHash.startsWith("scrypt$");
    const plain = String(row.password || "");

    if (!hasValidHash) {
      if (!plain || plain === REDACTED_PASSWORD_VALUE) {
        continue;
      }
      await userRepository.updatePasswordHashAndRedact(row.id, REDACTED_PASSWORD_VALUE, hashPassword(plain));
      continue;
    }

    if (plain !== REDACTED_PASSWORD_VALUE) {
      await userRepository.redactPassword(row.id, REDACTED_PASSWORD_VALUE);
    }
  }
}

module.exports = {
  REDACTED_PASSWORD_VALUE,
  hashPassword,
  verifyHashedPassword,
  ensurePasswordHashes
};
