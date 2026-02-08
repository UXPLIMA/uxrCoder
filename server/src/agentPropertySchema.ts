import type {
    AgentClassPropertySchema,
    AgentEnumConstraint,
    AgentPropertyKind,
    AgentNumericConstraint,
    AgentPropertySchemaEntry,
    AgentPropertySchemaResponse,
    AgentStringConstraint,
    PropertyValue,
    RobloxInstance,
} from './types';

const READONLY_PROPERTY_NAMES = new Set([
    'ClassName',
    'Parent',
    'Children',
]);

const FORCED_STRING_PROPERTIES = new Set([
    'Name',
    'Source',
]);

type PropertyRecord = Record<string, unknown>;

interface ClassifiedPropertyValue {
    kind: AgentPropertyKind;
    valueType: string;
    enumType?: string;
    writable: boolean;
}

interface PropertyAggregate {
    kinds: Set<AgentPropertyKind>;
    valueTypes: Set<string>;
    enumTypes: Set<string>;
    enumNames: Set<string>;
    enumValues: Set<number>;
    writable: boolean;
    nullable: boolean;
    observedOn: number;
    numberObservedMin?: number;
    numberObservedMax?: number;
    numberObservedCount: number;
    numberAllInteger: boolean;
    stringObservedMinLength?: number;
    stringObservedMaxLength?: number;
    stringObservedCount: number;
}

interface ClassAggregate {
    className: string;
    instanceCount: number;
    properties: Map<string, PropertyAggregate>;
}

type IterateInstancesFn = (visit: (instance: RobloxInstance) => void) => void;

export type AgentPropertyValidationResult =
    | { ok: true }
    | { ok: false; error: string; details: Record<string, unknown> };

interface BuiltinConstraintDefinition {
    numeric?: {
        min?: number;
        max?: number;
        integer?: boolean;
    };
    string?: {
        minLength?: number;
        maxLength?: number;
        nonEmpty?: boolean;
        pattern?: string;
    };
    enum?: {
        allowedNames?: string[];
        allowedValues?: number[];
        strict?: boolean;
    };
}

const BUILTIN_PROPERTY_CONSTRAINTS: Record<string, BuiltinConstraintDefinition> = {
    Transparency: {
        numeric: { min: 0, max: 1 },
    },
    Reflectance: {
        numeric: { min: 0, max: 1 },
    },
};

function isObjectRecord(value: unknown): value is PropertyRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEnumType(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return undefined;
    }
    const normalized = value.trim().replace(/^Enum\./, '');
    return normalized.length > 0 ? normalized : undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

function updateObservedNumberConstraints(aggregate: PropertyAggregate, value: number): void {
    if (!Number.isFinite(value)) {
        return;
    }

    aggregate.numberObservedCount += 1;
    if (aggregate.numberObservedMin === undefined || value < aggregate.numberObservedMin) {
        aggregate.numberObservedMin = value;
    }
    if (aggregate.numberObservedMax === undefined || value > aggregate.numberObservedMax) {
        aggregate.numberObservedMax = value;
    }
    aggregate.numberAllInteger = aggregate.numberAllInteger && Number.isInteger(value);
}

function updateObservedStringConstraints(aggregate: PropertyAggregate, value: string): void {
    aggregate.stringObservedCount += 1;
    const length = value.length;
    if (aggregate.stringObservedMinLength === undefined || length < aggregate.stringObservedMinLength) {
        aggregate.stringObservedMinLength = length;
    }
    if (aggregate.stringObservedMaxLength === undefined || length > aggregate.stringObservedMaxLength) {
        aggregate.stringObservedMaxLength = length;
    }
}

