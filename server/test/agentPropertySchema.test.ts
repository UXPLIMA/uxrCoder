import { describe, expect, it } from 'vitest';
import {
    buildAgentPropertySchema,
    buildAgentPropertySchemaFromIndexed,
    validateAgentPropertyUpdate,
} from '../src/agentPropertySchema';
import type { RobloxInstance } from '../src/types';

function getProperty(
    instanceClass: { properties: Array<{ name: string; kind: string; valueType: string; writable: boolean; enumType?: string }> },
    name: string,
) {
    return instanceClass.properties.find(property => property.name === name);
}

describe('agentPropertySchema', () => {
    it('builds class/property metadata from snapshot instances', () => {
        const instances: RobloxInstance[] = [
            {
                id: 'part-1',
                className: 'Part',
                name: 'Part',
                parent: 'Workspace',
                properties: {
                    Name: 'Part',
                    Anchored: true,
                    Transparency: 0.5,
                    Material: {
                        type: 'Enum',
                        enumType: 'Material',
                        value: 256,
                        name: 'Plastic',
                    },
                    Position: {
                        type: 'Vector3',
                        x: 0,
                        y: 5,
                        z: 0,
                    },
                },
                children: [],
            },
            {
                id: 'part-2',
                className: 'Part',
                name: 'Part2',
                parent: 'Workspace',
                properties: {
                    Name: 'Part2',
                    Anchored: false,
                    Transparency: 0.2,
                    Material: {
                        type: 'Enum',
                        enumType: 'Enum.Material',
                        value: 512,
                        name: 'Wood',
                    },
                    Position: {
                        type: 'Vector3',
                        x: 10,
                        y: 3,
                        z: 2,
                    },
                },
                children: [],
            },
            {
                id: 'folder-1',
                className: 'Folder',
                name: 'Folder',
                parent: 'Workspace',
                properties: {
                    Name: 'Folder',
                    TagBlob: {
                        type: 'Unsupported',
                        robloxType: 'BinaryString',
                        value: '...',
                    },
                },
                children: [],
            },
        ];

        const schema = buildAgentPropertySchema(instances, 12);

        expect(schema.schemaVersion).toBe('uxr-agent-property-schema/v1');
        expect(schema.revision).toBe(12);

        const partClass = schema.classes.find(entry => entry.className === 'Part');
        expect(partClass).toBeDefined();
        expect(partClass?.instanceCount).toBe(2);

        const material = getProperty(partClass!, 'Material');
        expect(material).toBeDefined();
        expect(material?.kind).toBe('enum');
        expect(material?.enumType).toBe('Material');
        expect(material?.writable).toBe(true);
        expect(material?.enumConstraint?.source).toBe('observed');
        expect(material?.enumConstraint?.strict).toBe(false);
        expect(material?.enumConstraint?.allowedNames).toEqual(['Plastic', 'Wood']);
        expect(material?.enumConstraint?.allowedValues).toEqual([256, 512]);

        const transparency = getProperty(partClass!, 'Transparency');
        expect(transparency).toBeDefined();
        expect(transparency?.numericConstraint?.source).toBe('builtin');
        expect(transparency?.numericConstraint?.strict).toBe(true);
        expect(transparency?.numericConstraint?.min).toBe(0);
        expect(transparency?.numericConstraint?.max).toBe(1);

        const position = getProperty(partClass!, 'Position');
        expect(position).toBeDefined();
        expect(position?.kind).toBe('struct');
        expect(position?.valueType).toBe('Vector3');

        const folderClass = schema.classes.find(entry => entry.className === 'Folder');
        expect(folderClass).toBeDefined();
        const tagBlob = getProperty(folderClass!, 'TagBlob');
        expect(tagBlob).toBeDefined();
        expect(tagBlob?.kind).toBe('readonly');
        expect(tagBlob?.writable).toBe(false);
    });

    it('supports class filter', () => {
        const instances: RobloxInstance[] = [
            {
                id: 'part-1',
                className: 'Part',
                name: 'Part',
                parent: 'Workspace',
                properties: { Name: 'Part' },
                children: [],
            },
            {
                id: 'folder-1',
                className: 'Folder',
                name: 'Folder',
                parent: 'Workspace',
                properties: { Name: 'Folder' },
                children: [],
            },
        ];

        const schema = buildAgentPropertySchema(instances, 1, 'Folder');
        expect(schema.classes).toHaveLength(1);
        expect(schema.classes[0].className).toBe('Folder');
    });

    it('builds the same schema from indexed entries without remapping arrays', () => {
        const instances: RobloxInstance[] = [
            {
                id: 'part-1',
                className: 'Part',
                name: 'Part',
                parent: 'Workspace',
                properties: {
                    Name: 'Part',
                    Anchored: true,
                    Transparency: 0.5,
                },
                children: [],
            },
            {
                id: 'folder-1',
                className: 'Folder',
                name: 'Folder',
                parent: 'Workspace',
                properties: {
                    Name: 'Folder',
                },
                children: [],
            },
        ];

        const schemaFromInstances = buildAgentPropertySchema(instances, 9);
        const schemaFromIndexed = buildAgentPropertySchemaFromIndexed(
            instances.map((instance, index) => ({
                path: ['Workspace', `Node${index}`],
                instance,
            })),
            9,
        );

        expect(schemaFromIndexed.schemaVersion).toBe(schemaFromInstances.schemaVersion);
        expect(schemaFromIndexed.revision).toBe(schemaFromInstances.revision);
        expect(schemaFromIndexed.classes).toEqual(schemaFromInstances.classes);
    });

    it('validates updates using current property shape', () => {
        const part: RobloxInstance = {
            id: 'part-1',
            className: 'Part',
            name: 'Part',
            parent: 'Workspace',
            properties: {
                Name: 'Part',
                Anchored: false,
                Transparency: 0.5,
                Material: {
                    type: 'Enum',
                    enumType: 'Material',
                    value: 256,
                    name: 'Plastic',
                },
                Position: {
                    type: 'Vector3',
                    x: 0,
                    y: 5,
                    z: 0,
                },
                Color: {
                    type: 'Color3',
                    r: 0.5,
                    g: 0.5,
                    b: 0.5,
                },
                SizeRange: {
                    type: 'NumberRange',
                    min: 1,
                    max: 10,
                },
                UnsupportedProperty: {
                    type: 'Unsupported',
                    robloxType: 'BinaryString',
                    value: '...',
                },
            },
            children: [],
        };

        expect(validateAgentPropertyUpdate(part, 'Name', 'PartRenamed').ok).toBe(true);
        expect(validateAgentPropertyUpdate(part, 'Name', 5).ok).toBe(false);
        expect(validateAgentPropertyUpdate(part, 'Anchored', true).ok).toBe(true);
        expect(validateAgentPropertyUpdate(part, 'Anchored', 'true').ok).toBe(false);
        expect(validateAgentPropertyUpdate(part, 'Transparency', 0.2).ok).toBe(true);
        expect(validateAgentPropertyUpdate(part, 'Transparency', -0.01).ok).toBe(false);
        expect(validateAgentPropertyUpdate(part, 'Transparency', 1.01).ok).toBe(false);

        expect(validateAgentPropertyUpdate(part, 'Material', {
            type: 'Enum',
            enumType: 'Material',
            value: 512,
            name: 'Wood',
        }).ok).toBe(true);

        expect(validateAgentPropertyUpdate(part, 'Material', {
            type: 'Enum',
            enumType: 'Font',
            value: 1,
            name: 'SourceSans',
        }).ok).toBe(false);

        expect(validateAgentPropertyUpdate(part, 'Position', {
            type: 'Vector3',
            x: 1,
            y: 2,
            z: 3,
        }).ok).toBe(true);
        expect(validateAgentPropertyUpdate(part, 'Position', {
            type: 'Vector3',
            x: 1,
            y: 2,
        }).ok).toBe(false);

        expect(validateAgentPropertyUpdate(part, 'Position', {
            type: 'CFrame',
            position: { type: 'Vector3', x: 1, y: 2, z: 3 },
            orientation: { type: 'Vector3', x: 0, y: 0, z: 0 },
        }).ok).toBe(false);
        expect(validateAgentPropertyUpdate(part, 'Color', {
            type: 'Color3',
            r: 0.1,
            g: 0.2,
            b: 0.3,
        }).ok).toBe(true);
        expect(validateAgentPropertyUpdate(part, 'Color', {
            type: 'Color3',
            r: 1.1,
            g: 0.2,
            b: 0.3,
        }).ok).toBe(false);
        expect(validateAgentPropertyUpdate(part, 'SizeRange', {
            type: 'NumberRange',
            min: 2,
            max: 6,
        }).ok).toBe(true);
        expect(validateAgentPropertyUpdate(part, 'SizeRange', {
            type: 'NumberRange',
            min: 8,
            max: 3,
        }).ok).toBe(false);

        expect(validateAgentPropertyUpdate(part, 'UnsupportedProperty', 'abc').ok).toBe(false);
        expect(validateAgentPropertyUpdate(part, 'Parent', 'Workspace').ok).toBe(false);

        // Unknown properties are allowed for forward compatibility.
        expect(validateAgentPropertyUpdate(part, 'CanTouch', true).ok).toBe(true);
    });
});
