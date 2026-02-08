/**
 * @fileoverview BuildSystem - Handles exporting the project to Roblox file formats.
 *
 * Currently supports:
 * - .rbxlx (Roblox XML Place)
 *
 * @author UXPLIMA
 * @license MIT
 */

import { RobloxInstance, PropertyValue } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Handles building/exporting the project.
 */
export class BuildSystem {
    constructor(private readonly workspacePath: string) { }

    /**
     * Export the current state to a .rbxlx file.
     *
     * @param instances - The root instances to export
     * @param fileName - Output file name (default: "project.rbxlx")
     */
    public async buildRbxlx(instances: RobloxInstance[], fileName: string = 'project.rbxlx'): Promise<string> {
        const xmlContent = this.generateXml(instances);
        const outputPath = path.join(this.workspacePath, fileName);

        await fs.promises.writeFile(outputPath, xmlContent, 'utf-8');
        return outputPath;
    }

    /**
     * Generate the Roblox XML content.
     */
    private generateXml(instances: RobloxInstance[]): string {
        let xml = `<?xml version="1.0" encoding="utf-8"?>
<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
	<External>null</External>
	<External>nil</External>`;

        for (const inst of instances) {
            xml += this.serializeInstance(inst, 1);
        }

        xml += '\n</roblox>';
        return xml;
    }

    /**
     * Serialize a single instance to XML.
     */
    private serializeInstance(inst: RobloxInstance, depth: number): string {
        const indent = '\t'.repeat(depth);
        // Generate a simpler referent if not present (though we use UUIDs)
        const referent = inst.id || ('RBX' + Math.random().toString(36).substr(2, 9).toUpperCase());

        let xml = `\n${indent}<Item class="${inst.className}" referent="${referent}">
${indent}\t<Properties>
${indent}\t\t<string name="Name">${this.escapeXml(inst.name)}</string>`;

        // Serialize Properties
        for (const [name, value] of Object.entries(inst.properties)) {
            if (name === 'Name') continue; // Already handled
            xml += this.serializeProperty(name, value, depth + 2);
        }

        xml += `\n${indent}\t</Properties>`;

        // Serialize Children
        if (inst.children) {
            for (const child of inst.children) {
                xml += this.serializeInstance(child, depth + 1);
            }
        }

        xml += `\n${indent}</Item>`;
        return xml;
    }

    /**
     * Serialize a property value to XML.
     */
    private serializeProperty(name: string, value: PropertyValue, depth: number): string {
        const indent = '\t'.repeat(depth);

        if (typeof value === 'string') {
            return `\n${indent}<string name="${name}">${this.escapeXml(value)}</string>`;
        } else if (typeof value === 'boolean') {
            return `\n${indent}<bool name="${name}">${value}</bool>`;
        } else if (typeof value === 'number') {
            return `\n${indent}<float name="${name}">${value}</float>`; // Simplified: Assuming float for now
        }

        // Complex types
        if (value && typeof value === 'object' && 'type' in value) {
            const v = value as any;
            switch (v.type) {
                case 'Vector3':
                    return `\n${indent}<Vector3 name="${name}">
${indent}\t<X>${v.x}</X>
${indent}\t<Y>${v.y}</Y>
${indent}\t<Z>${v.z}</Z>
${indent}</Vector3>`;

                case 'Color3':
                    return `\n${indent}<Color3 name="${name}">
${indent}\t<R>${v.r}</R>
${indent}\t<G>${v.g}</G>
${indent}\t<B>${v.b}</B>
${indent}</Color3>`;

                case 'Vector2':
                    return `\n${indent}<Vector2 name="${name}">
${indent}\t<X>${v.x}</X>
${indent}\t<Y>${v.y}</Y>
${indent}</Vector2>`;

                case 'CFrame':
                    const cframeRotation = this.rotationMatrixFromOrientation(v.orientation);
                    return `\n${indent}<CoordinateFrame name="${name}">
${indent}\t<X>${v.position.x}</X>
${indent}\t<Y>${v.position.y}</Y>
${indent}\t<Z>${v.position.z}</Z>
${indent}\t<R00>${cframeRotation.r00}</R00>
${indent}\t<R01>${cframeRotation.r01}</R01>
${indent}\t<R02>${cframeRotation.r02}</R02>
${indent}\t<R10>${cframeRotation.r10}</R10>
${indent}\t<R11>${cframeRotation.r11}</R11>
${indent}\t<R12>${cframeRotation.r12}</R12>
${indent}\t<R20>${cframeRotation.r20}</R20>
${indent}\t<R21>${cframeRotation.r21}</R21>
${indent}\t<R22>${cframeRotation.r22}</R22>
${indent}</CoordinateFrame>`;

                case 'UDim2':
                    return `\n${indent}<UDim2 name="${name}">
${indent}\t<XS>${v.x.scale}</XS>
${indent}\t<XO>${v.x.offset}</XO>
${indent}\t<YS>${v.y.scale}</YS>
${indent}\t<YO>${v.y.offset}</YO>
${indent}</UDim2>`;

                case 'UDim':
                    return `\n${indent}<UDim name="${name}">
${indent}\t<S>${v.scale}</S>
${indent}\t<O>${v.offset}</O>
${indent}</UDim>`;

                case 'BrickColor':
                    return `\n${indent}<int name="${name}">${v.number}</int>`;
                // BrickColor is often stored as int in XML

                case 'Rect':
                    return `\n${indent}<Rect2D name="${name}">
${indent}\t<min>
${indent}\t\t<X>${v.min.x}</X>
${indent}\t\t<Y>${v.min.y}</Y>
${indent}\t</min>
${indent}\t<max>
${indent}\t\t<X>${v.max.x}</X>
${indent}\t\t<Y>${v.max.y}</Y>
${indent}\t</max>
${indent}</Rect2D>`;

                case 'NumberRange':
                    // NumberRange is strictly not standard property in some contexts but
                    // handled here if needed. XML format might vary.
                    return `\n${indent}<NumberRange name="${name}">${v.min} ${v.max}</NumberRange>`;

                case 'Enum':
                    return `\n${indent}<token name="${name}">${v.value}</token>`;

                // Add more types as needed...
            }
        }

        return '';
    }