function classifyPropertyValue(value: PropertyValue): ClassifiedPropertyValue {
    if (value === null) {
        return { kind: 'primitive', valueType: 'null', writable: true };
    }

    const rawType = typeof value;
    if (rawType === 'string' || rawType === 'number' || rawType === 'boolean') {
        return { kind: 'primitive', valueType: rawType, writable: true };
    }

    if (!isObjectRecord(value)) {
        return { kind: 'unknown', valueType: rawType, writable: true };
    }

    const typedValue = typeof value.type === 'string' ? value.type : undefined;
    if (!typedValue) {
        return { kind: 'unknown', valueType: 'object', writable: true };
    }

    if (typedValue === 'Enum') {
        return {
            kind: 'enum',
            valueType: 'Enum',
            enumType: normalizeEnumType(value.enumType),
            writable: true,
        };
    }

    if (typedValue === 'InstanceRef') {
        return { kind: 'instanceRef', valueType: 'InstanceRef', writable: true };
    }

    if (typedValue === 'Unsupported') {
        const robloxType = typeof value.robloxType === 'string' ? value.robloxType : undefined;
        return {
            kind: 'readonly',
            valueType: robloxType ? `Unsupported(${robloxType})` : 'Unsupported',
            writable: false,
        };
    }

    return {
        kind: 'struct',
        valueType: typedValue,
        writable: true,
    };
}

function preferredKind(kinds: AgentPropertyKind[], writable: boolean): AgentPropertyKind {
    if (!writable) {
        return 'readonly';
    }

    const precedence: AgentPropertyKind[] = ['enum', 'instanceRef', 'struct', 'primitive', 'readonly', 'unknown'];
    for (const candidate of precedence) {
        if (kinds.includes(candidate)) {
            return candidate;
        }
    }
    return 'unknown';
}

function serializerHintFor(kind: AgentPropertyKind, valueType: string): string {
    if (kind === 'primitive') {
        return `Use JSON primitive value (${valueType})`;
    }
    if (kind === 'enum') {
        return "Use { type: 'Enum', enumType, value, name } payload";
    }
    if (kind === 'instanceRef') {
        return "Use { type: 'InstanceRef', path } payload";
    }
    if (kind === 'struct') {
        return `Use serialized ${valueType} object shape from snapshot`;
    }
    if (kind === 'readonly') {
        return 'Read-only in sync layer';
    }
    return 'Use observed snapshot shape';
}

function deserializerHintFor(kind: AgentPropertyKind): string {
    if (kind === 'primitive') {
        return 'Deserialized directly as Lua primitive';
    }
    if (kind === 'enum') {
        return 'Deserialized via Enum lookup by name/value';
    }
    if (kind === 'instanceRef') {
        return 'Deserialized by resolving full DataModel path';
    }
    if (kind === 'struct') {
        return 'Deserialized via type field switch in plugin';
    }
    if (kind === 'readonly') {
        return 'Update rejected as non-writable';
    }
    return 'Best-effort passthrough';
}

function ensureClassAggregate(
    aggregates: Map<string, ClassAggregate>,
    className: string,
): ClassAggregate {
    let aggregate = aggregates.get(className);
    if (!aggregate) {
        aggregate = {
            className,
            instanceCount: 0,
            properties: new Map<string, PropertyAggregate>(),
        };
        aggregates.set(className, aggregate);
    }
    return aggregate;
}

function ensurePropertyAggregate(
    classAggregate: ClassAggregate,
    propertyName: string,
): PropertyAggregate {
    let aggregate = classAggregate.properties.get(propertyName);
    if (!aggregate) {
        aggregate = {
            kinds: new Set<AgentPropertyKind>(),
            valueTypes: new Set<string>(),
            enumTypes: new Set<string>(),
            enumNames: new Set<string>(),
            enumValues: new Set<number>(),
            writable: !READONLY_PROPERTY_NAMES.has(propertyName),
            nullable: false,
            observedOn: 0,
            numberObservedCount: 0,
            numberAllInteger: true,
            stringObservedCount: 0,
        };
        classAggregate.properties.set(propertyName, aggregate);
    }
    return aggregate;
}

