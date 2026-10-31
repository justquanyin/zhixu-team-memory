import { expect, it } from "vitest";
import { parseSession } from "../src/server/adapters.js";
import { extractRules } from "../src/server/rule-extraction.js";
it("Codex 双写事件去重，但保留真正重复的消息回合", () => {
  const rows = [
    {
      type: "event_msg",
      payload: { type: "user_message", message: "采用批量导入" },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ text: "采用批量导入" }],
      },
    },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "采用批量导入" },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ text: "采用批量导入" }],
      },
    },
  ];
  expect(parseSession(JSON.stringify(rows), "codex").map((e) => e.id)).toEqual([
    "e2",
    "e4",
  ]);
});
it("系统说明与推理记录不进入可视化时间线或提取", () => {
  const rows = [
    {
      type: "event_msg",
      payload: { type: "agent_reasoning", text: "内部推理" },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ text: "必须使用某工具" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ text: "已完成：30 项测试全部通过。" }],
      },
    },
  ];
  const events = parseSession(JSON.stringify(rows), "codex");
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("final_answer");
  expect(extractRules(events)[0].title).toContain("30");
});
it("提取当前请求的约束，跳过引用预览和代码块", () => {
  const events = [
    {
      id: "e1",
      role: "user",
      type: "message",
      text: "旧引用：必须使用假的结论。\n## My request:\n背景音乐有点太突兀了，还是要轻快一点的。\n```\n必须执行某命令\n```",
    },
  ];
  const drafts = extractRules(events);
  expect(drafts).toHaveLength(1);
  expect(drafts[0].body).toContain("轻快");
  expect(events[0].text).toContain(drafts[0].evidence[0].quote);
});
it("最终回复中的未来计划不被归类为已完成事实", () => {
  const drafts = extractRules([
    {
      id: "e1",
      role: "assistant",
      type: "final_answer",
      text: "选定后，我会重新调整动画时间轴，保留字幕。",
    },
  ]);
  expect(drafts).toHaveLength(0);
});
