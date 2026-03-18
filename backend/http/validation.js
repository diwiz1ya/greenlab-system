function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function parsePositiveInt(value) {
  const text = toTrimmedString(value);
  if (!text) return null;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseRequiredString(value, options = {}) {
  const {
    minLength = 1,
    maxLength = 256
  } = options;

  const text = toTrimmedString(value);
  if (text.length < minLength) return null;
  if (text.length > maxLength) return null;
  return text;
}

function parseStation(stationLabels, value) {
  const station = parseRequiredString(value, { minLength: 2, maxLength: 32 });
  if (!station) return null;
  return Object.prototype.hasOwnProperty.call(stationLabels, station) ? station : null;
}

module.exports = {
  toTrimmedString,
  parsePositiveInt,
  parseRequiredString,
  parseStation
};
