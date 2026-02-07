import * as vscode from 'vscode';
import { SyncClient } from './syncClient';
import { ClassDatabase, ClassInfo } from './classDatabase';

export class RobloxClassBrowserProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private classDatabase: ClassDatabase;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly syncClient: SyncClient
    ) {
        this.classDatabase = new ClassDatabase();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'insertClass':
                    this.insertClass(data.className);
                    break;
                case 'search':
                    this.updateList(data.query);
                    break;
            }
        });
    }

    private async insertClass(className: string) {
        // Get selected item in explorer
        // This is tricky because we don't have direct access to the tree view selection here
        // But we can use the command 'robloxSync.insertObject' if we modify it to accept className
        // Or we can just use the currently selected item if accessible.

        // Actually, let's ask the user where to insert if no selection?
        // Or just trigger the existing insert logic.

        // Better approach: Execute command 'robloxSync.insertObject' with the className pre-selected
        // But the command currently prompts for class.
        // We should overload handleInsertObject to accept className.

        vscode.commands.executeCommand('robloxSync.insertObject', undefined, className);
    }

    private updateList(query: string) {
        if (this._view) {
            const classes = query ? this.classDatabase.searchClasses(query) : this.classDatabase.getAllClasses();
            this._view.webview.postMessage({ type: 'updateList', classes });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Initial list
        const classes = this.classDatabase.getAllClasses();
        const classesJson = JSON.stringify(classes);

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Roblox Class Browser</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 10px;
                    }
                    input[type="text"] {
                        width: 100%;
                        padding: 8px;
                        margin-bottom: 10px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        box-sizing: border-box;
                    }
                    .class-list {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                        gap: 10px;
                    }
                    .class-item {
                        background-color: var(--vscode-list-hoverBackground);
                        padding: 10px;
                        cursor: pointer;
                        text-align: center;
                        border-radius: 4px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                    }
                    .class-item:hover {
                        background-color: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }
                    .class-icon {
                        font-size: 24px;
                        margin-bottom: 5px;
                    }
                    .class-name {
                        font-weight: bold;
                        font-size: 12px;
                        word-break: break-word;
                    }
                    .class-category {
                        font-size: 10px;
                        opacity: 0.7;
                    }
                </style>
            </head>
            <body>
                <input type="text" id="search" placeholder="Search classes..." />
                <div class="class-list" id="classList"></div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const searchInput = document.getElementById('search');
                    const classList = document.getElementById('classList');
                    
                    let classes = ${classesJson};

                    function renderClasses(list) {
                        classList.innerHTML = '';
                        list.forEach(cls => {
                            const div = document.createElement('div');
                            div.className = 'class-item';
                            div.onclick = () => {
                                vscode.postMessage({ type: 'insertClass', className: cls.name });
                            };
                            
                            // Simple icon mapping (could be improved)
                            let icon = '📦';
                            if (cls.icon) {
                                // icon = cls.icon; // If we had image assets
                            }
                            
                            div.innerHTML = \`
                                <div class="class-icon">\${icon}</div>
                                <div class="class-name">\${cls.name}</div>
                                <div class="class-category">\${cls.category}</div>
                            \`;
                            div.title = cls.description;
                            classList.appendChild(div);
                        });
                    }

                    renderClasses(classes);

                    searchInput.addEventListener('input', (e) => {
                        const query = e.target.value.toLowerCase();
                        const filtered = classes.filter(c => 
                            c.name.toLowerCase().includes(query) || 
                            c.category.toLowerCase().includes(query)
                        );
                        renderClasses(filtered);
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'updateList':
                                classes = message.classes;
                                renderClasses(classes);
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}
