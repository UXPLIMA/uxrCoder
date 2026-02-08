import path from 'path';
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import type { AgentTestRun } from './agentTestManager';

export interface AgentTestEventRecord {
    runId: string;
    event: string;
    timestamp: number;
    message?: string;
    result?: Record<string, unknown>;
}

export interface AgentTestArtifactFile {
    name: string;
    size: number;
    modifiedAt: number;
}

export interface AgentTestReportSummary {
    finalStatus: AgentTestRun['status'];
    attemptsUsed: number;
    maxAttempts: number;
    retryCount: number;
    totalLogs: number;
    totalSteps: number;
    stepsExecuted: number;
    assertionsPassed: number;
    assertionsFailed: number;
    durationMs: number | null;
    failureStep: number | null;
    failureStepType: string | null;
}

export interface StoredAgentTestReport {
    version: 1;
    generatedAt: number;
    summary: AgentTestReportSummary;
    run: AgentTestRun;
}

export class AgentTestArtifactStore {
    private readonly rootDir: string;

    constructor(workspacePath: string) {
        this.rootDir = path.join(workspacePath, '.uxr-tests');
    }

    getRunRelativeDir(runId: string): string {
        this.validateRunId(runId);
        return path.posix.join('.uxr-tests', runId);
    }

    async recordEvent(event: AgentTestEventRecord): Promise<void> {
        const runDir = await this.ensureRunDir(event.runId);
        const eventLine = JSON.stringify(event) + '\n';
        await appendFile(path.join(runDir, 'events.jsonl'), eventLine, 'utf8');
    }

    async writeReport(run: AgentTestRun): Promise<void> {
        const runDir = await this.ensureRunDir(run.id);
        const report: StoredAgentTestReport = {
            version: 1,
            generatedAt: Date.now(),
            summary: this.buildSummary(run),
            run,
        };
        await writeFile(
            path.join(runDir, 'report.json'),
            JSON.stringify(report, null, 2),
            'utf8',
        );
    }

    async writeJsonArtifact(
        runId: string,
        label: string,
        payload: Record<string, unknown>,
    ): Promise<string> {
        const runDir = await this.ensureRunDir(runId);
        const normalizedLabel = this.sanitizeLabel(label);
        const fileName = `${Date.now()}-${normalizedLabel}.json`;
        await writeFile(
            path.join(runDir, fileName),
            JSON.stringify(payload, null, 2),
            'utf8',
        );
        return fileName;
    }

    async writeBinaryArtifact(
        runId: string,
        label: string,
        mimeType: string,
        base64Data: string,
    ): Promise<string> {
        if (typeof base64Data !== 'string' || base64Data.length === 0) {
            throw new Error('Binary artifact payload is empty');
        }

        const runDir = await this.ensureRunDir(runId);
        const normalizedLabel = this.sanitizeLabel(label);
        const extension = this.extensionForMimeType(mimeType);
        const fileName = `${Date.now()}-${normalizedLabel}.${extension}`;

        const normalizedBase64 = base64Data.replace(/\s+/g, '');
        const bytes = Buffer.from(normalizedBase64, 'base64');
        if (bytes.length === 0) {
            throw new Error('Binary artifact payload is not valid base64');
        }

        await writeFile(path.join(runDir, fileName), bytes);
        return fileName;
    }

    async readReport(runId: string): Promise<StoredAgentTestReport | null> {
        const runDir = this.resolveRunDir(runId);
        const reportPath = path.join(runDir, 'report.json');
        try {
            const content = await readFile(reportPath, 'utf8');
            const parsed = JSON.parse(content) as StoredAgentTestReport;
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    async listArtifacts(runId: string): Promise<AgentTestArtifactFile[]> {
        const runDir = this.resolveRunDir(runId);
        try {
            const names = await readdir(runDir);
            const files: AgentTestArtifactFile[] = [];
            for (const name of names) {
                const fullPath = path.join(runDir, name);
                const fileStat = await stat(fullPath);
                if (fileStat.isFile()) {
                    files.push({
                        name,
                        size: fileStat.size,
                        modifiedAt: fileStat.mtimeMs,
                    });
                }
            }
            return files.sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            return [];
        }
    }

    private async ensureRunDir(runId: string): Promise<string> {
        const runDir = this.resolveRunDir(runId);
        await mkdir(runDir, { recursive: true });
        return runDir;
    }

    private resolveRunDir(runId: string): string {
        this.validateRunId(runId);
        return path.join(this.rootDir, runId);
    }

    private validateRunId(runId: string): void {
        if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
            throw new Error(`Invalid run id: ${runId}`);
        }
    }

    private sanitizeLabel(label: string): string {
        const raw = typeof label === 'string' ? label : 'artifact';
        const cleaned = raw
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
        return cleaned.length > 0 ? cleaned.slice(0, 48) : 'artifact';
    }

    private extensionForMimeType(mimeType: string): string {
        const normalized = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
        if (normalized === 'image/png') return 'png';
        if (normalized === 'image/jpeg') return 'jpg';
        if (normalized === 'image/webp') return 'webp';
        if (normalized === 'image/gif') return 'gif';
        if (normalized === 'application/json') return 'json';
        return 'bin';
    }

    private toNumber(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        return null;
    }

    private toInteger(value: unknown): number {
        const parsed = this.toNumber(value);
        if (parsed === null) {
            return 0;
        }
        return Math.max(0, Math.floor(parsed));
    }

    private buildSummary(run: AgentTestRun): AgentTestReportSummary {
        const result = (
            run.result
            && typeof run.result === 'object'
            && !Array.isArray(run.result)
        ) ? run.result as Record<string, unknown> : null;

        const scenario = (
            run.scenario
            && typeof run.scenario === 'object'
            && !Array.isArray(run.scenario)
        ) ? run.scenario as Record<string, unknown> : null;

        const steps = Array.isArray(scenario?.steps) ? scenario?.steps : [];
        const durationFromResult = this.toNumber(result?.durationMs);
        const durationFromTimestamps = (
            typeof run.startedAt === 'number'
            && typeof run.finishedAt === 'number'
            && run.finishedAt >= run.startedAt
        ) ? run.finishedAt - run.startedAt : null;

        const failureStepRaw = this.toNumber(result?.step);
        const failureStep = failureStepRaw !== null ? Math.floor(failureStepRaw) : null;

        return {
            finalStatus: run.status,
            attemptsUsed: Math.max(run.attempt, 0),
            maxAttempts: Math.max(run.maxRetries + 1, 1),
            retryCount: Math.max(run.attempt - 1, 0),
            totalLogs: run.logs.length,
            totalSteps: steps.length,
            stepsExecuted: this.toInteger(result?.stepsExecuted),
            assertionsPassed: this.toInteger(result?.assertionsPassed),
            assertionsFailed: this.toInteger(result?.assertionsFailed),
            durationMs: durationFromResult ?? durationFromTimestamps,
            failureStep,
            failureStepType: typeof result?.stepType === 'string' ? result.stepType : null,
        };
    }
}
