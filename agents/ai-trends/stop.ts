/**
 * Stop handler — EdgeOne Makers Functions
 * ========================================
 *
 * Aborts the active agent run for the given conversationId.
 * The runtime sets the AbortSignal on the target conversation,
 * which breaks the for-await loops in _model.ts and releases
 * the upstream LLM connections.
 *
 * IMPORTANT: The stop request must NOT carry the same
 * `makers-conversation-id` header as the run request,
 * otherwise the runtime overwrites the run's signal.
 * The target conversation_id is passed only via request body.
 */

import type { AgentContext } from '@edgeone/types';
import { getBody, jsonResponse } from './_http.js';

export async function onRequest(context: AgentContext): Promise<Response> {
  const body = getBody(context);
  const conversationId = body.conversationId || body.conversation_id;

  console.log('[stop] conversationId:', conversationId);

  if (!conversationId) {
    return jsonResponse({ status: 'error', error: 'Missing conversation_id' }, 400);
  }

  // EdgeOne runtime exposes abortActiveRun under context.utils
  const aborter = context?.utils?.abortActiveRun ?? context?.abortActiveRun;
  if (typeof aborter === 'function') {
    const ret = aborter(conversationId);
    console.log('[stop] abortActiveRun result:', ret);
    return jsonResponse({
      status: ret?.aborted ? 'aborting' : 'idle',
      conversationId,
      ...ret,
    });
  }

  console.warn('[stop] abortActiveRun not available on context');
  return jsonResponse({ status: 'idle', conversationId, aborted: false });
}
