/**
 * GET /ai-trends/health — Cloud Function
 * Simple health check endpoint.
 */

import type { CloudFunctionContext } from '@edgeone/types';
import { jsonResponse } from '../../_http';

export async function onRequestGet(context: CloudFunctionContext): Promise<Response> {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