    /**
     * Convert XYZ Euler orientation (degrees) into a CoordinateFrame rotation matrix.
     */
    private rotationMatrixFromOrientation(orientation: { x?: number; y?: number; z?: number } | undefined): {
        r00: number;
        r01: number;
        r02: number;
        r10: number;
        r11: number;
        r12: number;
        r20: number;
        r21: number;
        r22: number;
    } {
        if (!orientation) {
            return {
                r00: 1, r01: 0, r02: 0,
                r10: 0, r11: 1, r12: 0,
                r20: 0, r21: 0, r22: 1,
            };
        }

        const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
        const x = toRad(orientation.x ?? 0);
        const y = toRad(orientation.y ?? 0);
        const z = toRad(orientation.z ?? 0);

        const cx = Math.cos(x);
        const sx = Math.sin(x);
        const cy = Math.cos(y);
        const sy = Math.sin(y);
        const cz = Math.cos(z);
        const sz = Math.sin(z);

        // XYZ Euler rotation matrix.
        const r00 = cy * cz;
        const r01 = -cy * sz;
        const r02 = sy;
        const r10 = cx * sz + cz * sx * sy;
        const r11 = cx * cz - sx * sy * sz;
        const r12 = -cy * sx;
        const r20 = sx * sz - cx * cz * sy;
        const r21 = cz * sx + cx * sy * sz;
        const r22 = cx * cy;

        return {
            r00: this.normalizeRotationComponent(r00),
            r01: this.normalizeRotationComponent(r01),
            r02: this.normalizeRotationComponent(r02),
            r10: this.normalizeRotationComponent(r10),
            r11: this.normalizeRotationComponent(r11),
            r12: this.normalizeRotationComponent(r12),
            r20: this.normalizeRotationComponent(r20),
            r21: this.normalizeRotationComponent(r21),
            r22: this.normalizeRotationComponent(r22),
        };
    }

    /**
     * Keep XML rotation values compact and stable across platforms.
     */
    private normalizeRotationComponent(value: number): number {
        if (Math.abs(value) < 1e-12) {
            return 0;
        }
        return Number.parseFloat(value.toFixed(12));
    }

    /**
     * Escape XML special characters.
     */
    private escapeXml(unsafe: string): string {
        return unsafe.replace(/[<>&'"]/g, c => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
            return c;
        });
    }

    /**
     * Export a specific instance (and its children) to a .rbxmx file.
     *
     * @param instance - The root instance to export
     * @param fileName - Output file name
     */
    public async buildRbxmx(instance: RobloxInstance, fileName?: string): Promise<string> {
        // If no filename provided, use instance name
        if (!fileName) {
            fileName = `${instance.name}.rbxmx`;
        }

        // Ensure extension is .rbxmx
        if (!fileName.endsWith('.rbxmx')) {
            fileName += '.rbxmx';
        }

        const xmlContent = this.generateXml([instance]);
        const outputPath = path.join(this.workspacePath, fileName);

        await fs.promises.writeFile(outputPath, xmlContent, 'utf-8');
        return outputPath;
    }
}
