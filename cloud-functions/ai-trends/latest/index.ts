/**
 * GET /ai-trends/latest — Cloud Function
 * Returns the latest generated report.
 */

import type { CloudFunctionContext } from '@edgeone/types';
import { jsonResponse } from '../../_http';
import { getStore, loadLatestReport } from '../../_store';

export async function onRequestGet(context: CloudFunctionContext): Promise<Response> {
  const store = getStore(context);
  if (store) {
    const report = await loadLatestReport(store);
    if (report) return jsonResponse(report);
  }
  return jsonResponse({
    status: 'empty',
    summary: '还没有生成过 AI 趋势报告。',
    reportMarkdown: '# AI 趋势日报\n\n还没有生成过报告，点击"手动生成"开始。',
    trends: [],
    items: [],
  });
}
