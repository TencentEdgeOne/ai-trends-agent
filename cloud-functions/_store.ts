/**
 * Store access layer for cloud-functions.
 *
 * In cloud-functions, the store is accessed via `context.agent!.store`
 * (vs `context.store` in agents/).
 * Both point to the same underlying data.
 */

// Inline minimal types (mirrors agents/ai-trends/_types.ts)
import type { CloudFunctionContext } from '@edgeone/types';
interface TrendReport {
  runId: string;
  status: string;
  trigger?: string;
  generatedAt: string;
  durationMs?: number;
  itemCount: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary: string;
  reportMarkdown: string;
  trends: unknown[];
  items: unknown[];
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
  [key: string]: unknown;
}

interface HistoryEntry {
  runId?: string;
  status?: string;
  trigger?: string;
  generatedAt?: string;
  itemCount?: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary?: string;
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

const REPORT_CONVERSATION_ID = 'ai-trends-reports';
const REPORT_KIND = 'ai_trends_report';

interface MemoryMessage {
  messageId?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

interface AgentMemoryLike {
  appendMessage(input: {
    conversationId: string;
    role: 'assistant' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<string>;
  getMessages(input: {
    conversationId: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<MemoryMessage[]>;
  deleteMessage?(input: { conversationId: string; messageId: string }): Promise<void>;
}

export function getStore(context: CloudFunctionContext): AgentMemoryLike | null {
  // cloud-functions access: context.agent!.store
  const store = context?.agent?.store;
  if (!store || typeof store.getMessages !== 'function') return null;
  return store;
}

function parseReportMessage(message: MemoryMessage): TrendReport | null {
  if (message.metadata?.kind !== REPORT_KIND) return null;
  const content = message.content;
  if (typeof content === 'object' && content !== null) return content as TrendReport;
  try {
    const parsed = JSON.parse(String(content));
    return parsed && typeof parsed === 'object' ? parsed as TrendReport : null;
  } catch {
    return null;
  }
}

function withStorageMarker(report: TrendReport): TrendReport {
  return { ...report, storage: 'memory' };
}

function toHistoryEntry(report: TrendReport): HistoryEntry {
  return {
    runId: report.runId,
    status: report.status,
    trigger: report.trigger,
    generatedAt: report.generatedAt,
    itemCount: report.itemCount,
    newItemCount: report.newItemCount,
    reusedItemCount: report.reusedItemCount,
    summary: report.summary,
    error: report.error,
    storage: report.storage ?? 'memory',
  };
}

async function loadReports(store: AgentMemoryLike, limit = 30): Promise<TrendReport[]> {
  const messages = await store.getMessages({
    conversationId: REPORT_CONVERSATION_ID,
    limit: Math.min(limit, 100),
    order: 'desc',
  });
  const seen = new Set<string>();
  const reports: TrendReport[] = [];
  for (const message of messages) {
    const report = parseReportMessage(message);
    if (!report) continue;
    if (report.runId && seen.has(report.runId)) continue;
    if (report.runId) seen.add(report.runId);
    reports.push(withStorageMarker(report));
  }
  return reports;
}

export async function loadLatestReport(store: AgentMemoryLike): Promise<TrendReport | null> {
  const reports = await loadReports(store, 1);
  return reports[0] ?? null;
}

export async function loadHistory(store: AgentMemoryLike): Promise<HistoryEntry[]> {
  const reports = await loadReports(store, 30);
  return reports.map(toHistoryEntry);
}

export async function loadReportByRunId(store: AgentMemoryLike, runId: string): Promise<TrendReport | null> {
  const reports = await loadReports(store, 100);
  return reports.find(r => r.runId === runId) ?? null;
}

export async function deleteReport(store: AgentMemoryLike, runId: string): Promise<boolean> {
  if (typeof store.deleteMessage !== 'function') return false;
  const messages = await store.getMessages({
    conversationId: REPORT_CONVERSATION_ID,
    limit: 100,
    order: 'desc',
  });
  for (const message of messages) {
    if (message.metadata?.kind !== REPORT_KIND) continue;
    if (message.metadata?.runId !== runId) continue;
    if (!message.messageId) continue;
    await store.deleteMessage({ conversationId: REPORT_CONVERSATION_ID, messageId: message.messageId });
    return true;
  }
  return false;
}
