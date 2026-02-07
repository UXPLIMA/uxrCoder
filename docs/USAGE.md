# Usage Guide

Learn how to effectively use uxrCoder in your daily development workflow.

## Common Workflows

### 1. Editing Scripts
Double-click any script in the Roblox Explorer tree view in VS Code. This will open the locally mapped file. Any changes you save will be instantly synchronized back to Roblox Studio.

### 2. Managing Instances
Right-click on any instance in the Explorer to:
- **Insert Object**: Add a new child to the selected instance.
- **Rename**: Change the name of the instance (updates both FS and Studio).
- **Delete**: Safely remove the instance.
- **Copy Path**: Get the full Roblox path (e.g., `ReplicatedStorage.Utils.Math`).

### 3. Property Editing
Select an instance in the Explorer to view its properties in the **Roblox Properties** panel. Modify values like Position, Color, and Transparency, and see the changes reflected in Studio in real-time.

## Pro-Tips

### [TIP] AI-Assisted Coding
Use **Antigravity** or **GitHub Copilot** on the mapped `.lua` files. Since the files are local and structured properly, AI models have the context of your entire project, providing much better completions than the internal Studio editor.

### [TIP] Auto-Resync
If the server restarts or you briefly lose connection, the Roblox plugin will detect the state loss and automatically re-initiate a full synchronization.

### [TIP] Version Control
Use **Git** to track your project's `src/` folder. uxrCoder ensures your file system remains the single source of truth for your code and metadata.

## FAQs

### Why is my Explorer empty?
Check if the Sync Server is running and if the Roblox plugin is toggled "ENABLED". Ensure the `uxrcoder.project.json` path mapping is correct.

### Can I use Rojo with uxrCoder?
uxrCoder is designed as a standalone alternative but follows similar file mapping principles. It is recommended to use one or the other to avoid sync loops.
