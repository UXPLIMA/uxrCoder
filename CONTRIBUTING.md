# Contributing to uxrCoder

Thank you for your interest in contributing to uxrCoder! This document provides guidelines and instructions for contributing.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)

## 📜 Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Be kind, constructive, and professional in all interactions.

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/uxrCoder.git
   cd uxrCoder
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/UXPLIMA/uxrCoder.git
   ```

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Roblox Studio (for plugin testing)
- VS Code (for extension testing)

### Installation

```bash
# Install all dependencies
npm run setup

# Or install individually:
cd server && npm install
cd ../vscode-extension && npm install
```

### Running in Development Mode

```bash
# Terminal 1: Start the server
cd server && npm run dev

# Terminal 2: Watch extension compilation
cd vscode-extension && npm run watch

# In VS Code: Press F5 to launch Extension Development Host
```

## ✏️ Making Changes

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our [coding standards](#coding-standards)

3. **Test your changes**:
   ```bash
   npm test
   npm run lint
   ```

4. **Commit your changes** using [conventional commits](#commit-messages)

## 🔄 Pull Request Process

1. **Update documentation** if needed
2. **Ensure all tests pass**
3. **Update CHANGELOG.md** with your changes
4. **Submit the PR** with a clear description
5. **Wait for review** and address any feedback

### PR Checklist

- [ ] Code follows the project's style guidelines
- [ ] Tests added/updated for new functionality
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] All CI checks pass

## 📝 Coding Standards

### TypeScript (Server & Extension)

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions small and focused

```typescript
/**
 * Serializes a Roblox instance to JSON format.
 * @param instance - The instance to serialize
 * @returns Serialized instance data
 */
export function serializeInstance(instance: RobloxInstance): SerializedInstance {
    // Implementation
}
```

### Lua (Roblox Plugin)

- Follow Roblox Lua style guide
- Use descriptive function names
- Comment complex logic
- Handle errors gracefully

```lua
--- Syncs the DataModel with the server.
-- @return boolean success
-- @return string? error message
local function syncWithServer()
    -- Implementation
end
```

## 💬 Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(server): add WebSocket reconnection logic
fix(plugin): resolve nil reference in serialization
docs(readme): update installation instructions
refactor(extension): simplify tree view provider
```

## 🐛 Reporting Bugs

When reporting bugs, please include:

1. **Description**: Clear description of the issue
2. **Steps to Reproduce**: How to reproduce the bug
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**: OS, Node.js version, Roblox Studio version
6. **Logs**: Any relevant error messages

## 💡 Suggesting Features

Feature requests are welcome! Please include:

1. **Use Case**: Why is this feature needed?
2. **Proposed Solution**: How should it work?
3. **Alternatives**: Any alternative approaches considered?

---

Thank you for contributing! 🎉