function sortedStringSet(values: Set<string>): string[] | undefined {
    const items = Array.from(values).sort((a, b) => a.localeCompare(b));
    return items.length > 0 ? items : undefined;
}

function sortedNumberSet(values: Set<number>): number[] | undefined {
    const items = Array.from(values).sort((a, b) => a - b);
    return items.length > 0 ? items : undefined;
}

function buildNumericConstraint(
    propertyName: string,
    aggregate: PropertyAggregate,
): AgentNumericConstraint | undefined {
    const builtin = BUILTIN_PROPERTY_CONSTRAINTS[propertyName]?.numeric;
    const hasObserved = aggregate.numberObservedCount > 0;
    if (!builtin && !hasObserved) {
        return undefined;
    }

    return {
        min: builtin?.min ?? aggregate.numberObservedMin,
        max: builtin?.max ?? aggregate.numberObservedMax,
        integer: builtin?.integer ?? (hasObserved ? aggregate.numberAllInteger : undefined),
        strict: !!builtin,
        source: builtin ? 'builtin' : 'observed',
    };
}

function buildStringConstraint(
    propertyName: string,
    aggregate: PropertyAggregate,
): AgentStringConstraint | undefined {
    const builtin = BUILTIN_PROPERTY_CONSTRAINTS[propertyName]?.string;
    const hasObserved = aggregate.stringObservedCount > 0;
    if (!builtin && !hasObserved) {
        return undefined;
    }

    return {
        minLength: builtin?.minLength ?? aggregate.stringObservedMinLength,
        maxLength: builtin?.maxLength ?? aggregate.stringObservedMaxLength,
        nonEmpty: builtin?.nonEmpty,
        pattern: builtin?.pattern,
        strict: !!builtin,
        source: builtin ? 'builtin' : 'observed',
    };
}

function buildEnumConstraint(
    propertyName: string,
    aggregate: PropertyAggregate,
): AgentEnumConstraint | undefined {
    const builtin = BUILTIN_PROPERTY_CONSTRAINTS[propertyName]?.enum;
    const observedNames = sortedStringSet(aggregate.enumNames);
    const observedValues = sortedNumberSet(aggregate.enumValues);
    if (!builtin && !observedNames && !observedValues) {
        return undefined;
    }

    return {
        allowedNames: builtin?.allowedNames ?? observedNames,
        allowedValues: builtin?.allowedValues ?? observedValues,
        strict: builtin ? (builtin.strict ?? true) : false,
        source: builtin ? 'builtin' : 'observed',
    };
}

function aggregateToSchemaEntry(name: string, aggregate: PropertyAggregate): AgentPropertySchemaEntry {
    const kinds = Array.from(aggregate.kinds).sort();
    const valueTypes = Array.from(aggregate.valueTypes).sort();
    const enumTypes = Array.from(aggregate.enumTypes).sort();
    const writable = aggregate.writable;
    const kind = preferredKind(kinds, writable);

    return {
        name,
        kind,
        kinds,
        writable,
        nullable: aggregate.nullable,
        valueType: valueTypes.length === 1 ? valueTypes[0] : 'mixed',
        valueTypes,
        enumType: enumTypes.length === 1 ? enumTypes[0] : undefined,
        enumTypes: enumTypes.length > 0 ? enumTypes : undefined,
        numericConstraint: buildNumericConstraint(name, aggregate),
        stringConstraint: buildStringConstraint(name, aggregate),
        enumConstraint: buildEnumConstraint(name, aggregate),
        serializerHint: serializerHintFor(kind, valueTypes.length === 1 ? valueTypes[0] : 'mixed'),
        deserializerHint: deserializerHintFor(kind),
        observedOn: aggregate.observedOn,
    };
}

function normalizeClassNameFilter(classNameFilter?: string): string | null {
    const filter = typeof classNameFilter === 'string' && classNameFilter.trim().length > 0
        ? classNameFilter.trim()
        : null;
    return filter;
}

