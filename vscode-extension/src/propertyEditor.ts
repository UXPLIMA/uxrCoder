/**
 * @fileoverview Property editor webview panel for inspecting Roblox instances.
 *
 * This module provides a webview panel that displays and allows editing
 * of Roblox instance properties.
 *
 * @author UXPLIMA
 * @license MIT
 */

import * as vscode from 'vscode';
import { SyncClient } from './syncClient';
import type { AgentClassPropertySchema, PropertyValue, RobloxInstance } from './types';
import { RobloxTreeItem } from './treeView';

/**
 * Provides the property editor webview panel.
 *
 * Displays a table of properties for the currently selected instance
 * in the Roblox Explorer tree view.
 */
export class PropertyEditorProvider implements vscode.WebviewViewProvider {
    /** Unique identifier for this view type */
    public static readonly viewType = 'robloxProperties';

    /** The webview view instance */
    private _view?: vscode.WebviewView;

    /** Currently displayed items */
    private _currentItems: RobloxTreeItem[] = [];
    /** Server-provided property schema by class */
    private _propertySchemaByClass: Record<string, AgentClassPropertySchema> = {};
    /** Monotonic token to drop stale async schema responses */
    private _schemaRequestToken = 0;

    /**
     * Create a new property editor provider.
     *
     * @param extensionUri - URI of the extension directory
     * @param syncClient - The sync client for updating properties
     */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly syncClient: SyncClient
    ) { }

    /**
     * Resolve the webview view.
     * Called when the view is first shown.
     *
     * @param webviewView - The webview view to resolve
     * @param _context - Webview view context
     * @param _token - Cancellation token
     */
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        // Configure webview options
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        // Set initial content
        webviewView.webview.html = this.getHtmlContent();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(message => {
            this.handleWebviewMessage(message);
        });
    }

    /**
     * Show properties for tree items.
     *
     * @param items - The tree items to show properties for
     */
    showProperties(items: RobloxTreeItem[]): void {
        this._currentItems = items;
        void this.refreshPropertySchema();
        this.updateView();
    }

    /**
     * Update the webview with current instance properties.
     */
    private updateView(): void {
        if (!this._view) {
            return;
        }

        // Prepare data for webview
        // If single item, send full instance
        // If multiple, send common properties
        const instances = this._currentItems.map(item => item.instance);

        this._view.webview.postMessage({
            type: 'update',
            instances: instances,
            propertySchemaByClass: this._propertySchemaByClass,
        });
    }

    /**
     * Refresh class-level property schemas for currently selected instances.
     */
    private async refreshPropertySchema(): Promise<void> {
        const requestToken = ++this._schemaRequestToken;

        if (this._currentItems.length === 0) {
            this._propertySchemaByClass = {};
            this.updateView();
            return;
        }

        const classNames = Array.from(new Set(
            this._currentItems.map(item => item.instance.className).filter(Boolean),
        ));
        const nextSchema: Record<string, AgentClassPropertySchema> = {};

        for (const className of classNames) {
            const response = await this.syncClient.getPropertySchema(className);
            const classSchema = response?.classes.find(entry => entry.className === className);
            if (classSchema) {
                nextSchema[className] = classSchema;
            }
        }

        if (requestToken !== this._schemaRequestToken) {
            return;
        }

        this._propertySchemaByClass = nextSchema;
        this.updateView();
    }

    /**
     * Handle messages from the webview.
     *
     * @param message - The message from the webview
     */
    private handleWebviewMessage(message: { type: string; property?: string; value?: PropertyValue }): void {
        if (message.type === 'updateProperty' && this._currentItems.length > 0 && message.property !== undefined && message.value !== undefined) {

            // Apply to all selected items
            for (const item of this._currentItems) {
                this.syncClient.updateProperty(item.path, message.property, message.value);
                console.log(`Update property: ${item.path.join('.')} : ${message.property} = ${JSON.stringify(message.value)}`);
            }
        }
    }

    /**
     * Generate the HTML content for the webview.
     *
     * @returns HTML string
     */
    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Properties</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-editor-font-family, monospace);
        }

        body {
            padding: 8px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-panel-background);
        }

        h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 4px;
        }

        .no-selection {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            text-align: center;
            padding: 20px;
        }

        .property-table {
            width: 100%;
            border-collapse: collapse;
        }

        .property-row {
            display: flex;
            align-items: center;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 4px 0;
            min-height: 24px;
        }

        .property-name {
            flex: 0 0 35%;
            color: var(--vscode-symbolIcon-propertyForeground, #4fc1ff);
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-right: 8px;
        }

        .property-value {
            flex: 1;
            color: var(--vscode-foreground);
            overflow: hidden;
            display: flex;
            align-items: center;
        }
        
        input {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 2px 4px;
            font-family: inherit;
            font-size: inherit;
            width: 100%;
            box-sizing: border-box;
        }
        
        input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        input[type="checkbox"] {
            width: auto;
        }
        
        input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .mixed-value {
            font-style: italic;
            color: var(--vscode-descriptionForeground);
            padding: 2px 4px;
        }

        /* Vector3 / Vector2 inputs */
        .vector-inputs {
            display: flex;
            gap: 4px;
            width: 100%;
        }
        
        .vector-inputs input {
            flex: 1;
            min-width: 0;
        }

        .class-badge {
            display: inline-block;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            margin-left: 8px;
        }
        
        /* UDim2 inputs */
        .udim-group {
            display: flex;
            gap: 4px;
            align-items: center;
            width: 100%;
        }

        .udim-group span {
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
        }
        
        .udim-group input {
            flex: 1;
            min-width: 0;
        }

        .section {
            margin-bottom: 16px;
        }

        .section-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
    </style>
</head>
<body>
    <div id="content">
        <div class="no-selection">Select an instance to view properties</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentInstances = [];
        let commonProperties = {};
        let propertySchemaByClass = {};

        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;

            if (message.type === 'update') {
                currentInstances = message.instances || [];
                propertySchemaByClass = message.propertySchemaByClass || {};
                calculateCommonProperties();
                renderProperties();
            }
        });
        
        function calculateCommonProperties() {
            if (currentInstances.length === 0) {
                commonProperties = {};
                return;
            }
            
            // Start with properties of first instance
            const first = currentInstances[0];
            const props = { ...first.properties };
            
            // Mark properties that differ as "MIXED"
            for (let i = 1; i < currentInstances.length; i++) {
                const inst = currentInstances[i];
                for (const key in props) {
                    if (props[key] === 'MIXED') continue;
                    
                    if (!inst.properties || !isEqual(inst.properties[key], props[key])) {
                        props[key] = 'MIXED';
                    }
                }
                
                // Remove keys not present in this instance
                for (const key in props) {
                     if (!inst.properties || inst.properties[key] === undefined) {
                         delete props[key];
                     }
                }
            }
            
            commonProperties = props;
        }
        
        function isEqual(a, b) {
            if (a === b) return true;
            if (typeof a !== typeof b) return false;
            if (typeof a === 'object' && a !== null && b !== null) {
                if (a.type !== b.type) return false;
                // Simple deep check for our types
                return JSON.stringify(a) === JSON.stringify(b);
            }
            return false;
        }

        function resolvePropertySchema(propertyName) {
            if (currentInstances.length === 0) return null;

            let merged = null;
            for (const instance of currentInstances) {
                const classSchema = propertySchemaByClass[instance.className];
                if (!classSchema || !Array.isArray(classSchema.properties)) {
                    return null;
                }

                const propSchema = classSchema.properties.find(p => p.name === propertyName);
                if (!propSchema) {
                    return null;
                }

                if (!merged) {
                    merged = { ...propSchema };
                } else {
                    merged.writable = merged.writable && !!propSchema.writable;
                    if (merged.kind !== propSchema.kind) {
                        merged.kind = 'unknown';
                    }
                }
            }

            return merged;
        }

        function renderReadonlyValue(value) {
            if (value === null || value === undefined) {
                return 'nil';
            }
            if (typeof value === 'string') {
                return escapeHtml(value);
            }
            if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
            }
            try {
                return escapeHtml(JSON.stringify(value));
            } catch (_error) {
                return escapeHtml(String(value));
            }
        }
        
        function updateProperty(name, value) {
            if (currentInstances.length === 0) return;
            const schema = resolvePropertySchema(name);
            if (schema && schema.writable === false) return;
            
            // Optimistic update
            for (const inst of currentInstances) {
                if (!inst.properties) inst.properties = {};
                inst.properties[name] = value;
            }
            calculateCommonProperties(); // Re-calc to clear MIXED status
            
            vscode.postMessage({
                type: 'updateProperty',
                property: name,
                value: value
            });
        }
        
        function updateVectorComponent(propName, component, value, type) {
            if (currentInstances.length === 0) return;
            
            const currentMixed = commonProperties[propName] === 'MIXED';
            let baseVal;
            
            if (currentMixed) {
                // If mixed, we need a base. Ideally we'd use the first instance's val
                // but if we are editing 'x', we might not want to touch 'y'
                // This is tricky. For now, let's just take the first instance value
                // and overwrite others. Or we can try to only update the component.
                // But passing 'partial' updates back to extension is harder.
                // Let's grab first instance value as base.
                 baseVal = currentInstances[0].properties[propName];
            } else {
                 baseVal = commonProperties[propName];
            }
            
            const newVal = { ...baseVal }; 
            newVal[component] = parseFloat(value);
            
            updateProperty(propName, newVal);
        }
        
        function updateUDim(propName, component, value) {
             const baseVal = commonProperties[propName] === 'MIXED' ? currentInstances[0].properties[propName] : commonProperties[propName];
             const newVal = { ...baseVal };
             newVal[component] = parseFloat(value);
             updateProperty(propName, newVal);
        }

        function updateUDim2(propName, axis, component, value) {
             const baseVal = commonProperties[propName] === 'MIXED' ? currentInstances[0].properties[propName] : commonProperties[propName];
             const newVal = { ...baseVal };
             if (axis === 'x') {
                 newVal.x = { ...newVal.x, [component]: parseFloat(value) };
             } else {
                 newVal.y = { ...newVal.y, [component]: parseFloat(value) };
             }
             updateProperty(propName, newVal);
        }
        
        function updateColor(propName, hex) {
            const r = parseInt(hex.substr(1, 2), 16) / 255;
            const g = parseInt(hex.substr(3, 2), 16) / 255;
            const b = parseInt(hex.substr(5, 2), 16) / 255;
            
            const newVal = { type: 'Color3', r, g, b };
            updateProperty(propName, newVal);
        }

        function updateNumberRange(propName, component, value) {
            const baseVal = commonProperties[propName] === 'MIXED' ? currentInstances[0].properties[propName] : commonProperties[propName];
            const newVal = { ...baseVal };
            if (component === 'min') {
                newVal.min = parseFloat(value);
            } else {
                newVal.max = parseFloat(value);
            }
            updateProperty(propName, newVal);
        }

        function updateEnum(propName, enumType, enumValue, rawInput) {
            const input = String(rawInput || '').trim();
            if (!input) return;

            const enumName = input.includes('.') ? input.split('.').pop() : input;
            updateProperty(propName, {
                type: 'Enum',
                enumType: enumType,
                value: enumValue,
                name: enumName
            });
        }

        function renderProperties() {
            const content = document.getElementById('content');

            if (currentInstances.length === 0) {
                content.innerHTML = '<div class="no-selection">Select an instance to view properties</div>';
                return;
            }

            let html = '<div class="section">';
            
            if (currentInstances.length === 1) {
                const instance = currentInstances[0];
                html += '<h3>' + escapeHtml(instance.name);
                html += '<span class="class-badge">' + escapeHtml(instance.className) + '</span>';
                html += '</h3>';
            } else {
                html += '<h3>' + currentInstances.length + ' instances selected</h3>';
            }
            html += '</div>';

            // Properties section
            html += '<div class="section">';
            html += '<div class="section-title">Properties</div>';

            const propKeys = Object.keys(commonProperties).sort();

            if (propKeys.length === 0) {
                html += '<div class="no-selection">No common properties</div>';
            } else {
                for (const key of propKeys) {
                    const value = commonProperties[key];
                    html += '<div class="property-row">';
                    html += '<span class="property-name" title="' + escapeHtml(key) + '">' + escapeHtml(key) + '</span>';
                    html += '<div class="property-value">' + renderInput(key, value) + '</div>';
                    html += '</div>';
                }
            }

            html += '</div>';

            // Children section only for single selection for now
            if (currentInstances.length === 1) {
                const instance = currentInstances[0];
                if (instance.children && instance.children.length > 0) {
                    html += '<div class="section">';
                    html += '<div class="section-title">Children (' + instance.children.length + ')</div>';

                    for (const child of instance.children.slice(0, 10)) {
                        html += '<div class="property-row">';
                        html += '<span class="property-name">' + escapeHtml(child.name) + '</span>';
                        html += '<span class="property-value" style="color: var(--vscode-descriptionForeground)">' + escapeHtml(child.className) + '</span>';
                        html += '</div>';
                    }

                    if (instance.children.length > 10) {
                        html += '<div class="no-selection">... and ' + (instance.children.length - 10) + ' more</div>';
                    }

                    html += '</div>';
                }
            }

            content.innerHTML = html;
        }

        function buildNumericInputAttributes(schema) {
            if (!schema || !schema.numericConstraint) return 'step="any"';
            const attrs = [];
            const constraint = schema.numericConstraint;
            if (typeof constraint.min === 'number') {
                attrs.push('min="' + constraint.min + '"');
            }
            if (typeof constraint.max === 'number') {
                attrs.push('max="' + constraint.max + '"');
            }
            const step = constraint.integer ? 1 : 'any';
            attrs.push('step="' + step + '"');
            return attrs.join(' ');
        }

        function buildStringInputAttributes(schema) {
            if (!schema || !schema.stringConstraint) return '';
            const attrs = [];
            const constraint = schema.stringConstraint;
            if (typeof constraint.minLength === 'number') {
                attrs.push('minlength="' + constraint.minLength + '"');
            }
            if (typeof constraint.maxLength === 'number') {
                attrs.push('maxlength="' + constraint.maxLength + '"');
            }
            if (typeof constraint.pattern === 'string' && constraint.pattern.length > 0) {
                attrs.push('pattern="' + escapeAttribute(constraint.pattern) + '"');
            }
            return attrs.join(' ');
        }

        function buildSchemaTooltip(schema) {
            if (!schema) return '';
            const chunks = [];
            if (schema.numericConstraint) {
                const c = schema.numericConstraint;
                const parts = [];
                if (typeof c.min === 'number') parts.push('min=' + c.min);
                if (typeof c.max === 'number') parts.push('max=' + c.max);
                if (c.integer) parts.push('integer');
                if (parts.length > 0) chunks.push('number(' + parts.join(', ') + ')');
            }
            if (schema.stringConstraint) {
                const c = schema.stringConstraint;
                const parts = [];
                if (typeof c.minLength === 'number') parts.push('minLen=' + c.minLength);
                if (typeof c.maxLength === 'number') parts.push('maxLen=' + c.maxLength);
                if (c.nonEmpty) parts.push('nonEmpty');
                if (parts.length > 0) chunks.push('string(' + parts.join(', ') + ')');
            }
            if (schema.enumConstraint && Array.isArray(schema.enumConstraint.allowedNames) && schema.enumConstraint.allowedNames.length > 0) {
                chunks.push('enum options: ' + schema.enumConstraint.allowedNames.slice(0, 5).join(', '));
            }
            return chunks.join(' | ');
        }

        function makeDomId(rawValue) {
            return String(rawValue || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        }

        function renderInput(key, value) {
            if (value === 'MIXED') {
                 return '<div class="mixed-value">&lt;Multiple Values&gt;</div>';
            }
            
            if (value === null || value === undefined) {
                return '<span style="opacity: 0.5">nil</span>';
            }

            const schema = resolvePropertySchema(key);
            const schemaTooltip = buildSchemaTooltip(schema);
            if (schema && schema.writable === false) {
                return '<span style="opacity: 0.7; font-size: 11px">' + renderReadonlyValue(value)
                    + ' <span style="opacity:0.6">(Read-only: schema)</span></span>';
            }

            if (typeof value === 'boolean') {
                const checked = value ? 'checked' : '';
                const title = schemaTooltip ? ' title="' + escapeAttribute(schemaTooltip) + '"' : '';
                return '<input type="checkbox" ' + checked + title + ' onchange="updateProperty(\\'' + key + '\\', this.checked)">';
            }

            if (typeof value === 'number') {
                const numericAttrs = buildNumericInputAttributes(schema);
                const title = schemaTooltip ? ' title="' + escapeAttribute(schemaTooltip) + '"' : '';
                return '<input type="number" ' + numericAttrs + ' value="' + value + '"' + title + ' onchange="updateProperty(\\'' + key + '\\', parseFloat(this.value))">';
            }

            if (typeof value === 'string') {
                const stringAttrs = buildStringInputAttributes(schema);
                const title = schemaTooltip ? ' title="' + escapeAttribute(schemaTooltip) + '"' : '';
                return '<input type="text" ' + stringAttrs + ' value="' + escapeHtml(value) + '"' + title + ' onchange="updateProperty(\\'' + key + '\\', this.value)">';
            }

            if (typeof value === 'object') {
                if (value.type === 'Vector3') {
                     return '<div class="vector-inputs">' +
                        '<input type="number" step="any" value="' + value.x + '" onchange="updateVectorComponent(\\'' + key + '\\', \\'x\\', this.value, \\'Vector3\\')">' +
                        '<input type="number" step="any" value="' + value.y + '" onchange="updateVectorComponent(\\'' + key + '\\', \\'y\\', this.value, \\'Vector3\\')">' +
                        '<input type="number" step="any" value="' + value.z + '" onchange="updateVectorComponent(\\'' + key + '\\', \\'z\\', this.value, \\'Vector3\\')">' +
                        '</div>';
                }
                if (value.type === 'Vector2') {
                     return '<div class="vector-inputs">' +
                        '<input type="number" step="any" value="' + value.x + '" onchange="updateVectorComponent(\\'' + key + '\\', \\'x\\', this.value, \\'Vector2\\')">' +
                        '<input type="number" step="any" value="' + value.y + '" onchange="updateVectorComponent(\\'' + key + '\\', \\'y\\', this.value, \\'Vector2\\')">' +
                        '</div>';
                }
                if (value.type === 'Color3') {
                    const r = Math.round(value.r * 255);
                    const g = Math.round(value.g * 255);
                    const b = Math.round(value.b * 255);
                    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
                    // Color input
                    return '<div style="display: flex; align-items: center; width: 100%">' + 
                           '<input type="color" value="' + hex + '" style="width: 30px; padding: 0; margin-right: 4px; border: none; height: 20px;" onchange="updateColor(\\'' + key + '\\', this.value)">' +
                           '<span style="font-family: monospace">' + hex + '</span>' + 
                           '</div>';
                }
                if (value.type === 'UDim') {
                    return '<div class="vector-inputs">' +
                        '<input type="number" step="any" value="' + value.scale + '" placeholder="S" onchange="updateUDim(\\'' + key + '\\', \\'scale\\', this.value)">' +
                        '<input type="number" step="1" value="' + value.offset + '" placeholder="O" onchange="updateUDim(\\'' + key + '\\', \\'offset\\', this.value)">' +
                        '</div>';
                }
                if (value.type === 'UDim2') {
                    return '<div style="display:flex; flex-direction:column; gap:2px; width:100%">' +
                        '<div class="udim-group"><span>X</span>' +
                        '<input type="number" step="any" value="' + value.x.scale + '" placeholder="S" onchange="updateUDim2(\\'' + key + '\\', \\'x\\', \\'scale\\', this.value)">' +
                        '<input type="number" step="1" value="' + value.x.offset + '" placeholder="O" onchange="updateUDim2(\\'' + key + '\\', \\'x\\', \\'offset\\', this.value)">' +
                        '</div>' +
                        '<div class="udim-group"><span>Y</span>' +
                        '<input type="number" step="any" value="' + value.y.scale + '" placeholder="S" onchange="updateUDim2(\\'' + key + '\\', \\'y\\', \\'scale\\', this.value)">' +
                        '<input type="number" step="1" value="' + value.y.offset + '" placeholder="O" onchange="updateUDim2(\\'' + key + '\\', \\'y\\', \\'offset\\', this.value)">' +
                        '</div>' +
                        '</div>';
                }
                
                if (value.type === 'CFrame') {
                    // Just show position for now to accept edit (full CFrame matrix edit is complex)
                    const pos = value.position;
                    return '<div style="font-size: 11px">' + 
                           'Pos: ' + pos.x.toFixed(2) + ', ' + pos.y.toFixed(2) + ', ' + pos.z.toFixed(2) + 
                           ' <span style="opacity:0.6">(Read-only)</span></div>';
                }

                if (value.type === 'NumberRange') {
                    return '<div class="vector-inputs">' +
                        '<input type="number" step="any" value="' + value.min + '" placeholder="Min" onchange="updateNumberRange(\\'' + key + '\\', \\'min\\', this.value)">' +
                        '<input type="number" step="any" value="' + value.max + '" placeholder="Max" onchange="updateNumberRange(\\'' + key + '\\', \\'max\\', this.value)">' +
                        '</div>';
                }

                if (value.type === 'Enum') {
                    const enumType = escapeHtml(value.enumType || '');
                    const enumName = escapeHtml(value.name || '');
                    const display = enumType ? (enumType + '.' + enumName) : enumName;
                    const enumValue = typeof value.value === 'number' ? value.value : 0;
                    const allowedNames = schema && schema.enumConstraint && Array.isArray(schema.enumConstraint.allowedNames)
                        ? schema.enumConstraint.allowedNames
                        : [];
                    const title = schemaTooltip ? ' title="' + escapeAttribute(schemaTooltip) + '"' : '';
                    if (allowedNames.length > 0) {
                        const listId = 'enum_' + makeDomId(key + '_' + enumType);
                        let options = '';
                        for (const optionName of allowedNames.slice(0, 200)) {
                            const optionDisplay = enumType ? enumType + '.' + optionName : optionName;
                            options += '<option value="' + escapeHtml(optionDisplay) + '"></option>';
                        }
                        return '<div style="display:flex; flex-direction:column; gap:2px; width:100%">' +
                            '<input type="text" list="' + listId + '" value="' + display + '"' + title + ' onchange="updateEnum(\\'' + key + '\\', \\''
                            + enumType + '\\', ' + enumValue + ', this.value)">' +
                            '<datalist id="' + listId + '">' + options + '</datalist>' +
                            '</div>';
                    }
                    return '<input type="text" value="' + display + '"' + title + ' onchange="updateEnum(\\'' + key + '\\', \\''
                        + enumType + '\\', ' + enumValue + ', this.value)">';
                }

                if (value.type === 'InstanceRef') {
                    return '<span style="opacity: 0.7; font-size: 11px">' + escapeHtml(value.path || '') + ' <span style="opacity:0.6">(Read-only)</span></span>';
                }

                if (value.type === 'Unsupported') {
                    return '<span style="opacity: 0.7; font-size: 11px">' + escapeHtml(value.robloxType || 'Unsupported') + ': ' + escapeHtml(String(value.value || '')) + '</span>';
                }
                
                // Read-only fallback for other complex types
                return '<span style="opacity: 0.7; font-size: 11px">' + JSON.stringify(value) + '</span>';
            }

            return String(value);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function escapeAttribute(text) {
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;');
        }
    </script>
</body>
</html>`;
    }
}
