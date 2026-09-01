import type { AgentContext } from '@edgeone/types';
import { randomUUID } from 'node:crypto';

import { getBody, getEnv, jsonResponse } from './_http.js';
import { mergeItemLibrary, type TrendLibraryItem } from './_items.js';
import { loadItemsFromMemory, saveItemsToMemory, saveReportToMemory } from './_memory.js';
import { runAgentPipeline } from './_model.js';
import type { PipelineEmit } from './_model.js';
import { generateFallbackReport, utcNow } from './_report.js';
import { collectSources } from './_sources.js';
import { loadItemLibrary, saveItemLibrary, saveReport } from './_storage.js';
import type { TrendReport } from './_types.js';

export async function onRequest(context: AgentContext): Promise<Response> {
  const body = getBody(context);
  const runId = context?.run_id || `run_${randomUUID().slice(0, 12)}`;
  const trigger = body._schedule ? 'schedule' : body.trigger || 'manual';
  const sources = Array.isArray(body.sources) ? body.sources : ['hackernews', 'devto', 'web'];
  const limit = Number(body.limit || 30);
  const started = Date.now();
  const signal = context?.request?.signal as AbortSignal | undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: PipelineEmit) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* stream may be closed */ }
      };

      try {
        // ── Check abort before starting ──
        if (signal?.aborted) {
          emit({ stage: 'complete', status: 'done', report: generateFallbackReport([], runId, trigger), stopped: true });
          return;
        }

        // ── Fetch & Merge ──
        emit({ stage: 'fetch', status: 'running' });
        const sandbox = context?.sandbox ?? null;
        console.log(`[run] sandbox available: ${!!sandbox}, sources: ${JSON.stringify(sources)}`);
        const candidates = await collectSources(sources, limit, sandbox);
        // Log source breakdown
        const sourceCounts = candidates.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
        console.log(`[run] candidates by source:`, sourceCounts);

        const memoryItems = await loadItemsFromMemory(context).catch(() => []) as TrendLibraryItem[];
        const existingItems = memoryItems.length ? memoryItems : await loadItemLibrary<TrendLibraryItem>();
        const mergeResult = mergeItemLibrary(existingItems, candidates, new Date().toISOString(), limit);

        const reportSourceCounts = mergeResult.reportItems.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
        console.log(`[run] reportItems by source:`, reportSourceCounts);

        const noNewItems = mergeResult.newItems.length === 0;
        emit({ stage: 'fetch', status: 'done', duration: +((Date.now() - started) / 1000).toFixed(1), detail: `${candidates.length} items` });
        // Phase 1 of progressive content: emit the merged candidate set so the
        // frontend can render a grayed-out preview of all items considered for
        // this run before Curator filters them.
        emit({ type: 'items', phase: 'fetched', items: mergeResult.reportItems });

        // ── 4-Agent Pipeline (with SSE progress) ──
        const { report } = await runAgentPipeline({
          items: mergeResult.reportItems,
          historyItems: existingItems,
          runId,
          trigger,
          env: getEnv(context),
          noNewItems,
          onProgress: emit,
          sandbox: sandbox ?? undefined,
          signal,
        });

        // ── Metadata ──
        report.durationMs = Date.now() - started;
        report.sources = sources;
        report.schedule = body._schedule;
        report.newItemCount = mergeResult.newItemCount;
        report.reusedItemCount = mergeResult.reusedItemCount;
        report.noNewItems = noNewItems;
        if (!report.items?.length) report.items = mergeResult.reportItems;

        // ── Persist ──
        const savedToMemory = await saveReportToMemory(context, report).catch(() => false);
        const savedItemsToMemory = await saveItemsToMemory(context, mergeResult.items).catch(() => false);
        if (!savedItemsToMemory) await saveItemLibrary(mergeResult.items);
        report.storage = savedToMemory ? 'memory' : 'file-fallback';
        if (!savedToMemory) await saveReport(report);

        // ── Final event with complete report ──
        emit({ stage: 'complete', status: 'done', report });

      } catch (error) {
        // ── User-initiated abort — clean exit, no error report ──
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          console.log('[run] Pipeline aborted by user');
          emit({ stage: 'complete', status: 'done', stopped: true });
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        emit({ stage: 'error', status: 'failed', detail: message });

        const failed = generateFallbackReport([], runId, trigger);
        failed.status = 'failed';
        failed.generatedAt = utcNow();
        failed.durationMs = Date.now() - started;
        failed.summary = '生成失败';
        failed.reportMarkdown = `# AI 趋势日报\n\n生成失败：${message}`;
        failed.error = message;
        const savedToMemory = await saveReportToMemory(context, failed).catch(() => false);
        if (!savedToMemory) await saveReport(failed);

        emit({ stage: 'complete', status: 'failed', report: failed });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
