
const { SyncEngine } = require('../dist/syncEngine');
const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, '../../verification_result.txt');

function log(msg) {
    try {
        fs.appendFileSync(logFile, msg + '\n');
    } catch (e) { }
    console.log(msg);
}

async function main() {
    try {
        fs.writeFileSync(logFile, 'Starting manual verification (CommonJS with file logging)...\n');
    } catch (e) {
        console.error("Failed to write log file:", e);
    }
    log('Initialized log file.');

    try {
        log('Creating SyncEngine...');
        const syncEngine = new SyncEngine();

        const instances = [
            {
                id: 'root-1',
                className: 'Folder',
                name: 'FolderA',
                parent: 'Workspace',
                properties: {},
                children: [
                    {
                        id: 'child-1',
                        className: 'Part',
                        name: 'Part1',
                        parent: 'Workspace.FolderA',
                        properties: {},
                        children: []
                    }
                ]
            },
            {
                id: 'root-2',
                className: 'Folder',
                name: 'FolderB',
                parent: 'Workspace',
                properties: {},
                children: []
            }
        ];

        syncEngine.updateFromPlugin(instances);
        log('Initial state set.');

        log('Applying reparent change...');
        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            newParentPath: ['Workspace', 'FolderB']
        });

        const part = syncEngine.getInstance(['Workspace', 'FolderB', 'Part1']);
        if (part && part.name === 'Part1') {
            log('✅ Part1 found at new path.');
        } else {
            throw new Error('Part1 NOT found at new path.');
        }

        const oldPart = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
        if (!oldPart) {
            log('✅ Part1 gone from old path.');
        } else {
            throw new Error('Part1 still exists at old path.');
        }

        // Nested test case
        log('--- Nested Reparenting Test ---');
        const instances2 = [
            {
                id: 'root-nested',
                className: 'Folder',
                name: 'FolderA',
                parent: 'Workspace',
                properties: {},
                children: [
                    {
                        id: 'sub-1',
                        className: 'Folder',
                        name: 'SubFolder',
                        parent: 'Workspace.FolderA',
                        properties: {},
                        children: [
                            {
                                id: 'part-deep',
                                className: 'Part',
                                name: 'DeepPart',
                                parent: 'Workspace.FolderA.SubFolder',
                                properties: {},
                                children: []
                            }
                        ]
                    }
                ]
            },
            {
                id: 'root-nested-2',
                className: 'Folder',
                name: 'FolderB',
                parent: 'Workspace',
                properties: {},
                children: []
            }
        ];

        // Reset state for new test
        const syncEngine2 = new SyncEngine();
        syncEngine2.updateFromPlugin(instances2);

        log('Applying nested reparent change...');
        syncEngine2.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'SubFolder'],
            newParentPath: ['Workspace', 'FolderB']
        });

        if (syncEngine2.getInstance(['Workspace', 'FolderB', 'SubFolder'])) {
            log('✅ SubFolder moved correctly.');
        } else {
            throw new Error('SubFolder failed to move.');
        }

        if (syncEngine2.getInstance(['Workspace', 'FolderB', 'SubFolder', 'DeepPart'])) {
            log('✅ DeepPart path updated correctly.');
        } else {
            throw new Error('DeepPart path NOT updated.');
        }

        log('🎉 All passed!');
    } catch (e) {
        log('❌ Error: ' + e.message + '\n' + e.stack);
        process.exit(1);
    }
}

main();
