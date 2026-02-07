/**
 * @fileoverview Class Database - Manages Roblox API class information.
 */

export interface ClassInfo {
    name: string;
    description: string;
    category: string;
    icon?: string;
}

export class ClassDatabase {
    private classes: ClassInfo[] = [
        // Common
        { name: 'Part', description: 'A basic 3D primitive', category: '3D Objects', icon: 'part' },
        { name: 'Model', description: 'A container for 3D objects', category: '3D Objects', icon: 'model' },
        { name: 'Folder', description: 'A container for organizing objects', category: 'General', icon: 'folder' },
        { name: 'Script', description: 'A server-side script', category: 'Scripting', icon: 'script' },
        { name: 'LocalScript', description: 'A client-side script', category: 'Scripting', icon: 'localscript' },
        { name: 'ModuleScript', description: 'A reusable code module', category: 'Scripting', icon: 'modulescript' },

        // 3D
        { name: 'MeshPart', description: 'A 3D mesh object', category: '3D Objects', icon: 'meshpart' },
        { name: 'TrussPart', description: 'A truss part', category: '3D Objects' },
        { name: 'WedgePart', description: 'A wedge part', category: '3D Objects' },
        { name: 'CornerWedgePart', description: 'A corner wedge part', category: '3D Objects' },
        { name: 'SpawnLocation', description: 'Where players spawn', category: 'Gameplay' },

        // GUI
        { name: 'ScreenGui', description: 'A 2D GUI container', category: 'GUI', icon: 'screengui' },
        { name: 'Frame', description: 'A rectangular container', category: 'GUI', icon: 'frame' },
        { name: 'TextLabel', description: 'Displays text', category: 'GUI', icon: 'textlabel' },
        { name: 'TextButton', description: 'A button with text', category: 'GUI', icon: 'textbutton' },
        { name: 'ImageLabel', description: 'Displays an image', category: 'GUI', icon: 'imagelabel' },
        { name: 'ImageButton', description: 'A button with an image', category: 'GUI', icon: 'imagebutton' },
        { name: 'ScrollingFrame', description: 'A scrollable frame', category: 'GUI' },
        { name: 'TextBox', description: 'Input text field', category: 'GUI' },
        { name: 'SurfaceGui', description: 'GUI on 3D surfaces', category: 'GUI' },
        { name: 'BillboardGui', description: 'GUI that faces the camera', category: 'GUI' },

        // Effects
        { name: 'ParticleEmitter', description: 'Emits particles', category: 'Effects' },
        { name: 'Trail', description: 'Creates a trail', category: 'Effects' },
        { name: 'Beam', description: 'Creates a beam', category: 'Effects' },
        { name: 'PointLight', description: 'Emits light from a point', category: 'Effects' },
        { name: 'SpotLight', description: 'Emits a cone of light', category: 'Effects' },
        { name: 'SurfaceLight', description: 'Emits light from a surface', category: 'Effects' },

        // Constraints
        { name: 'HingeConstraint', description: 'Constrains two attachments to rotate around an axis', category: 'Constraints' },
        { name: 'BallSocketConstraint', description: 'Constrains two attachments to rotate freely', category: 'Constraints' },
        { name: 'PrismaticConstraint', description: 'Constrains two attachments to slide along an axis', category: 'Constraints' },
        { name: 'RopeConstraint', description: 'Constrains two attachments with a rope', category: 'Constraints' },
        { name: 'SpringConstraint', description: 'Constrains two attachments with a spring', category: 'Constraints' },

        // Value Objects
        { name: 'StringValue', description: 'Stores a string', category: 'Values' },
        { name: 'IntValue', description: 'Stores an integer', category: 'Values' },
        { name: 'NumberValue', description: 'Stores a number', category: 'Values' },
        { name: 'BoolValue', description: 'Stores a boolean', category: 'Values' },
        { name: 'ObjectValue', description: 'Stores a reference to an object', category: 'Values' },
        { name: 'CFrameValue', description: 'Stores a CFrame', category: 'Values' },
        { name: 'Vector3Value', description: 'Stores a Vector3', category: 'Values' },
        { name: 'Color3Value', description: 'Stores a Color3', category: 'Values' },

        // Networking
        { name: 'RemoteEvent', description: 'Network event', category: 'Networking' },
        { name: 'RemoteFunction', description: 'Network function', category: 'Networking' },
        { name: 'BindableEvent', description: 'Local event', category: 'Networking' },
        { name: 'BindableFunction', description: 'Local function', category: 'Networking' },

        // Sound
        { name: 'Sound', description: 'Plays audio', category: 'Audio' },
        { name: 'SoundGroup', description: 'Groups sounds', category: 'Audio' },

        // Animation
        { name: 'Animation', description: 'Stores animation data', category: 'Animation' },
        { name: 'AnimationController', description: 'Controls animations', category: 'Animation' },
        { name: 'Animator', description: 'Manages animation playback', category: 'Animation' },
    ];

    /**
     * Get all classes.
     */
    public getAllClasses(): ClassInfo[] {
        return this.classes.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Search for classes by name or category.
     */
    public searchClasses(query: string): ClassInfo[] {
        const lowerQuery = query.toLowerCase();
        return this.classes.filter(c =>
            c.name.toLowerCase().includes(lowerQuery) ||
            c.category.toLowerCase().includes(lowerQuery)
        ).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get classes by category.
     */
    public getClassesByCategory(category: string): ClassInfo[] {
        return this.classes.filter(c => c.category === category).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get all categories.
     */
    public getCategories(): string[] {
        const categories = new Set(this.classes.map(c => c.category));
        return Array.from(categories).sort();
    }
}
