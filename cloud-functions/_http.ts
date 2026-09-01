import type { CloudFunctionContext } from '@edgeone/types';
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

export async function readJsonBody(context: CloudFunctionContext): Promise<Record<string, any>> {
  try {
    const data = await context.request!.json();
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, any>)
      : {};
  } catch {
    return {};
  }
}
