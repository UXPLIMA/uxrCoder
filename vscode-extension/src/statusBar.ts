/**
 * @fileoverview Connection status bar item for VS Code extension.
 * 
 * Displays the current connection state to the uxrCoder server.
 * 
 * @author UXPLIMA
 * @license MIT
 */

import * as vscode from 'vscode';
import type { ConnectionStatus } from './syncClient';

export class ConnectionStatusBar {
    private statusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'uxrCoder.connect';
        context.subscriptions.push(this.statusBarItem);

        // precise initialization state
        this.update('disconnected');
        this.statusBarItem.show();
    }

    /**
     * Update the status bar based on connection state.
     */
    update(status: ConnectionStatus, message?: string): void {
        switch (status) {
            case 'connected':
                this.statusBarItem.text = '$(check) uxrCoder: Connected';
                this.statusBarItem.tooltip = 'Connected to local sync server';
                this.statusBarItem.backgroundColor = undefined; // Default color
                this.statusBarItem.command = 'uxrCoder.disconnect';
                break;

            case 'disconnected':
                this.statusBarItem.text = '$(plug) uxrCoder: Disconnected';
                this.statusBarItem.tooltip = 'Click to connect';
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.command = 'uxrCoder.connect';
                break;

            case 'connecting':
                this.statusBarItem.text = '$(sync~spin) uxrCoder: Connecting...';
                this.statusBarItem.tooltip = 'Attempting to connect...';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.statusBarItem.command = 'uxrCoder.disconnect';
                break;

            case 'reconnecting':
                this.statusBarItem.text = `$(sync~spin) uxrCoder: Reconnecting...`;
                this.statusBarItem.tooltip = message || 'Lost connection, attempting to reconnect...';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.statusBarItem.command = 'uxrCoder.disconnect';
                break;

            case 'error':
                this.statusBarItem.text = '$(error) uxrCoder: Error';
                this.statusBarItem.tooltip = message || 'Connection error';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                this.statusBarItem.command = 'uxrCoder.connect';
                break;
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
