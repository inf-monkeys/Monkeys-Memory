function formatScalar(value) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }

  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:-]+$/.test(stringValue)) {
    return stringValue;
  }

  return JSON.stringify(stringValue);
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function render(value, indent) {
  const prefix = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]`;
    }

    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${prefix}- ${formatScalar(item)}`;
        }

        const nested = render(item, indent + 2).split("\n");
        return `${prefix}- ${nested[0].trimStart()}\n${nested.slice(1).join("\n")}`;
      })
      .join("\n");
  }

  if (isScalar(value)) {
    return `${prefix}${formatScalar(value)}`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return `${prefix}{}`;
  }

  return entries
    .map(([key, item]) => {
      if (isScalar(item)) {
        return `${prefix}${key}: ${formatScalar(item)}`;
      }

      return `${prefix}${key}:\n${render(item, indent + 2)}`;
    })
    .join("\n");
}

export function toYaml(value) {
  return `${render(value, 0)}\n`;
}
