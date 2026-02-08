import type { AgentPropertySchemaResponse, AgentSnapshotResponse, RobloxInstance } from './types';

type IndexedInstance = { path: string[]; instance: RobloxInstance };

interface AgentDerivedCacheDeps {
    getRevision: () => number;
    getIndexedInstances: () => IndexedInstance[];
    buildSnapshot: (
        indexed: IndexedInstance[],
        revision: number,
        generatedAt: number,
    ) => AgentSnapshotResponse;
    buildSchema: (
        indexed: IndexedInstance[],
        revision: number,
        classNameFilter?: string,
    ) => AgentPropertySchemaResponse;
    now?: () => number;
}

interface AgentDerivedCacheState {
    revision: number | null;
    indexed: IndexedInstance[] | null;
    snapshot: AgentSnapshotResponse | null;
    schemaAll: AgentPropertySchemaResponse | null;
    schemaByClass: Map<string, AgentPropertySchemaResponse>;
}

export class AgentDerivedCache {
    private readonly now: () => number;
    private readonly state: AgentDerivedCacheState;

    constructor(private readonly deps: AgentDerivedCacheDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.state = {
            revision: null,
            indexed: null,
            snapshot: null,
            schemaAll: null,
            schemaByClass: new Map<string, AgentPropertySchemaResponse>(),
        };
    }

    getIndexedInstances(): IndexedInstance[] {
        this.ensureRevision();
        if (!this.state.indexed) {
            this.state.indexed = this.deps.getIndexedInstances();
        }
        return this.state.indexed;
    }

    getSnapshot(): AgentSnapshotResponse {
        this.ensureRevision();
        if (!this.state.snapshot) {
            const indexed = this.getIndexedInstances();
            this.state.snapshot = this.deps.buildSnapshot(
                indexed,
                this.state.revision as number,
                this.now(),
            );
        }
        return this.state.snapshot;
    }

    getSchema(classNameFilter?: string): AgentPropertySchemaResponse {
        this.ensureRevision();
        const normalizedFilter = this.normalizeFilter(classNameFilter);

        if (!this.state.schemaAll) {
            this.state.schemaAll = this.deps.buildSchema(
                this.getIndexedInstances(),
                this.state.revision as number,
            );
        }

        if (!normalizedFilter) {
            return this.state.schemaAll;
        }

        const cached = this.state.schemaByClass.get(normalizedFilter);
        if (cached) {
            return cached;
        }

        const classEntry = this.state.schemaAll.classes.find(entry => entry.className === normalizedFilter);
        const schema: AgentPropertySchemaResponse = {
            schemaVersion: this.state.schemaAll.schemaVersion,
            generatedAt: this.state.schemaAll.generatedAt,
            revision: this.state.schemaAll.revision,
            classes: classEntry ? [classEntry] : [],
        };
        this.state.schemaByClass.set(normalizedFilter, schema);
        return schema;
    }

    private ensureRevision(): void {
        const revision = this.deps.getRevision();
        if (this.state.revision === revision) {
            return;
        }

        this.state.revision = revision;
        this.state.indexed = null;
        this.state.snapshot = null;
        this.state.schemaAll = null;
        this.state.schemaByClass.clear();
    }

    private normalizeFilter(classNameFilter?: string): string | undefined {
        if (typeof classNameFilter !== 'string') {
            return undefined;
        }
        const normalized = classNameFilter.trim();
        return normalized.length > 0 ? normalized : undefined;
    }
}