function collectClassAggregates(
    forEachInstance: IterateInstancesFn,
    filter: string | null,
): Map<string, ClassAggregate> {
    const aggregates = new Map<string, ClassAggregate>();
    forEachInstance((instance) => {
        if (filter && instance.className !== filter) {
            return;
        }

        const classAggregate = ensureClassAggregate(aggregates, instance.className);
        classAggregate.instanceCount += 1;

        const properties = instance.properties;
        for (const propertyName in properties) {
            if (!Object.prototype.hasOwnProperty.call(properties, propertyName)) {
                continue;
            }

            const rawValue = properties[propertyName] as PropertyValue;
            const propertyAggregate = ensurePropertyAggregate(classAggregate, propertyName);
            const classified = classifyPropertyValue(rawValue as PropertyValue);

            propertyAggregate.kinds.add(classified.kind);
            propertyAggregate.valueTypes.add(classified.valueType);
            if (classified.enumType) {
                propertyAggregate.enumTypes.add(classified.enumType);
            }

            if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
                updateObservedNumberConstraints(propertyAggregate, rawValue);
            } else if (typeof rawValue === 'string') {
                updateObservedStringConstraints(propertyAggregate, rawValue);
            }
            if (classified.kind === 'enum' && isObjectRecord(rawValue)) {
                if (typeof rawValue.name === 'string' && rawValue.name.trim().length > 0) {
                    propertyAggregate.enumNames.add(rawValue.name.trim());
                }
                const enumNumericValue = parseFiniteNumber(rawValue.value);
                if (enumNumericValue !== undefined) {
                    propertyAggregate.enumValues.add(enumNumericValue);
                }
            }

            propertyAggregate.writable = propertyAggregate.writable && classified.writable;
            propertyAggregate.nullable = propertyAggregate.nullable || rawValue === null;
            propertyAggregate.observedOn += 1;
        }
    });
    return aggregates;
}

function buildAgentPropertySchemaFromAggregates(
    aggregates: Map<string, ClassAggregate>,
    revision: number,
): AgentPropertySchemaResponse {

    const classes: AgentClassPropertySchema[] = Array.from(aggregates.values())
        .sort((a, b) => a.className.localeCompare(b.className))
        .map(classAggregate => ({
            className: classAggregate.className,
            instanceCount: classAggregate.instanceCount,
            properties: Array.from(classAggregate.properties.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, propertyAggregate]) => aggregateToSchemaEntry(name, propertyAggregate)),
        }));

    return {
        schemaVersion: 'uxr-agent-property-schema/v1',
        generatedAt: Date.now(),
        revision,
        classes,
    };
}

export function buildAgentPropertySchema(
    instances: RobloxInstance[],
    revision: number,
    classNameFilter?: string,
): AgentPropertySchemaResponse {
    const filter = normalizeClassNameFilter(classNameFilter);
    const aggregates = collectClassAggregates((visit) => {
        for (const instance of instances) {
            visit(instance);
        }
    }, filter);
    return buildAgentPropertySchemaFromAggregates(aggregates, revision);
}

export function buildAgentPropertySchemaFromIndexed(
    indexedInstances: Array<{ instance: RobloxInstance }>,
    revision: number,
    classNameFilter?: string,
): AgentPropertySchemaResponse {
    const filter = normalizeClassNameFilter(classNameFilter);
    const aggregates = collectClassAggregates((visit) => {
        for (let i = 0; i < indexedInstances.length; i++) {
            visit(indexedInstances[i].instance);
        }
    }, filter);
    return buildAgentPropertySchemaFromAggregates(aggregates, revision);
}

