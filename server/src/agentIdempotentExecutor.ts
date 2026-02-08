import type { AgentCachedResponse } from './agentIdempotencyCache';

export interface AgentIdempotentExecutionOutcome<TBody = unknown> {
    status: number;
    body: TBody;
}

export interface AgentIdempotentExecutionResult<TBody = unknown> extends AgentIdempotentExecutionOutcome<TBody> {
    cached: boolean;
}

export function executeIdempotentRequest<TBody = unknown>(params: {
    idempotencyKey: string | null;
    getCached: (key: string | null) => AgentCachedResponse | null;
    cache: (key: string | null, status: number, body: TBody) => void;
    execute: () => AgentIdempotentExecutionOutcome<TBody>;
}): AgentIdempotentExecutionResult<TBody> {
    const cached = params.getCached(params.idempotencyKey);
    if (cached) {
        return {
            status: cached.status,
            body: cached.body as TBody,
            cached: true,
        };
    }

    const outcome = params.execute();
    params.cache(params.idempotencyKey, outcome.status, outcome.body);
    return {
        ...outcome,
        cached: false,
    };
}
