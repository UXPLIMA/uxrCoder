#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 34872;
const DEFAULT_TIMEOUT_MS = 3000;

function printUsage() {
    console.log('Usage: npm run agent:init -- [--project <path>] [--base-url <url>] [--force]');
}

function normalizeBaseUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, '');
}

function isPrivateIpv4(ip) {
    return ip.startsWith('10.')
        || ip.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

function getLanIpv4Addresses() {
    const result = [];
    const networks = os.networkInterfaces();
    for (const entries of Object.values(networks)) {
        if (!entries) {
            continue;
        }
        for (const entry of entries) {
            if (!entry || entry.family !== 'IPv4' || entry.internal) {
                continue;
            }
            if (isPrivateIpv4(entry.address)) {
                result.push(entry.address);
            }
        }
    }
    return result;
}

function parseArgs(argv) {
    const options = {
        projectPath: process.cwd(),
        baseUrl: '',
        force: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--project') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--project requires a path value');
            }
            options.projectPath = value;
            i += 1;
            continue;
        }
        if (arg === '--base-url') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--base-url requires a URL value');
            }
            options.baseUrl = value;
            i += 1;
            continue;
        }
        if (arg === '--force') {
            options.force = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

async function probeHealth(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const healthUrl = `${baseUrl}/health`;
        const response = await fetch(healthUrl, {
            method: 'GET',
            signal: controller.signal,
        });
        if (!response.ok) {
            return {
                ok: false,
                baseUrl,
                error: `HTTP ${response.status}`,
            };
        }
        const payload = await response.json();
        if (!payload || payload.status !== 'ok') {
            return {
                ok: false,
                baseUrl,
                error: 'Invalid health payload',
            };
        }
        return {
            ok: true,
            baseUrl,
            payload,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            baseUrl,
            error: message,
        };
    } finally {
        clearTimeout(timer);
    }
}

function buildCandidateBaseUrls(explicitBaseUrl) {
    const candidates = [];
    if (explicitBaseUrl) {
        candidates.push(normalizeBaseUrl(explicitBaseUrl));
    }
    if (process.env.UXR_AGENT_BASE_URL) {
        candidates.push(normalizeBaseUrl(process.env.UXR_AGENT_BASE_URL));
    }

    candidates.push(`http://127.0.0.1:${DEFAULT_PORT}`);
    candidates.push(`http://localhost:${DEFAULT_PORT}`);

    const lanIps = getLanIpv4Addresses();
    for (const ip of lanIps) {
        candidates.push(`http://${ip}:${DEFAULT_PORT}`);
    }

    return [...new Set(candidates)];
}

function renderTemplate(template, baseUrl) {
    const replacement = `Base URL: \`${baseUrl}\``;
    if (/^Base URL:\s*`[^`]+`$/m.test(template)) {
        return template.replace(/^Base URL:\s*`[^`]+`$/m, replacement);
    }
    return `${template.trimEnd()}\n\n${replacement}\n`;
}

async function ensureDirectoryExists(targetPath) {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
        throw new Error(`Project path is not a directory: ${targetPath}`);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const projectPath = path.resolve(options.projectPath);
    await ensureDirectoryExists(projectPath);

    const candidates = buildCandidateBaseUrls(options.baseUrl);
    const attempts = [];
    let winner = null;

    for (const candidate of candidates) {
        const result = await probeHealth(candidate);
        attempts.push(result);
        if (result.ok) {
            winner = result;
            break;
        }
    }

    if (!winner) {
        console.error('No reachable uxrCoder server found.');
        console.error('Tried base URLs:');
        for (const attempt of attempts) {
            console.error(`- ${attempt.baseUrl} (${attempt.error})`);
        }
        console.error('');
        console.error('Fix checklist:');
        console.error('1) Start server: npm run dev');
        console.error('2) For external/sandboxed agents use HOST=0.0.0.0');
        console.error('3) Use --base-url http://<LAN_IP>:34872');
        process.exit(1);
    }

    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, '..');
    const templatePath = path.join(repoRoot, 'docs', 'AGENTS_TEMPLATE.md');
    const targetPath = path.join(projectPath, 'AGENTS.md');

    const template = await fs.readFile(templatePath, 'utf8');
    const rendered = renderTemplate(template, winner.baseUrl);

    let targetExists = false;
    try {
        await fs.access(targetPath);
        targetExists = true;
    } catch {
        targetExists = false;
    }

    if (targetExists && !options.force) {
        console.error(`AGENTS.md already exists at ${targetPath}`);
        console.error('Use --force to overwrite.');
        process.exit(2);
    }

    await fs.writeFile(targetPath, rendered, 'utf8');

    console.log(`AGENTS.md written: ${targetPath}`);
    console.log(`Detected server: ${winner.baseUrl}`);
    console.log(`Health version: ${winner.payload?.version ?? 'unknown'}`);
    console.log('');
    console.log('First prompt example:');
    console.log('Read AGENTS.md and implement <feature>, then run tests and report run ID + final status.');
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`agent:init failed: ${message}`);
    process.exit(1);
});
