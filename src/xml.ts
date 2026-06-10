const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toTagName = (name: string): string => {
  const sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
};

const valueToXml = (value: unknown, tag: string): string => {
  const name = toTagName(tag);

  if (value === null || value === undefined) {
    return `<${name}/>`;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `<${name}>${escapeXml(String(value))}</${name}>`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => valueToXml(item, "item")).join("");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `<${name}/>`;
    }
    const inner = entries.map(([key, entry]) => valueToXml(entry, key)).join("");
    return `<${name}>${inner}</${name}>`;
  }

  return `<${name}/>`;
};

export const objectToXml = (value: unknown, rootTag = "response"): string => {
  const body = valueToXml(value, rootTag);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
};

export type NegotiatedContentType =
  | "application/json"
  | "application/xml"
  | "text/xml"
  | "text/html"
  | "text/plain";

export const negotiateContentType = (
  accept: string | undefined,
): NegotiatedContentType => {
  if (!accept) {
    return "application/json";
  }

  const candidates = accept
    .split(",")
    .map((part) => {
      const [type, ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const quality = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { type: type.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { type } of candidates) {
    if (type === "application/xml" || type === "text/xml") {
      return type === "text/xml" ? "text/xml" : "application/xml";
    }
    if (type === "text/plain") {
      return "text/plain";
    }
    if (type === "text/html" || type === "application/xhtml+xml") {
      return "text/html";
    }
    if (type === "application/json") {
      return "application/json";
    }
  }

  return "application/json";
};
