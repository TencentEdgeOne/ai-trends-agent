import type { AgentContext } from '@edgeone/types';
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

export function getBody(context: AgentContext): Record<string, any> {
  const body = context?.request?.body ?? (context as any)?.body ?? context;
  return body && typeof body === 'object' ? body : {};
}

export function getEnv(context: AgentContext): Record<string, string | undefined> {
  return { ...process.env, ...(context?.env ?? {}) };
}
