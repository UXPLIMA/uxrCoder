import { createHash } from 'crypto';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';

export type VisualBaselineMode = 'assert' | 'record' | 'assert_or_record';

export interface VisualBaselineComparison {
    key: string;
    mode: VisualBaselineMode;
    baselineFound: boolean;
    matched: boolean | null;
    baselinePath: string | null;
    artifactHash: string;
    baselineHash: string | null;
    updatedBaseline: boolean;
    reason?: string;
}

export interface EvaluateVisualBaselineInput {
    key: string;
    mode: VisualBaselineMode;
    allowMissingBaseline: boolean;
    mimeType: string;
    base64Data: string;
}

export interface EvaluateVisualBaselineResult {
    comparison: VisualBaselineComparison;
    shouldFail: boolean;
    failureMessage?: string;
}

interface ExistingBaseline {
    path: string;
    relativePath: string;
    bytes: Buffer;
    hash: string;
}

const BASELINE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bin'];

export class AgentVisualBaselineStore {
    private readonly baselineRootDir: string;

    constructor(workspacePath: string) {
        this.baselineRootDir = path.join(workspacePath, '.uxr-tests', 'baselines');
    }

    async evaluateBase64Artifact(input: EvaluateVisualBaselineInput): Promise<EvaluateVisualBaselineResult> {
        const normalizedKey = this.sanitizeKey(input.key);
        const normalizedMode = this.normalizeMode(input.mode);
        const targetExtension = this.extensionForMimeType(input.mimeType);
        const artifactBytes = this.decodeBase64(input.base64Data);
        const artifactHash = this.hashBytes(artifactBytes);
        const baseline = await this.readExistingBaseline(normalizedKey);

        const comparison: VisualBaselineComparison = {
            key: normalizedKey,
            mode: normalizedMode,
            baselineFound: baseline !== null,
            matched: null,
            baselinePath: baseline ? baseline.relativePath : null,
            artifactHash,
            baselineHash: baseline ? baseline.hash : null,
            updatedBaseline: false,
        };

        if (normalizedMode === 'record') {
            const persisted = await this.writeBaseline(normalizedKey, targetExtension, artifactBytes, baseline?.path);
            comparison.updatedBaseline = true;
            comparison.matched = true;
            comparison.baselinePath = persisted.relativePath;
            comparison.baselineHash = artifactHash;
            return { comparison, shouldFail: false };
        }

        if (!baseline) {
            if (normalizedMode === 'assert_or_record') {
                const persisted = await this.writeBaseline(normalizedKey, targetExtension, artifactBytes, null);
                comparison.updatedBaseline = true;
                comparison.matched = true;
                comparison.baselinePath = persisted.relativePath;
                comparison.baselineHash = artifactHash;
                comparison.reason = 'baseline_recorded';
                return { comparison, shouldFail: false };
            }

            if (input.allowMissingBaseline) {
                comparison.reason = 'baseline_missing_allowed';
                return { comparison, shouldFail: false };
            }

            comparison.reason = 'baseline_missing';
            return {
                comparison,
                shouldFail: true,
                failureMessage: `Visual baseline '${normalizedKey}' is missing`,
            };
        }

        const matched = baseline.hash === artifactHash;
        comparison.matched = matched;
        comparison.baselinePath = baseline.relativePath;
        comparison.baselineHash = baseline.hash;
        comparison.reason = matched ? 'baseline_match' : 'baseline_mismatch';

        if (!matched) {
            return {
                comparison,
                shouldFail: true,
                failureMessage: `Visual baseline mismatch for '${normalizedKey}'`,
            };
        }

        return { comparison, shouldFail: false };
    }

    private normalizeMode(mode: VisualBaselineMode): VisualBaselineMode {
        if (mode === 'record' || mode === 'assert_or_record') {
            return mode;
        }
        return 'assert';
    }

    private sanitizeKey(key: string): string {
        const raw = typeof key === 'string' ? key.trim() : '';
        const sanitized = raw
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '')
            .slice(0, 96);

        if (sanitized.length === 0) {
            throw new Error('Visual baseline key is empty after sanitization');
        }

        return sanitized;
    }

    private extensionForMimeType(mimeType: string): string {
        const normalized = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
        if (normalized === 'image/png') return 'png';
        if (normalized === 'image/jpeg') return 'jpg';
        if (normalized === 'image/jpg') return 'jpg';
        if (normalized === 'image/webp') return 'webp';
        if (normalized === 'image/gif') return 'gif';
        return 'bin';
    }

    private decodeBase64(base64Data: string): Buffer {
        if (typeof base64Data !== 'string' || base64Data.length === 0) {
            throw new Error('Visual baseline artifact payload is empty');
        }

        const normalized = base64Data.replace(/\s+/g, '');
        const bytes = Buffer.from(normalized, 'base64');
        if (bytes.length === 0) {
            throw new Error('Visual baseline artifact payload is not valid base64');
        }
        return bytes;
    }

    private hashBytes(bytes: Buffer): string {
        return createHash('sha256').update(bytes).digest('hex');
    }

    private baselineFilePath(key: string, extension: string): string {
        return path.join(this.baselineRootDir, `${key}.${extension}`);
    }

    private async readExistingBaseline(key: string): Promise<ExistingBaseline | null> {
        for (const extension of BASELINE_EXTENSIONS) {
            const fullPath = this.baselineFilePath(key, extension);
            try {
                const bytes = await readFile(fullPath);
                const relativePath = path.posix.join('.uxr-tests', 'baselines', path.basename(fullPath));
                return {
                    path: fullPath,
                    relativePath,
                    bytes,
                    hash: this.hashBytes(bytes),
                };
            } catch {
                // try next extension
            }
        }
        return null;
    }

    private async writeBaseline(
        key: string,
        extension: string,
        bytes: Buffer,
        previousPath: string | undefined,
    ): Promise<{ path: string; relativePath: string }> {
        await mkdir(this.baselineRootDir, { recursive: true });
        const targetPath = this.baselineFilePath(key, extension);
        await writeFile(targetPath, bytes);

        if (previousPath && previousPath !== targetPath) {
            try {
                await unlink(previousPath);
            } catch {
                // best effort cleanup for old extension
            }
        }

        return {
            path: targetPath,
            relativePath: path.posix.join('.uxr-tests', 'baselines', path.basename(targetPath)),
        };
    }
}