function isCompatiblePrimitive(expectedType: string, incomingValue: PropertyValue): boolean {
    if (expectedType === 'string') {
        return typeof incomingValue === 'string';
    }
    if (expectedType === 'number') {
        return typeof incomingValue === 'number' && Number.isFinite(incomingValue);
    }
    if (expectedType === 'boolean') {
        return typeof incomingValue === 'boolean';
    }
    if (expectedType === 'null') {
        return incomingValue === null;
    }

    return incomingValue === null
        || typeof incomingValue === 'string'
        || (typeof incomingValue === 'number' && Number.isFinite(incomingValue))
        || typeof incomingValue === 'boolean';
}

function isCompatibleEnum(expectedEnumType: string | undefined, incomingValue: PropertyValue): boolean {
    if (!isObjectRecord(incomingValue)) {
        return false;
    }

    if (incomingValue.type !== 'Enum') {
        return false;
    }

    const incomingEnumType = normalizeEnumType(incomingValue.enumType);
    if (expectedEnumType && incomingEnumType && incomingEnumType !== expectedEnumType) {
        return false;
    }

    return typeof incomingValue.name === 'string' || typeof incomingValue.value === 'number';
}

function isCompatibleStruct(expectedType: string, incomingValue: PropertyValue): boolean {
    if (!isObjectRecord(incomingValue)) {
        return false;
    }
    return incomingValue.type === expectedType;
}

function isCompatibleInstanceRef(incomingValue: PropertyValue): boolean {
    if (!isObjectRecord(incomingValue)) {
        return false;
    }
    return incomingValue.type === 'InstanceRef' && typeof incomingValue.path === 'string';
}

function validationError(error: string, details: Record<string, unknown>): AgentPropertyValidationResult {
    return {
        ok: false,
        error,
        details,
    };
}

function readFiniteNumberField(record: PropertyRecord, fieldName: string): number | undefined {
    const value = record[fieldName];
    return parseFiniteNumber(value);
}

function validateVector2Shape(value: PropertyRecord, propertyName: string): AgentPropertyValidationResult | null {
    const x = readFiniteNumberField(value, 'x');
    const y = readFiniteNumberField(value, 'y');
    if (x === undefined || y === undefined) {
        return validationError(`Invalid Vector2 payload for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'Vector2',
            requiredFields: ['x', 'y'],
        });
    }
    return null;
}

function validateVector3Shape(value: PropertyRecord, propertyName: string): AgentPropertyValidationResult | null {
    const x = readFiniteNumberField(value, 'x');
    const y = readFiniteNumberField(value, 'y');
    const z = readFiniteNumberField(value, 'z');
    if (x === undefined || y === undefined || z === undefined) {
        return validationError(`Invalid Vector3 payload for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'Vector3',
            requiredFields: ['x', 'y', 'z'],
        });
    }
    return null;
}

function validateUDimShape(value: PropertyRecord, propertyName: string): AgentPropertyValidationResult | null {
    const scale = readFiniteNumberField(value, 'scale');
    const offset = readFiniteNumberField(value, 'offset');
    if (scale === undefined || offset === undefined) {
        return validationError(`Invalid UDim payload for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'UDim',
            requiredFields: ['scale', 'offset'],
        });
    }
    return null;
}

function validateColor3Shape(value: PropertyRecord, propertyName: string): AgentPropertyValidationResult | null {
    const r = readFiniteNumberField(value, 'r');
    const g = readFiniteNumberField(value, 'g');
    const b = readFiniteNumberField(value, 'b');
    if (r === undefined || g === undefined || b === undefined) {
        return validationError(`Invalid Color3 payload for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'Color3',
            requiredFields: ['r', 'g', 'b'],
        });
    }

    if (r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1) {
        return validationError(`Color3 components must be within [0, 1] for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'Color3',
            min: 0,
            max: 1,
            actual: { r, g, b },
        });
    }

    return null;
}

function validateNumberRangeShape(value: PropertyRecord, propertyName: string): AgentPropertyValidationResult | null {
    const min = readFiniteNumberField(value, 'min');
    const max = readFiniteNumberField(value, 'max');
    if (min === undefined || max === undefined) {
        return validationError(`Invalid NumberRange payload for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'NumberRange',
            requiredFields: ['min', 'max'],
        });
    }

    if (min > max) {
        return validationError(`NumberRange min cannot exceed max for property '${propertyName}'`, {
            property: propertyName,
            expectedType: 'NumberRange',
            min,
            max,
        });
    }

    return null;
}

