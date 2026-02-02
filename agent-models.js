#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const args = process.argv.slice(2);
const opencodePath = args[args.indexOf('--opencode') + 1] || 'opencode';
const dryRun = args.includes('--dry-run');

let agents = [];
let models = [];
let selectedAgents = new Set();
let pendingChanges = new Map(); // agent name -> new model
let cursor = 0;
let filter = '';
let mode = 'agents'; // 'agents' or 'models'

const agentsDir = path.join(__dirname, 'agents');

function loadAgents() {
  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const frontmatter = match[1];
      const modelMatch = frontmatter.match(/model:\s*(.+)/);
      return {
        file: f,
        name: f.replace('.md', ''),
        model: modelMatch ? modelMatch[1].trim() : 'none'
      };
    }
    return null;
  }).filter(Boolean);
}

function loadModels() {
  try {
    const output = execSync(`${opencodePath} models`, { encoding: 'utf8' });
    return output.split('\n').filter(l => l.trim() && !l.startsWith('Available'));
  } catch (e) {
    console.error('Failed to load models. Check --opencode path.');
    process.exit(1);
  }
}

function updateAgentModel(agent, model) {
  const filePath = path.join(agentsDir, agent.file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/^(---\n[\s\S]*?model:\s*)(.+)/m, `$1${model}`);
  fs.writeFileSync(filePath, content, 'utf8');
}

function render() {
  console.clear();
  
  if (mode === 'agents') {
    console.log('Controls: Space=toggle, Enter=change model, s=save, q=quit\n');
    if (filter) console.log(`Filter: ${filter}\n`);
    if (pendingChanges.size > 0) console.log(`Pending changes: ${pendingChanges.size}\n`);
    
    const filtered = agents.filter(a => a.name.includes(filter));
    filtered.forEach((agent, i) => {
      const selected = selectedAgents.has(agent.name) ? '✓' : ' ';
      const highlight = i === cursor ? '>' : ' ';
      const pending = pendingChanges.has(agent.name) 
        ? ` → ${pendingChanges.get(agent.name)}` 
        : '';
      console.log(`${highlight} [${selected}] ${agent.name} (${agent.model}${pending})`);
    });
  } else {
    console.log(`Updating ${selectedAgents.size} agent(s). Select model (Enter=apply, Esc=cancel):\n`);
    if (filter) console.log(`Filter: ${filter}\n`);
    
    const filtered = models.filter(m => m.toLowerCase().includes(filter.toLowerCase()));
    filtered.forEach((model, i) => {
      const highlight = i === cursor ? '>' : ' ';
      console.log(`${highlight} ${model}`);
    });
  }
}

function getFiltered() {
  if (mode === 'agents') {
    return agents.filter(a => a.name.includes(filter));
  }
  return models.filter(m => m.toLowerCase().includes(filter.toLowerCase()));
}

agents = loadAgents();
models = loadModels();

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

render();

process.stdin.on('keypress', (str, key) => {
  if (key.name === 'q' && mode === 'agents') {
    process.exit(0);
  }
  
  if (key.name === 's' && mode === 'agents') {
    if (pendingChanges.size === 0) {
      render();
      return;
    }
    console.clear();
    if (dryRun) {
      console.log('DRY RUN - Changes that would be made:\n');
      pendingChanges.forEach((newModel, agentName) => {
        const agent = agents.find(a => a.name === agentName);
        if (agent) {
          console.log(`${agent.name}: ${agent.model} → ${newModel}`);
        }
      });
    } else {
      pendingChanges.forEach((newModel, agentName) => {
        const agent = agents.find(a => a.name === agentName);
        if (agent) updateAgentModel(agent, newModel);
      });
      console.log(`Updated ${pendingChanges.size} agent(s)`);
    }
    process.exit(0);
  }
  
  if (key.name === 'escape' && mode === 'models') {
    mode = 'agents';
    cursor = 0;
    filter = '';
    selectedAgents.clear();
    render();
    return;
  }
  
  if (key.name === 'up') {
    cursor = Math.max(0, cursor - 1);
    render();
  } else if (key.name === 'down') {
    cursor = Math.min(getFiltered().length - 1, cursor + 1);
    render();
  } else if (key.name === 'space' && mode === 'agents') {
    const filtered = getFiltered();
    const agent = filtered[cursor];
    if (agent) {
      if (selectedAgents.has(agent.name)) {
        selectedAgents.delete(agent.name);
      } else {
        selectedAgents.add(agent.name);
      }
      render();
    }
  } else if (key.name === 'return') {
    if (mode === 'agents') {
      if (selectedAgents.size > 0) {
        mode = 'models';
        cursor = 0;
        filter = '';
        render();
      }
    } else {
      const filtered = getFiltered();
      const model = filtered[cursor];
      if (model) {
        selectedAgents.forEach(name => {
          pendingChanges.set(name, model);
        });
        mode = 'agents';
        cursor = 0;
        filter = '';
        selectedAgents.clear();
        render();
      }
    }
  } else if (key.name === 'backspace') {
    filter = filter.slice(0, -1);
    cursor = 0;
    render();
  } else if (key.ctrl && key.name === 'c') {
    process.exit(0);
  } else if (str && str.length === 1 && /[a-z0-9\-\/]/i.test(str)) {
    filter += str;
    cursor = 0;
    render();
  }
});
