export type Role = "admin" | "reviewer" | "member" | "reader";
export type Source = "claude-code" | "codex" | "cursor" | "generic";
export interface Event {
  id: string;
  role: string;
  text: string;
  timestamp?: string;
  type: string;
}
export interface Evidence {
  eventId: string;
  quote: string;
}
export interface Draft {
  topic_key: string;
  title: string;
  body: string;
  kind: string;
  rationale: string;
  rejected_alternatives: string;
  revisit_condition: string;
  evidence: Evidence[];
  confidence: number;
}
export interface Context {
  userId: string;
  projectId: string;
  role: Role;
}
