import type { Draft, Event } from "../shared/types.js";
import { hash } from "./security.js";
/** Offline proposals only: evidence-linked snippets, never verified facts. */
export function extractRules(events: Event[]): Draft[] {
  const ranked: { draft: Draft; score: number; index: number }[] = [];
  events.forEach((event, index) => {
    if (!["user", "assistant"].includes(event.role)) return;
    let text = event.text;
    if (/^\s*<(environment_context|external_codex_apps_open_page)>/.test(text))
      return;
    const requestMarker = text.lastIndexOf("## My request:");
    if (requestMarker >= 0)
      text = text.slice(requestMarker + "## My request:".length);
    text = text.replace(/```[\s\S]*?```/g, "");
    const lines = text
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (/^(?:[#{]|<|!\[|\|\s*[-:]+|::|\s*\/\/)/.test(line)) continue;
      const explicit = line.match(
        /^\[(决策|事实|经验|流程|decision|fact|lesson|procedure):\s*([^\]]+)\]\s*(.+)$/i,
      );
      const pieces = explicit
        ? [line]
        : line.match(/[^。！？；]+[。！？；]?/g) || [];
      for (const quote of pieces) {
        const sentence = quote.trim();
        if (!explicit && (sentence.length < 12 || sentence.length > 600))
          continue;
        if (
          !explicit &&
          /https?:\/\/|chatgpt-conversation:|\/Users\/|\/mnt\/|^\s*[-*]\s*\[/.test(
            sentence,
          )
        )
          continue;
        const preference =
          event.role === "user" &&
          /(希望|要求|需要|不要|去掉|保留|改为|优先|是ok|是 ok|可以使用|应当|必须|还是要|太突兀)/i.test(
            sentence,
          );
        const durable =
          /(决定|采用|约定|必须|禁止|根因|修复方式|默认|不支持|不能|不可|未接|未实|没有可|限制|we decided|must |root cause)/i.test(
            sentence,
          );
        const completed =
          event.role === "assistant" &&
          event.type === "final_answer" &&
          !/(我会|将会|选定后|接下来)/.test(sentence) &&
          /(已完成|已去掉|已做好|保留|无旁白|无口播|通过|约|版本|字幕)/.test(
            sentence,
          );
        if (!explicit && !preference && !durable && !completed) continue;
        if (
          !explicit &&
          /^(我会|接下来|正在|当前已导出|目前导出|导出已到|渲染已|渲染完成)/.test(
            sentence,
          )
        )
          continue;
        const body = explicit?.[3] ?? sentence;
        const uncertain = /(建议|尚未|未确认|未经|尝试|希望|propos)/i.test(
          body,
        );
        const rejected = /(否决|不采用|reject)/i.test(body);
        const kind = explicit
          ? ((
              {
                决策: "decision",
                事实: "fact",
                经验: "lesson",
                流程: "procedure",
              } as Record<string, string>
            )[explicit[1]] ?? explicit[1].toLowerCase())
          : preference
            ? "procedure"
            : completed
              ? "fact"
              : /(限制|失败|问题|根因|无法)/.test(body)
                ? "lesson"
                : "decision";
        const title =
          (preference
            ? "用户约束："
            : !explicit && completed
              ? "会话报告："
              : "") +
          body.replace(/\*\*/g, "").replace(/^(?:[-*]\s+|\d+\.\s+)/, "");
        const draft: Draft = {
          topic_key: explicit?.[2].trim() ?? `note.${hash(body).slice(0, 12)}`,
          title: title.slice(0, 100),
          body: body.slice(0, 8000),
          kind,
          rationale: preference
            ? "用户在此会话中提出的约束；不自动推广为跨项目偏好。"
            : "原会话中的陈述，尚未独立验证；需要人工确认适用范围。",
          rejected_alternatives: rejected ? body : "",
          revisit_condition: "需求、上下文或依赖发生变化时重新审核",
          evidence: [{ eventId: event.id, quote: sentence.slice(0, 2000) }],
          confidence: explicit?.[1]
            ? uncertain
              ? 0.4
              : 0.72
            : preference
              ? 0.65
              : completed
                ? 0.6
                : 0.55,
        };
        ranked.push({
          draft,
          score:
            (explicit ? 10 : 0) +
            (preference ? 4 : 0) +
            (completed ? 3 : 0) +
            (durable ? 2 : 0),
          index,
        });
      }
    }
  });
  const unique = new Map<
    string,
    { draft: Draft; score: number; index: number }
  >();
  for (const row of ranked) unique.set(row.draft.topic_key, row);
  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 12)
    .map((x) => x.draft);
}
