import type { AgentCommand, AgentCommandResult, AgentConflictPayload } from './types';

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function getExpectedRefs(command: AgentCommand): Record<string, unknown> {
    const expected: Record<string, unknown> = { op: command.op };
    const mapIfString = (key: string, value: unknown) => {
        if (typeof value === 'string' && value.length > 0) {
            expected[key] = value;
        }
    };
    const mapIfPath = (key: string, value: unknown) => {
        if (isStringArray(value)) {
            expected[key] = value;
        }
    };

    mapIfString('targetId', (command as { targetId?: string }).targetId);
    mapIfPath('targetPath', (command as { targetPath?: string[] }).targetPath);
    mapIfString('parentId', (command as { parentId?: string }).parentId);
    mapIfPath('parentPath', (command as { parentPath?: string[] }).parentPath);
    mapIfString('newParentId', (command as { newParentId?: string }).newParentId);
    mapIfPath('newParentPath', (command as { newParentPath?: string[] }).newParentPath);
    mapIfString('property', (command as { property?: string }).property);
    mapIfString('name', (command as { name?: string }).name);

    return expected;
}

export function buildConflict(
    reason: AgentConflictPayload['reason'],
    command: AgentCommand,
    actual?: Record<string, unknown>,
): AgentConflictPayload {
    return {
        reason,
        expected: getExpectedRefs(command),
        actual,
    };
}

export function statusForAgentResult(result: AgentCommandResult): number {
    if (result.success) {
        return 200;
    }

    if (result.conflict?.reason === 'locked') {
        return 423;
    }

    if (result.conflict?.reason === 'not_found') {
        return 404;
    }

    if (result.conflict?.reason === 'revision_mismatch') {
        return 409;
    }

    return 400;
}
