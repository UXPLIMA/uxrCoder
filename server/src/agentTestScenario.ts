export interface AgentTestSafetySettings {
    timeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    retryBackoffFactor: number;
    maxRetryDelayMs: number;
    allowDestructiveActions: boolean;
    maxSteps: number;
    maxWaitSecondsPerStep: number;
}

export interface AgentTestRuntimeSettings {
    mode: 'none' | 'run' | 'play';
    stopOnFinish: boolean;
}

export interface AgentTestIsolationSettings {
    enabled: boolean;
    suppressSyncChanges: boolean;
    cleanupCreatedInstances: boolean;
    restoreDestroyedInstances: boolean;
    restorePropertyChanges: boolean;
    skipDestroyedRuntimeOwned: boolean;
    allowSnapshotRestoreForNonCloneable: boolean;
    ignoreMissingDestroyedRestoreParent: boolean;
    skipDestroyedRestoreClasses: string[];
}

export interface NormalizedAgentTestScenario extends Record<string, unknown> {
    steps: Record<string, unknown>[];
    safety: AgentTestSafetySettings;
    runtime: AgentTestRuntimeSettings;
    isolation: AgentTestIsolationSettings;
}

type NormalizeScenarioResult =
    | { ok: true; scenario: NormalizedAgentTestScenario }
    | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 1500;
const DEFAULT_RETRY_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_RETRY_DELAY_MS = 30000;
const DEFAULT_ALLOW_DESTRUCTIVE = false;
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_MAX_WAIT_SECONDS_PER_STEP = 30;
const DEFAULT_ISOLATION_ENABLED = true;
const DEFAULT_SKIP_DESTROYED_RUNTIME_OWNED = true;
const DEFAULT_ALLOW_SNAPSHOT_RESTORE_FOR_NON_CLONEABLE = true;
const DEFAULT_IGNORE_MISSING_DESTROYED_RESTORE_PARENT = true;

const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 900000;
const MAX_RETRIES_LIMIT = 5;
const MIN_RETRY_DELAY_MS = 0;
const MAX_RETRY_DELAY_MS = 600000;
const MIN_RETRY_BACKOFF_FACTOR = 1;
const MAX_RETRY_BACKOFF_FACTOR = 8;
const MAX_MAX_RETRY_DELAY_MS = 3600000;
const MIN_MAX_STEPS = 1;
const MAX_MAX_STEPS = 1000;
const MIN_MAX_WAIT_PER_STEP = 0.1;
const MAX_MAX_WAIT_PER_STEP = 300;

const DESTRUCTIVE_STEP_TYPES = new Set([
    'setProperty',
    'createInstance',
    'destroyInstance',
    'renameInstance',
    'reparentInstance',
]);

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.floor(value), min), max);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(value, min), max);
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') {
            continue;
        }
        const trimmed = item.trim();
        if (trimmed.length === 0 || trimmed.length > maxLength || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
        if (normalized.length >= maxItems) {
            break;
        }
    }

    return normalized;
}

function normalizeRuntime(raw: Record<string, unknown> | null): AgentTestRuntimeSettings {
    const rawMode = typeof raw?.mode === 'string' ? raw.mode.toLowerCase() : 'play';
    const normalizedMode = rawMode === 'server' ? 'run' : rawMode;
    const mode: AgentTestRuntimeSettings['mode'] =
        normalizedMode === 'run' || normalizedMode === 'play' ? normalizedMode : 'none';

    const stopOnFinish = raw?.stopOnFinish !== false;
    return { mode, stopOnFinish };
}

function normalizeIsolation(raw: Record<string, unknown> | null): AgentTestIsolationSettings {
    const enabled = raw?.enabled !== false
        && raw?.revertChanges !== false
        && raw?.cleanupMutations !== false
        && DEFAULT_ISOLATION_ENABLED;

    if (!enabled) {
        return {
            enabled: false,
            suppressSyncChanges: false,
            cleanupCreatedInstances: false,
            restoreDestroyedInstances: false,
            restorePropertyChanges: false,
            skipDestroyedRuntimeOwned: false,
            allowSnapshotRestoreForNonCloneable: false,
            ignoreMissingDestroyedRestoreParent: false,
            skipDestroyedRestoreClasses: [],
        };
    }

    const skipDestroyedRestoreClasses = normalizeStringList(
        raw?.skipDestroyedRestoreClasses ?? raw?.skipRestoreClassNames,
        50,
        80,
    );

    return {
        enabled: true,
        suppressSyncChanges: raw?.suppressSyncChanges !== false,
        cleanupCreatedInstances: raw?.cleanupCreatedInstances !== false,
        restoreDestroyedInstances: raw?.restoreDestroyedInstances !== false,
        restorePropertyChanges: raw?.restorePropertyChanges !== false,
        skipDestroyedRuntimeOwned: raw?.skipDestroyedRuntimeOwned !== false
            && DEFAULT_SKIP_DESTROYED_RUNTIME_OWNED,
        allowSnapshotRestoreForNonCloneable: raw?.allowSnapshotRestoreForNonCloneable !== false
            && DEFAULT_ALLOW_SNAPSHOT_RESTORE_FOR_NON_CLONEABLE,
        ignoreMissingDestroyedRestoreParent: raw?.ignoreMissingDestroyedRestoreParent !== false
            && DEFAULT_IGNORE_MISSING_DESTROYED_RESTORE_PARENT,
        skipDestroyedRestoreClasses,
    };
}

