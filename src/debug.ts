export interface DebugLogger {
  enabled: boolean;
  log(event: string, details?: Record<string, unknown>): void;
}

export interface DebugLoggerOptions {
  enabled: boolean;
  maxFieldLength?: number;
  writer?: (message: string) => void;
}

const DEFAULT_MAX_FIELD_LENGTH = 2000;

export const noopDebugLogger: DebugLogger = {
  enabled: false,
  log: () => undefined,
};

export function createDebugLogger(options: DebugLoggerOptions): DebugLogger {
  const maxFieldLength = options.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;
  const writer = options.writer ?? ((message: string) => console.error(message));

  if (!options.enabled) return noopDebugLogger;

  return {
    enabled: true,
    log(event, details = {}) {
      writer(
        JSON.stringify({
          ts: new Date().toISOString(),
          event,
          ...sanitizeDetails(details, maxFieldLength),
        }),
      );
    },
  };
}

function sanitizeDetails(
  details: Record<string, unknown>,
  maxFieldLength: number,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, sanitizeValue(value, maxFieldLength, 0)]),
  );
}

function sanitizeValue(value: unknown, maxFieldLength: number, depth: number): unknown {
  if (typeof value === "string") return truncate(value, maxFieldLength);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, maxFieldLength),
    };
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return `[Array(${value.length})]`;
    return value.map((item) => sanitizeValue(item, maxFieldLength, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= 3) return "[Object]";
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sanitizeValue(child, maxFieldLength, depth + 1),
      ]),
    );
  }
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint" || typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[Function]";
  return "[Unknown]";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}
