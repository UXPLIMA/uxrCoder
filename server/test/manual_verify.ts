
import { SyncEngine } from '../src/syncEngine';
import { RobloxInstance } from '../src/types';

async function main() {
    console.log('Starting manual verification...');
    const syncEngine = new SyncEngine();

    // Setup initial state:
    // Workspace
    //   FolderA
    //     Part1
    //   FolderB

    const instances: RobloxInstance[] = [
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
    console.log('Initial state set.');

    // Move Part1 from FolderA to FolderB
    console.log('Applying reparent change...');
    try {
        syncEngine.applyChange({
            type: 'reparent',
            timestamp: Date.now(),
            path: ['Workspace', 'FolderA', 'Part1'],
            newParentPath: ['Workspace', 'FolderB']
        });
    } catch (e) {
        console.error('Error applying change:', e);
        process.exit(1);
    }

    // Verify Part1 is now reachable via new path
    const part = syncEngine.getInstance(['Workspace', 'FolderB', 'Part1']);
    if (part && part.name === 'Part1') {
        console.log('✅ Part1 found at new path.');
    } else {
        console.error('❌ Part1 NOT found at new path.');
        process.exit(1);
    }

    // Verify it's gone from old path
    const oldPart = syncEngine.getInstance(['Workspace', 'FolderA', 'Part1']);
    if (!oldPart) {
        console.log('✅ Part1 gone from old path.');
    } else {
        console.error('❌ Part1 still exists at old path.');
        process.exit(1);
    }

    // Verify tree structure
    const folderB = syncEngine.getInstance(['Workspace', 'FolderB']);
    if (folderB?.children?.length === 1 && folderB.children[0].name === 'Part1') {
        console.log('✅ FolderB has correct children.');
    } else {
        console.error('❌ FolderB children incorrect:', folderB?.children?.map(c => c.name));
        process.exit(1);
    }

    const folderA = syncEngine.getInstance(['Workspace', 'FolderA']);
    if (folderA?.children?.length === 0) {
        console.log('✅ FolderA has correct children (empty).');
    } else {
        console.error('❌ FolderA children incorrect:', folderA?.children?.map(c => c.name));
        process.exit(1);
    }

    console.log('--- Nested Reparenting Test ---');

    // Setup nested structure: FolderA -> SubFolder -> Part
    const subFolder: RobloxInstance = {
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
    };

    // Manually inject
    const folderA_new = syncEngine.getInstance(['Workspace', 'FolderA']);
    if (folderA_new && folderA_new.children) {
        folderA_new.children.push(subFolder);
    }

    // Re-sync to flatten map
    syncEngine.updateFromPlugin(syncEngine.getAllInstances());

    console.log('Applying nested reparent change...');
    syncEngine.applyChange({
        type: 'reparent',
        timestamp: Date.now(),
        path: ['Workspace', 'FolderA', 'SubFolder'],
        newParentPath: ['Workspace', 'FolderB']
    });

    // Verify SubFolder moved
    if (syncEngine.getInstance(['Workspace', 'FolderB', 'SubFolder'])) {
        console.log('✅ SubFolder moved correctly.');
    } else {
        console.error('❌ SubFolder failed to move.');
        process.exit(1);
    }

    // Verify DeepPart path updated
    if (syncEngine.getInstance(['Workspace', 'FolderB', 'SubFolder', 'DeepPart'])) {
        console.log('✅ DeepPart path updated correctly.');
    } else {
        console.error('❌ DeepPart path NOT updated.');
        process.exit(1);
    }

    if (!syncEngine.getInstance(['Workspace', 'FolderA', 'SubFolder', 'DeepPart'])) {
        console.log('✅ Old DeepPart path gone.');
    } else {
        console.error('❌ Old DeepPart path still exists.');
        process.exit(1);
    }

    console.log('🎉 All manual verification tests passed!');
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
