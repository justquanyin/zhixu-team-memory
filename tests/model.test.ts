import { afterEach, expect, it, vi } from "vitest";
import { extract } from "../src/server/extraction.js";
const events = [
  {
    id: "e1",
    role: "assistant",
    type: "message",
    text: "[决策:model.test] 接口超时采用 30 秒",
  },
];
const draft = {
  topic_key: "model.test",
  title: "接口超时",
  body: "接口超时采用 30 秒",
  kind: "decision",
  evidence: [{ eventId: "e1", quote: "接口超时采用 30 秒" }],
  confidence: 0.8,
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup(content: unknown) {
  vi.stubEnv("EXTRACTOR", "llm");
  vi.stubEnv("LLM_API_KEY", "synthetic-test-value");
  vi.stubEnv("LLM_MODEL", "synthetic-test-model");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
    }),
  );
}
it("可选模型提取器调用 OpenAI-compatible JSON 接口并验证来源", async () => {
  setup({ candidates: [draft] });
  const results = await extract(events);
  expect(results[0].topic_key).toBe("model.test");
  expect(fetch).toHaveBeenCalledOnce();
  const input = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(input.messages[0].content).toContain("untrusted data");
});
it("模型伪造证据会拒绝整批，不把幻觉提升成候选", async () => {
  setup({
    candidates: [
      { ...draft, evidence: [{ eventId: "e1", quote: "虚构的内容" }] },
    ],
  });
  await expect(extract(events)).rejects.toThrow("证据引用");
});
it("模型响应格式不正确时显式报错", async () => {
  setup({ candidates: [{ title: "missing fields" }] });
  await expect(extract(events)).rejects.toThrow();
});
