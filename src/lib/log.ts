/**
 * Structured JSON logs. Keys that could carry secrets or money are redacted by name,
 * so a careless `log.info("x", { tokens })` cannot leak them.
 */
const REDACT = /token|secret|code|password|authorization|cookie|amount|value|price|balance|units|cash/i;

type Fields = Record<string, unknown>;

function redact(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Fields);
    else out[k] = v;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", msg: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};

export { redact as _redactForTests };