function validateStructShape(
    expectedType: string,
    incomingValue: PropertyValue,
    propertyName: string,
): AgentPropertyValidationResult | null {
    if (!isObjectRecord(incomingValue)) {
        return validationError(`Invalid payload for property '${propertyName}'`, {
            property: propertyName,
            expectedType,
            actualType: incomingValue === null ? 'null' : typeof incomingValue,
        });
    }

    if (expectedType === 'Vector2') {
        return validateVector2Shape(incomingValue, propertyName);
    }
    if (expectedType === 'Vector3') {
        return validateVector3Shape(incomingValue, propertyName);
    }
    if (expectedType === 'CFrame') {
        const position = isObjectRecord(incomingValue.position) ? incomingValue.position : null;
        const orientation = isObjectRecord(incomingValue.orientation) ? incomingValue.orientation : null;
        if (!position || !orientation) {
            return validationError(`Invalid CFrame payload for property '${propertyName}'`, {
                property: propertyName,
                expectedType: 'CFrame',
                requiredFields: ['position', 'orientation'],
            });
        }

        const positionValidation = validateVector3Shape(position, `${propertyName}.position`);
        if (positionValidation) {
            return positionValidation;
        }
        return validateVector3Shape(orientation, `${propertyName}.orientation`);
    }
    if (expectedType === 'Color3') {
        return validateColor3Shape(incomingValue, propertyName);
    }
    if (expectedType === 'UDim') {
        return validateUDimShape(incomingValue, propertyName);
    }
    if (expectedType === 'UDim2') {
        const x = isObjectRecord(incomingValue.x) ? incomingValue.x : null;
        const y = isObjectRecord(incomingValue.y) ? incomingValue.y : null;
        if (!x || !y) {
            return validationError(`Invalid UDim2 payload for property '${propertyName}'`, {
                property: propertyName,
                expectedType: 'UDim2',
                requiredFields: ['x', 'y'],
            });
        }

        const xValidation = validateUDimShape(x, `${propertyName}.x`);
        if (xValidation) {
            return xValidation;
        }
        return validateUDimShape(y, `${propertyName}.y`);
    }
    if (expectedType === 'NumberRange') {
        return validateNumberRangeShape(incomingValue, propertyName);
    }
    if (expectedType === 'Rect') {
        const min = isObjectRecord(incomingValue.min) ? incomingValue.min : null;
        const max = isObjectRecord(incomingValue.max) ? incomingValue.max : null;
        if (!min || !max) {
            return validationError(`Invalid Rect payload for property '${propertyName}'`, {
                property: propertyName,
                expectedType: 'Rect',
                requiredFields: ['min', 'max'],
            });
        }

        const minValidation = validateVector2Shape(min, `${propertyName}.min`);
        if (minValidation) {
            return minValidation;
        }
        return validateVector2Shape(max, `${propertyName}.max`);
    }
    if (expectedType === 'BrickColor') {
        const number = readFiniteNumberField(incomingValue, 'number');
        const name = typeof incomingValue.name === 'string' ? incomingValue.name : undefined;
        if (number === undefined || !Number.isInteger(number) || number < 0 || !name) {
            return validationError(`Invalid BrickColor payload for property '${propertyName}'`, {
                property: propertyName,
                expectedType: 'BrickColor',
                requiredFields: ['number', 'name'],
            });
        }
    }

    return null;
}

