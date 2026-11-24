'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const compiler = path.join(__dirname, 'node_modules', 'frida-compile', 'dist', 'cli.js');
const outDir = path.join(__dirname, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const agents = [
    ['src/index.ts', 'agent.js'],
    ['src/query.ts', 'query-agent.js'],
    ['src/cmdid/agent.ts', 'cmdid-agent.js']
];

for (const [entry, output] of agents) {
    const result = spawnSync(process.execPath, [compiler, entry, '-o', path.join(outDir, output)], { cwd: __dirname, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    console.log(`Built ${path.join(outDir, output)} from ${entry}`);
}
