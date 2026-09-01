/**
 * POST /ai-trends/detail — Cloud Function
 * Returns a specific report by runId.
 */

import type { CloudFunctionContext } from '@edgeone/types';
import { jsonResponse, readJsonBody } from '../../_http';
import { getStore, loadReportByRunId } from '../../_store';

export async function onRequestPost(context: CloudFunctionContext): Promise<Response> {
  const body = await readJsonBody(context);
  const runId = (body.runId || body.run_id) as string | undefined;
  if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

  const store = getStore(context);
  if (store) {
    const report = await loadReportByRunId(store, runId);
    if (report) return jsonResponse(report);
  }
  return jsonResponse({ error: 'report not found' }, 404);
}