export function normalizeAgentTestScenario(input: unknown): NormalizeScenarioResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, error: 'Scenario must be an object' };
    }

    const rawScenario = input as Record<string, unknown>;
    const rawSteps = rawScenario.steps;
    if (!Array.isArray(rawSteps)) {
        return { ok: false, error: 'Scenario must include steps array' };
    }

    const safetyRaw = (
        rawScenario.safety
        && typeof rawScenario.safety === 'object'
        && !Array.isArray(rawScenario.safety)
    ) ? rawScenario.safety as Record<string, unknown> : null;

    const safety: AgentTestSafetySettings = {
        timeoutMs: clampInt(safetyRaw?.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
        maxRetries: clampInt(safetyRaw?.maxRetries, DEFAULT_MAX_RETRIES, 0, MAX_RETRIES_LIMIT),
        retryDelayMs: clampInt(
            safetyRaw?.retryDelayMs,
            DEFAULT_RETRY_DELAY_MS,
            MIN_RETRY_DELAY_MS,
            MAX_RETRY_DELAY_MS,
        ),
        retryBackoffFactor: clampNumber(
            safetyRaw?.retryBackoffFactor,
            DEFAULT_RETRY_BACKOFF_FACTOR,
            MIN_RETRY_BACKOFF_FACTOR,
            MAX_RETRY_BACKOFF_FACTOR,
        ),
        maxRetryDelayMs: clampInt(
            safetyRaw?.maxRetryDelayMs,
            DEFAULT_MAX_RETRY_DELAY_MS,
            MIN_RETRY_DELAY_MS,
            MAX_MAX_RETRY_DELAY_MS,
        ),
        allowDestructiveActions: safetyRaw?.allowDestructiveActions === true || DEFAULT_ALLOW_DESTRUCTIVE,
        maxSteps: clampInt(safetyRaw?.maxSteps, DEFAULT_MAX_STEPS, MIN_MAX_STEPS, MAX_MAX_STEPS),
        maxWaitSecondsPerStep: clampNumber(
            safetyRaw?.maxWaitSecondsPerStep,
            DEFAULT_MAX_WAIT_SECONDS_PER_STEP,
            MIN_MAX_WAIT_PER_STEP,
            MAX_MAX_WAIT_PER_STEP,
        ),
    };

    if (rawSteps.length === 0) {
        return { ok: false, error: 'Scenario must include at least one step' };
    }
    if (rawSteps.length > safety.maxSteps) {
        return {
            ok: false,
            error: `Scenario has ${rawSteps.length} steps, exceeding safety.maxSteps (${safety.maxSteps})`,
        };
    }

    const normalizedSteps: Record<string, unknown>[] = [];
    for (let i = 0; i < rawSteps.length; i++) {
        const step = rawSteps[i];
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
            return { ok: false, error: `Step ${i + 1} is not an object` };
        }

        const parsed = step as Record<string, unknown>;
        const stepType = typeof parsed.type === 'string' ? parsed.type : '';
        if (!stepType) {
            return { ok: false, error: `Step ${i + 1} is missing type` };
        }

        const harnessMarkedDestructive = stepType === 'harnessAction' && parsed.destructive === true;
        if (!safety.allowDestructiveActions && (DESTRUCTIVE_STEP_TYPES.has(stepType) || harnessMarkedDestructive)) {
            return {
                ok: false,
                error: `Step ${i + 1} (${stepType}) requires safety.allowDestructiveActions=true`,
            };
        }

        normalizedSteps.push(parsed);
    }

    const runtimeRaw = (
        rawScenario.runtime
        && typeof rawScenario.runtime === 'object'
        && !Array.isArray(rawScenario.runtime)
    ) ? rawScenario.runtime as Record<string, unknown> : null;

    const runtime = normalizeRuntime(runtimeRaw);
    const isolationRaw = (
        rawScenario.isolation
        && typeof rawScenario.isolation === 'object'
        && !Array.isArray(rawScenario.isolation)
    ) ? rawScenario.isolation as Record<string, unknown> : null;
    const isolation = normalizeIsolation(isolationRaw);
    const scenario: NormalizedAgentTestScenario = {
        ...rawScenario,
        steps: normalizedSteps,
        safety,
        runtime,
        isolation,
    };

    return { ok: true, scenario };
}