function validateNumericConstraint(
    propertyName: string,
    incomingValue: PropertyValue,
): AgentPropertyValidationResult | null {
    const constraint = BUILTIN_PROPERTY_CONSTRAINTS[propertyName]?.numeric;
    if (!constraint) {
        return null;
    }

    if (typeof incomingValue !== 'number' || !Number.isFinite(incomingValue)) {
        return validationError(`Property '${propertyName}' expects a finite number`, {
            property: propertyName,
            expectedType: 'number',
            actualType: incomingValue === null ? 'null' : typeof incomingValue,
        });
    }

    if (constraint.integer && !Number.isInteger(incomingValue)) {
        return validationError(`Property '${propertyName}' expects an integer`, {
            property: propertyName,
            constraint: { integer: true },
            actualValue: incomingValue,
        });
    }
    if (constraint.min !== undefined && incomingValue < constraint.min) {
        return validationError(`Property '${propertyName}' cannot be less than ${constraint.min}`, {
            property: propertyName,
            constraint: { min: constraint.min },
            actualValue: incomingValue,
        });
    }
    if (constraint.max !== undefined && incomingValue > constraint.max) {
        return validationError(`Property '${propertyName}' cannot be greater than ${constraint.max}`, {
            property: propertyName,
            constraint: { max: constraint.max },
            actualValue: incomingValue,
        });
    }

    return null;
}

function validateStringConstraint(
    propertyName: string,
    incomingValue: PropertyValue,
): AgentPropertyValidationResult | null {
    const constraint = BUILTIN_PROPERTY_CONSTRAINTS[propertyName]?.string;
    if (!constraint) {
        return null;
    }

    if (typeof incomingValue !== 'string') {
        return validationError(`Property '${propertyName}' expects string value`, {
            property: propertyName,
            expectedType: 'string',
            actualType: incomingValue === null ? 'null' : typeof incomingValue,
        });
    }

    if (constraint.nonEmpty && incomingValue.length === 0) {
        return validationError(`Property '${propertyName}' cannot be empty`, {
            property: propertyName,
            constraint: { nonEmpty: true },
        });
    }
    if (constraint.minLength !== undefined && incomingValue.length < constraint.minLength) {
        return validationError(`Property '${propertyName}' must be at least ${constraint.minLength} characters`, {
            property: propertyName,
            constraint: { minLength: constraint.minLength },
            actualLength: incomingValue.length,
        });
    }
    if (constraint.maxLength !== undefined && incomingValue.length > constraint.maxLength) {
        return validationError(`Property '${propertyName}' must be at most ${constraint.maxLength} characters`, {
            property: propertyName,
            constraint: { maxLength: constraint.maxLength },
            actualLength: incomingValue.length,
        });
    }
    if (constraint.pattern && !(new RegExp(constraint.pattern).test(incomingValue))) {
        return validationError(`Property '${propertyName}' does not match required format`, {
            property: propertyName,
            constraint: { pattern: constraint.pattern },
            actualValue: incomingValue,
        });
    }

    return null;
}

function validateEnumConstraint(
    propertyName: string,
    incomingValue: PropertyValue,
): AgentPropertyValidationResult | null {
    const constraint = BUILTIN_PROPERTY_CONSTRAINTS[propertyName]?.enum;
    if (!constraint || !constraint.strict) {
        return null;
    }

    if (!isObjectRecord(incomingValue) || incomingValue.type !== 'Enum') {
        return validationError(`Property '${propertyName}' expects Enum payload`, {
            property: propertyName,
            expectedType: 'Enum',
        });
    }

    const incomingName = typeof incomingValue.name === 'string' ? incomingValue.name : undefined;
    const incomingNumber = parseFiniteNumber(incomingValue.value);

    if (constraint.allowedNames && incomingName && !constraint.allowedNames.includes(incomingName)) {
        return validationError(`Property '${propertyName}' does not allow enum name '${incomingName}'`, {
            property: propertyName,
            allowedNames: constraint.allowedNames,
            actualName: incomingName,
        });
    }
    if (constraint.allowedValues && incomingNumber !== undefined && !constraint.allowedValues.includes(incomingNumber)) {
        return validationError(`Property '${propertyName}' does not allow enum value '${incomingNumber}'`, {
            property: propertyName,
            allowedValues: constraint.allowedValues,
            actualValue: incomingNumber,
        });
    }

    return null;
}

