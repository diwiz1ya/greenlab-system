function toPostgresPlaceholders(sql) {
  const text = String(sql || "");
  let output = "";
  let index = 0;
  let parameterIndex = 1;
  let state = "code";

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1] || "";

    if (state === "line-comment") {
      output += char;
      if (char === "\n") state = "code";
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      output += char;
      if (char === "*" && next === "/") {
        output += next;
        index += 2;
        state = "code";
        continue;
      }
      index += 1;
      continue;
    }

    if (state === "single-quote") {
      output += char;
      if (char === "'" && next === "'") {
        output += next;
        index += 2;
        continue;
      }
      if (char === "'") state = "code";
      index += 1;
      continue;
    }

    if (state === "double-quote") {
      output += char;
      if (char === '"' && next === '"') {
        output += next;
        index += 2;
        continue;
      }
      if (char === '"') state = "code";
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      output += char + next;
      index += 2;
      state = "line-comment";
      continue;
    }

    if (char === "/" && next === "*") {
      output += char + next;
      index += 2;
      state = "block-comment";
      continue;
    }

    if (char === "'") {
      output += char;
      index += 1;
      state = "single-quote";
      continue;
    }

    if (char === '"') {
      output += char;
      index += 1;
      state = "double-quote";
      continue;
    }

    if (char === "?") {
      output += `$${parameterIndex}`;
      parameterIndex += 1;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return {
    sql: output,
    parameterCount: parameterIndex - 1
  };
}

module.exports = {
  toPostgresPlaceholders
};
