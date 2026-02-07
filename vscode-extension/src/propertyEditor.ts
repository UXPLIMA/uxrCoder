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
import type { RobloxInstance, PropertyValue } from './types';
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

    /** Currently displayed instance */
    private _currentInstance?: RobloxInstance;

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
     * Show properties for a tree item.
     *
     * @param item - The tree item to show properties for
     */
    showProperties(item: RobloxTreeItem): void {
        this._currentInstance = item.instance;
        this.updateView();
    }

    /**
     * Update the webview with current instance properties.
     */
    private updateView(): void {
        if (!this._view || !this._currentInstance) {
            return;
        }

        this._view.webview.postMessage({
            type: 'update',
            instance: this._currentInstance,
        });
    }

    /**
     * Handle messages from the webview.
     *
     * @param message - The message from the webview
     */
    private handleWebviewMessage(message: { type: string; property?: string; value?: PropertyValue }): void {
        if (message.type === 'updateProperty' && this._currentInstance) {
            // TODO: Implement property editing
            console.log(`Update property: ${message.property} = ${message.value}`);
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
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 4px 0;
        }

        .property-name {
            flex: 0 0 40%;
            color: var(--vscode-symbolIcon-propertyForeground, #4fc1ff);
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .property-value {
            flex: 1;
            color: var(--vscode-foreground);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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

        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;

            if (message.type === 'update') {
                renderProperties(message.instance);
            }
        });

        function renderProperties(instance) {
            const content = document.getElementById('content');

            if (!instance) {
                content.innerHTML = '<div class="no-selection">Select an instance to view properties</div>';
                return;
            }

            let html = '<div class="section">';
            html += '<h3>' + escapeHtml(instance.name);
            html += '<span class="class-badge">' + escapeHtml(instance.className) + '</span>';
            html += '</h3>';
            html += '</div>';

            // Properties section
            html += '<div class="section">';
            html += '<div class="section-title">Properties</div>';

            const props = instance.properties || {};
            const propKeys = Object.keys(props).sort();

            if (propKeys.length === 0) {
                html += '<div class="no-selection">No properties</div>';
            } else {
                for (const key of propKeys) {
                    const value = props[key];
                    html += '<div class="property-row">';
                    html += '<span class="property-name">' + escapeHtml(key) + '</span>';
                    html += '<span class="property-value">' + formatValue(value) + '</span>';
                    html += '</div>';
                }
            }

            html += '</div>';

            // Children section
            if (instance.children && instance.children.length > 0) {
                html += '<div class="section">';
                html += '<div class="section-title">Children (' + instance.children.length + ')</div>';

                for (const child of instance.children.slice(0, 10)) {
                    html += '<div class="property-row">';
                    html += '<span class="property-name">' + escapeHtml(child.name) + '</span>';
                    html += '<span class="property-value">' + escapeHtml(child.className) + '</span>';
                    html += '</div>';
                }

                if (instance.children.length > 10) {
                    html += '<div class="no-selection">... and ' + (instance.children.length - 10) + ' more</div>';
                }

                html += '</div>';
            }

            content.innerHTML = html;
        }

        function formatValue(value) {
            if (value === null || value === undefined) {
                return '<span style="opacity: 0.5">nil</span>';
            }

            if (typeof value === 'boolean') {
                return value ? '✓ true' : '✗ false';
            }

            if (typeof value === 'number') {
                return value.toFixed ? value.toFixed(3).replace(/\\.?0+$/, '') : String(value);
            }

            if (typeof value === 'string') {
                const maxLen = 50;
                const display = value.length > maxLen ? value.substring(0, maxLen) + '...' : value;
                return escapeHtml(display);
            }

            if (typeof value === 'object') {
                if (value.type === 'Vector3') {
                    return '(' + value.x.toFixed(2) + ', ' + value.y.toFixed(2) + ', ' + value.z.toFixed(2) + ')';
                }
                if (value.type === 'Color3') {
                    const r = Math.round(value.r * 255);
                    const g = Math.round(value.g * 255);
                    const b = Math.round(value.b * 255);
                    return '<span style="background: rgb(' + r + ',' + g + ',' + b + '); display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 4px; vertical-align: middle;"></span>RGB(' + r + ', ' + g + ', ' + b + ')';
                }
                if (value.type === 'UDim2') {
                    return '{' + value.xScale + ', ' + value.xOffset + '}, {' + value.yScale + ', ' + value.yOffset + '}';
                }
                return JSON.stringify(value);
            }

            return String(value);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }
}