export function validateAgentPropertyUpdate(
    instance: RobloxInstance,
    propertyName: string,
    incomingValue: PropertyValue,
): AgentPropertyValidationResult {
    const normalizedProperty = propertyName.trim();
    if (normalizedProperty.length === 0) {
        return {
            ok: false,
            error: 'Property name cannot be empty',
            details: { property: propertyName },
        };
    }

    if (READONLY_PROPERTY_NAMES.has(normalizedProperty)) {
        return {
            ok: false,
            error: `Property '${normalizedProperty}' is read-only`,
            details: { property: normalizedProperty, reason: 'readonly_property_name' },
        };
    }

    if (FORCED_STRING_PROPERTIES.has(normalizedProperty)) {
        if (typeof incomingValue !== 'string') {
            return {
                ok: false,
                error: `Property '${normalizedProperty}' expects string value`,
                details: {
                    property: normalizedProperty,
                    expectedType: 'string',
                    actualType: incomingValue === null ? 'null' : typeof incomingValue,
                },
            };
        }
        const stringConstraintValidation = validateStringConstraint(normalizedProperty, incomingValue);
        if (stringConstraintValidation) {
            return stringConstraintValidation;
        }
        return { ok: true };
    }

    const currentValue = instance.properties?.[normalizedProperty];
    if (currentValue === undefined) {
        // Unknown property in the current snapshot. Allow for forward-compatible properties.
        return { ok: true };
    }

    const expected = classifyPropertyValue(currentValue);
    if (!expected.writable || expected.kind === 'readonly') {
        return {
            ok: false,
            error: `Property '${normalizedProperty}' is not writable`,
            details: {
                property: normalizedProperty,
                expectedKind: expected.kind,
                expectedType: expected.valueType,
            },
        };
    }

    let compatible = true;
    if (expected.kind === 'primitive') {
        compatible = isCompatiblePrimitive(expected.valueType, incomingValue);
    } else if (expected.kind === 'enum') {
        compatible = isCompatibleEnum(expected.enumType, incomingValue);
    } else if (expected.kind === 'struct') {
        compatible = isCompatibleStruct(expected.valueType, incomingValue);
    } else if (expected.kind === 'instanceRef') {
        compatible = isCompatibleInstanceRef(incomingValue);
    }

    if (!compatible) {
        return {
            ok: false,
            error: `Type mismatch for property '${normalizedProperty}'`,
            details: {
                property: normalizedProperty,
                expectedKind: expected.kind,
                expectedType: expected.valueType,
                expectedEnumType: expected.enumType,
                actualType: incomingValue === null
                    ? 'null'
                    : (isObjectRecord(incomingValue) && typeof incomingValue.type === 'string'
                        ? incomingValue.type
                        : typeof incomingValue),
            },
        };
    }

    if (expected.kind === 'primitive') {
        if (expected.valueType === 'number') {
            const numericConstraintValidation = validateNumericConstraint(normalizedProperty, incomingValue);
            if (numericConstraintValidation) {
                return numericConstraintValidation;
            }
        } else if (expected.valueType === 'string') {
            const stringConstraintValidation = validateStringConstraint(normalizedProperty, incomingValue);
            if (stringConstraintValidation) {
                return stringConstraintValidation;
            }
        }
    } else if (expected.kind === 'enum') {
        const enumConstraintValidation = validateEnumConstraint(normalizedProperty, incomingValue);
        if (enumConstraintValidation) {
            return enumConstraintValidation;
        }
    } else if (expected.kind === 'struct') {
        const structValidation = validateStructShape(expected.valueType, incomingValue, normalizedProperty);
        if (structValidation) {
            return structValidation;
        }
    }

    return { ok: true };
}
