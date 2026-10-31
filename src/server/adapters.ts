import { MAX_IMPORT_EVENTS } from "../shared/limits.js";
import type { Event, Source } from "../shared/types.js";
import { AppError, assert, redact } from "./security.js";
function content(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((x) =>
        typeof x === "string"
          ? x
          : (x?.text ??
            x?.output ??
            (x?.type === "tool_use"
              ? JSON.stringify({ tool: x.name, input: x.input })
              : "")),
      )
      .join("\n");
  return "";
}
/** Export adapters only. Never scan a user's agent folders or execute session tools. */
export function parseSession(raw: string, source: Source): Event[] {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    try {
      data = raw
        .split(/\r?\n/)
        .filter((x) => x.trim())
        .map((x) => JSON.parse(x));
    } catch {
      throw new AppError(400, "无法解析 JSON / JSONL，请检查文件格式");
    }
  }
  const rows: any[] = Array.isArray(data)
    ? data
    : (data?.messages ??
      data?.events ??
      data?.conversation ??
      (data && (data.role || data.message || data.payload || data.type)
        ? [data]
        : []));
  assert(
    Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_IMPORT_EVENTS,
    400,
    "需要 1–50000 条会话事件",
  );
  // Codex often records the same message in event_msg and response_item.
  // Prefer the canonical response_item without collapsing repeated turns.
  const mirrored = new Map<string, number>();
  if (source === "codex")
    for (const row of rows) {
      const p = row?.payload;
      if (
        row?.type === "response_item" &&
        p?.type === "message" &&
        ["user", "assistant"].includes(p.role)
      ) {
        const key = p.role + "\0" + content(p.content).trim();
        mirrored.set(key, (mirrored.get(key) || 0) + 1);
      }
    }
  const events: Event[] = [];
  for (const [i, row] of rows.entries()) {
    assert(row && typeof row === "object", 400, "事件必须为 JSON 对象");
    if (
      source === "codex" &&
      ["session_meta", "turn_context"].includes(row.type)
    )
      continue;
    let p = row.message && typeof row.message === "object" ? row.message : row;
    if (source === "codex" && row.payload) p = row.payload;
    const text =
      content(p.content) ||
      content(p.text) ||
      content(p.message) ||
      content(p.output) ||
      (p.arguments ? String(p.arguments) : "");
    if (!text.trim()) continue;
    if (
      source === "codex" &&
      (["reasoning", "agent_reasoning", "agent_reasoning_raw_content"].includes(
        p.type,
      ) ||
        ["developer", "system"].includes(p.role))
    )
      continue;
    if (
      source === "codex" &&
      row.type === "event_msg" &&
      ["user_message", "agent_message"].includes(p.type)
    ) {
      const mirrorRole = p.type === "user_message" ? "user" : "assistant";
      const key = mirrorRole + "\0" + text.trim();
      if ((mirrored.get(key) || 0) > 0) {
        mirrored.set(key, mirrored.get(key)! - 1);
        continue;
      }
    }
    const role =
      p.role ??
      (p.type === "user_message"
        ? "user"
        : p.type === "agent_message"
          ? "assistant"
          : (row.role ?? row.type ?? "tool"));
    events.push({
      id: `e${i + 1}`,
      role,
      text: redact(text),
      timestamp: row.timestamp ?? row.createdAt,
      type:
        p.phase === "final_answer"
          ? "final_answer"
          : (p.type ?? row.type ?? "message"),
    });
  }
  assert(
    events.length > 0,
    400,
    "未发现可读消息。Cursor 请导出 messages 数组；不支持私有 SQLite 数据库直接导入。",
  );
  return events;
}
export interface SourceConnector {
  kind: "github-pr" | "github-issue" | "chatgpt" | "meeting" | "im";
  fetch(input: {
    externalId: string;
    cursor?: string;
  }): Promise<{ raw: string; source: "generic"; cursor?: string }>;
}
// Extension contract only; no GitHub, meeting or IM network connector is registered in the MVP.
