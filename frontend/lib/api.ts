// Thin fetch wrapper around the backend API. This replaces the prototype's
// in-memory `S` state mutations with real HTTP calls.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ensemblis_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("ensemblis_token", token);
  else localStorage.removeItem("ensemblis_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  signup: (body: {
    email: string;
    password: string;
    name: string;
    company?: string;
    accountType: "COMPANY" | "DEVELOPER";
    builds?: string;
  }) => request<{ token: string; user: any }>("/api/auth/signup", { method: "POST", body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: any }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),

  me: () => request<{ user: any }>("/api/auth/me"),

  listAgents: () => request<{ agents: any[] }>("/api/agents"),

  listMyAgents: () => request<{ agents: any[] }>("/api/agents/mine/list"),

  publishAgent: (body: {
    name: string;
    category: string;
    description: string;
    systemPrompt: string;
    pricePerTaskCents: number;
  }) => request<{ agent: any }>("/api/agents", { method: "POST", body: JSON.stringify(body) }),

  listTasks: () => request<{ tasks: any[] }>("/api/tasks"),

  getTask: (id: string) => request<{ task: any }>(`/api/tasks/${id}`),

  createTask: (body: { title: string; description: string; agentId?: string }) =>
    request<{ task: any }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),

  sendFeedback: (id: string, outcome: "Achieved" | "Partially" | "Not achieved") =>
    request<{ task: any }>(`/api/tasks/${id}/feedback`, { method: "POST", body: JSON.stringify({ outcome }) }),

  listWorkflows: () => request<{ workflows: any[] }>("/api/workflows"),

  createWorkflow: (body: { name: string; basedOnText: string; frequency: "Weekly" | "Monthly" | "Quarterly" }) =>
    request<{ workflow: any }>("/api/workflows", { method: "POST", body: JSON.stringify(body) }),
};
