import { describe, expect, it } from 'vitest';
import { buildConflict, getExpectedRefs, statusForAgentResult } from '../src/agentCommandResponse';
import type { AgentCommandResult } from '../src/types';

describe('agentCommandResponse conflict/status matrix', () => {
    it('builds deterministic expected refs for create and reparent commands', () => {
        const createExpected = getExpectedRefs({
            op: 'create',
            parentPath: ['Workspace'],
            className: 'Folder',
            name: 'Tools',
        });
        expect(createExpected).toEqual({
            op: 'create',
            parentPath: ['Workspace'],
            name: 'Tools',
        });

        const reparentExpected = getExpectedRefs({
            op: 'reparent',
            targetId: 'target-1',
            newParentPath: ['Workspace', 'FolderB'],
        });
        expect(reparentExpected).toEqual({
            op: 'reparent',
            targetId: 'target-1',
            newParentPath: ['Workspace', 'FolderB'],
        });
    });

    it('includes expected and actual payload in conflict body', () => {
        const command = {
            op: 'update',
            targetPath: ['Workspace', 'Part'],
            property: 'Anchored',
            value: true,
        };

        const conflict = buildConflict('validation_failed', command, {
            field: 'value',
            reason: 'type_mismatch',
        });

        expect(conflict).toEqual({
            reason: 'validation_failed',
            expected: {
                op: 'update',
                targetPath: ['Workspace', 'Part'],
                property: 'Anchored',
            },
            actual: {
                field: 'value',
                reason: 'type_mismatch',
            },
        });
    });

    it('maps result status by conflict reason deterministically', () => {
        const success: AgentCommandResult = {
            index: 0,
            op: 'create',
            success: true,
        };

        const locked: AgentCommandResult = {
            index: 0,
            op: 'update',
            success: false,
            conflict: {
                reason: 'locked',
                expected: {},
            },
        };

        const notFound: AgentCommandResult = {
            index: 0,
            op: 'delete',
            success: false,
            conflict: {
                reason: 'not_found',
                expected: {},
            },
        };

        const revisionMismatch: AgentCommandResult = {
            index: 0,
            op: 'rename',
            success: false,
            conflict: {
                reason: 'revision_mismatch',
                expected: {},
            },
        };

        const validation: AgentCommandResult = {
            index: 0,
            op: 'update',
            success: false,
            conflict: {
                reason: 'validation_failed',
                expected: {},
            },
        };

        expect(statusForAgentResult(success)).toBe(200);
        expect(statusForAgentResult(locked)).toBe(423);
        expect(statusForAgentResult(notFound)).toBe(404);
        expect(statusForAgentResult(revisionMismatch)).toBe(409);
        expect(statusForAgentResult(validation)).toBe(400);
    });
});
