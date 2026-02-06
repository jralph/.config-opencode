const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STORAGE = path.join(process.env.HOME, '.local/share/opencode/storage');
const SESSION_DIR = path.join(STORAGE, 'session');
const MESSAGE_DIR = path.join(STORAGE, 'message');
const PART_DIR = path.join(STORAGE, 'part');
const PORT = process.env.PORT || 3847;
const KIRO_CWD = process.env.KIRO_CWD || path.join(process.env.HOME, '.config/opencode');

// Active chat sessions: Map<sessionId, {proc, clients[]}>
const chatSessions = new Map();

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function readFile(fp) {
  try { return fs.readFileSync(fp, 'utf8'); } catch { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function parseYamlFrontmatter(content) {
  if (!content || !content.startsWith('---')) return { frontmatter: {}, body: content };
  const end = content.indexOf('---', 3);
  if (end === -1) return { frontmatter: {}, body: content };
  const yaml = content.slice(3, end).trim();
  const body = content.slice(end + 3).trim();
  const frontmatter = {};
  yaml.split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) frontmatter[key.trim()] = rest.join(':').trim();
  });
  return { frontmatter, body };
}

function getSwarmFiles(projectDir) {
  const opencode = path.join(projectDir, '.opencode');
  if (!fs.existsSync(opencode)) return null;
  
  const result = { requirements: [], designs: [], tasks: [], context: [], validations: [] };
  
  // Requirements
  const reqDir = path.join(opencode, 'requirements');
  listDir(reqDir).filter(f => f.endsWith('.md')).forEach(f => {
    const content = readFile(path.join(reqDir, f));
    const { frontmatter, body } = parseYamlFrontmatter(content);
    result.requirements.push({ file: f, path: `.opencode/requirements/${f}`, ...frontmatter, preview: body?.slice(0, 200) });
  });
  
  // Designs
  const designDir = path.join(opencode, 'designs');
  listDir(designDir).filter(f => f.endsWith('.md')).forEach(f => {
    const content = readFile(path.join(designDir, f));
    const { frontmatter } = parseYamlFrontmatter(content);
    result.designs.push({ file: f, path: `.opencode/designs/${f}`, ...frontmatter });
  });
  
  // Tasks/Plans
  const tasksDir = path.join(opencode, 'tasks');
  const plansDir = path.join(opencode, 'plans');
  [...listDir(tasksDir), ...listDir(plansDir)].filter(f => f.endsWith('.md')).forEach(f => {
    const dir = fs.existsSync(path.join(tasksDir, f)) ? tasksDir : plansDir;
    const content = readFile(path.join(dir, f));
    const { frontmatter, body } = parseYamlFrontmatter(content);
    // Parse task list from body
    const tasks = [];
    const taskRegex = /^[-*]\s*\[([x ])\]\s*(?:\*\*)?(\d+(?:\.\d+)?)\*?\*?[:.]\s*(.+?)(?:\s*\(([^)]+)\))?$/gim;
    let match;
    while ((match = taskRegex.exec(body)) !== null) {
      tasks.push({ id: match[2], done: match[1].toLowerCase() === 'x', title: match[3].trim(), agent: match[4] || null });
    }
    result.tasks.push({ file: f, path: `.opencode/${dir === tasksDir ? 'tasks' : 'plans'}/${f}`, ...frontmatter, items: tasks });
  });
  
  // Context cache
  const ctxDir = path.join(opencode, 'context');
  listDir(ctxDir).filter(f => f.endsWith('.md')).forEach(f => {
    const content = readFile(path.join(ctxDir, f));
    const { frontmatter } = parseYamlFrontmatter(content);
    result.context.push({ file: f, path: `.opencode/context/${f}`, ...frontmatter });
  });
  
  // Validations
  const valDir = path.join(opencode, 'validations');
  listDir(valDir).forEach(taskDir => {
    const taskValDir = path.join(valDir, taskDir);
    if (!fs.statSync(taskValDir).isDirectory()) return;
    const phases = listDir(taskValDir).filter(f => f.endsWith('.md')).map(f => {
      const content = readFile(path.join(taskValDir, f));
      const { frontmatter } = parseYamlFrontmatter(content);
      return { file: f, ...frontmatter };
    });
    result.validations.push({ taskId: taskDir, phases });
  });
  
  return result;
}

function getProjects() {
  return fs.readdirSync(SESSION_DIR).filter(d => d !== 'global' && !d.startsWith('.'));
}

function getSessions(projectID) {
  const dir = path.join(SESSION_DIR, projectID);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const s = readJSON(path.join(dir, f));
    if (!s) return null;
    return { id: s.id, title: s.title, slug: s.slug, parentID: s.parentID, created: s.time?.created, updated: s.time?.updated, summary: s.summary, directory: s.directory };
  }).filter(Boolean).sort((a, b) => (b.created || 0) - (a.created || 0));
}

function getMessages(sessionID) {
  const dir = path.join(MESSAGE_DIR, sessionID);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const m = readJSON(path.join(dir, f));
    if (!m) return null;
    return { id: m.id, role: m.role, agent: m.agent || m.mode, model: m.modelID, provider: m.providerID, created: m.time?.created, completed: m.time?.completed, tokens: m.tokens, cost: m.cost, finish: m.finish, title: m.summary?.title, diffs: m.summary?.diffs?.map(d => ({ file: d.file, additions: d.additions || 0, deletions: d.deletions || 0, status: d.status })) };
  }).filter(Boolean).sort((a, b) => (a.created || 0) - (b.created || 0));
}

function getToolParts(messageID) {
  const dir = path.join(PART_DIR, messageID);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const p = readJSON(path.join(dir, f));
    if (!p || p.type !== 'tool') return null;
    const inputLen = JSON.stringify(p.state?.input || '').length;
    const outputLen = JSON.stringify(p.state?.output || '').length;
    return { tool: p.tool, inputTokens: Math.round(inputLen / 4), outputTokens: Math.round(outputLen / 4) };
  }).filter(Boolean);
}

function buildTree(projectID, rootSessionID) {
  const allSessions = getSessions(projectID);
  const sessionMap = new Map(allSessions.map(s => [s.id, s]));

  // Estimate tokens: ~4 chars per token for English text
  function estimateTokens(m) {
    if (m.tokens && (m.tokens.input > 0 || m.tokens.output > 0)) {
      return { input: m.tokens.input || 0, output: m.tokens.output || 0, estimated: false };
    }
    // Fallback: estimate from title length and diffs
    const titleLen = (m.title || '').length;
    const diffLines = (m.diffs || []).reduce((s, d) => s + d.additions + d.deletions, 0);
    const estOutput = Math.round((titleLen + diffLines * 40) / 4); // ~40 chars per diff line
    const estInput = m.role === 'user' ? Math.round(titleLen / 4) : 500; // base context estimate
    return { input: estInput, output: estOutput, estimated: true };
  }

  function buildNode(sid, isRoot = false) {
    const session = sessionMap.get(sid);
    if (!session) return null;
    const msgs = getMessages(sid);
    const children = allSessions.filter(s => s.parentID === sid).map(s => buildNode(s.id, false)).filter(Boolean);
    const agents = {};
    let totalDiffs = 0;
    const files = {};
    let startTime = null, endTime = null;
    const timeline = []; // {time, agent, diffs, tokens}
    let totalTokens = { input: 0, output: 0, estimated: false };
    const referencedFiles = new Set();
    let humanMessages = 0;

    for (const m of msgs) {
      // Count human (user) messages - only at root level
      if (m.role === 'user' && isRoot) {
        humanMessages++;
        if (m.created) timeline.push({ time: m.created, agent: 'human', diffs: 0, tokens: 0 });
      }
      
      const a = m.agent || 'unknown';
      if (!agents[a]) agents[a] = { messages: 0, diffs: 0, models: new Set(), startTime: null, endTime: null, tokens: { input: 0, output: 0, estimated: false } };
      agents[a].messages++;
      if (m.model) agents[a].models.add(`${m.provider || ''}/${m.model}`);
      
      // Collect .opencode file references from diffs
      if (m.diffs) {
        m.diffs.forEach(d => {
          if (d.file && d.file.includes('.opencode/')) referencedFiles.add(d.file);
        });
      }
      
      // tokens
      const tok = estimateTokens(m);
      agents[a].tokens.input += tok.input;
      agents[a].tokens.output += tok.output;
      if (tok.estimated) agents[a].tokens.estimated = true;
      totalTokens.input += tok.input;
      totalTokens.output += tok.output;
      if (tok.estimated) totalTokens.estimated = true;
      
      // diff tokens (estimate ~4 chars per token, ~40 chars per line)
      const diffLines = (m.diffs || []).reduce((s, d) => s + (d.additions || 0), 0);
      const msgDiffTokens = Math.round(diffLines * 10); // ~40 chars/line / 4 chars/token = 10 tokens/line
      if (!agents[a].diffTokens) agents[a].diffTokens = 0;
      agents[a].diffTokens += msgDiffTokens;

      // timing
      if (m.created) {
        if (!startTime || m.created < startTime) startTime = m.created;
        if (!agents[a].startTime || m.created < agents[a].startTime) agents[a].startTime = m.created;
        timeline.push({ time: m.created, agent: a, diffs: m.diffs?.length || 0, tokens: tok.input + tok.output, diffTokens: msgDiffTokens });
      }
      const end = m.completed || m.created;
      if (end) {
        if (!endTime || end > endTime) endTime = end;
        if (!agents[a].endTime || end > agents[a].endTime) agents[a].endTime = end;
      }
      // file diffs
      if (m.diffs) {
        agents[a].diffs += m.diffs.length;
        totalDiffs += m.diffs.length;
        for (const d of m.diffs) {
          if (!files[d.file]) files[d.file] = { additions: 0, deletions: 0, agents: new Set() };
          files[d.file].additions += d.additions;
          files[d.file].deletions += d.deletions;
          files[d.file].agents.add(a);
        }
      }
    }
    
    // Collect tool stats from message parts
    const toolStats = {};
    for (const m of msgs) {
      const parts = getToolParts(m.id);
      for (const p of parts) {
        if (!toolStats[p.tool]) toolStats[p.tool] = { calls: 0, inputTokens: 0, outputTokens: 0 };
        toolStats[p.tool].calls++;
        toolStats[p.tool].inputTokens += p.inputTokens;
        toolStats[p.tool].outputTokens += p.outputTokens;
      }
    }

    // Collect child timelines, tokens, referenced files, and tool stats
    let childDiffTokens = 0;
    for (const c of children) {
      if (c.timeline) timeline.push(...c.timeline);
      if (c.tokens) {
        totalTokens.input += c.tokens.input;
        totalTokens.output += c.tokens.output;
        if (c.tokens.estimated) totalTokens.estimated = true;
      }
      if (c.diffTokens) childDiffTokens += c.diffTokens;
      if (c.referencedFiles) c.referencedFiles.forEach(f => referencedFiles.add(f));
      // Aggregate child tool stats
      if (c.toolStats) {
        for (const [tool, stats] of Object.entries(c.toolStats)) {
          if (!toolStats[tool]) toolStats[tool] = { calls: 0, inputTokens: 0, outputTokens: 0 };
          toolStats[tool].calls += stats.calls;
          toolStats[tool].inputTokens += stats.inputTokens;
          toolStats[tool].outputTokens += stats.outputTokens;
        }
      }
    }
    timeline.sort((a, b) => a.time - b.time);
    
    // Calculate total diff tokens (this node + children)
    const totalDiffTokens = Object.values(agents).reduce((s, a) => s + (a.diffTokens || 0), 0) + childDiffTokens;

    const agentStats = {};
    for (const [k, v] of Object.entries(agents)) {
      agentStats[k] = { messages: v.messages, diffs: v.diffs, models: [...v.models], duration: (v.startTime && v.endTime) ? v.endTime - v.startTime : null, tokens: v.tokens, diffTokens: v.diffTokens || 0 };
    }
    const fileStats = {};
    for (const [k, v] of Object.entries(files)) {
      fileStats[k] = { additions: v.additions, deletions: v.deletions, agents: [...v.agents] };
    }

    return { id: sid, title: session.title, directory: session.directory, agent: msgs[0]?.agent, messages: msgs.length, diffs: totalDiffs, agents: agentStats, files: fileStats, children, created: session.created, duration: (startTime && endTime) ? endTime - startTime : null, timeline, tokens: totalTokens, diffTokens: totalDiffTokens, referencedFiles: [...referencedFiles], humanMessages, toolStats };
  }

  const root = buildNode(rootSessionID, true);
  if (root) {
    const rootSession = sessionMap.get(rootSessionID);
    if (rootSession) root.directory = rootSession.directory;
  }
  return root;
}

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Swarm Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 16px; font-size: 1.4em; }
  h2 { color: #58a6ff; margin: 16px 0 8px; font-size: 1.1em; }
  .controls { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
  select, input { background: #161b22; color: #c9d1d9; border: 1px solid #30363d; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
  select { min-width: 300px; }
  input { min-width: 200px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; text-align: center; }
  .stat .val { font-size: 1.8em; font-weight: bold; color: #58a6ff; }
  .stat .label { font-size: 0.75em; color: #8b949e; margin-top: 4px; }
  .tree { font-size: 13px; }
  .tree-row { display: grid; grid-template-columns: minmax(200px, 2fr) 80px 50px 50px 60px 50px 60px 1fr; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #21262d; align-items: center; }
  .tree-row:hover { background: #161b22; }
  .tree-header { font-weight: bold; color: #8b949e; font-size: 0.8em; text-transform: uppercase; border-bottom: 2px solid #30363d; }
  .indent { color: #484f58; }
  .agent-tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: 600; }
  .agent-product-owner { background: #1f3a1f; color: #56d364; }
  .agent-architect { background: #1f2a3f; color: #58a6ff; }
  .agent-orchestrator { background: #3f2a1f; color: #d29922; }
  .agent-system-engineer { background: #2a1f3f; color: #bc8cff; }
  .agent-ui-engineer { background: #3f1f2a; color: #f778ba; }
  .agent-fullstack-engineer { background: #1f3f3f; color: #56d4d4; }
  .agent-validator { background: #3f3f1f; color: #d4d456; }
  .agent-project-knowledge { background: #1f2f2f; color: #7ee787; }
  .agent-staff-engineer { background: #3f1f1f; color: #ff7b72; }
  .agent-shell { background: #2f2f2f; color: #8b949e; }
  .agent-debugger { background: #3f2f1f; color: #ffa657; }
  .agent-qa-engineer { background: #2f1f3f; color: #d2a8ff; }
  .agent-security-engineer { background: #3f1f1f; color: #ff7b72; }
  .agent-devops-engineer { background: #1f3f2a; color: #3fb950; }
  .agent-documentation-engineer { background: #2a2f1f; color: #a5d6a7; }
  .diffs { color: #3fb950; }
  .msgs { color: #8b949e; }
  .warn { color: #d29922; }
  .err { color: #f85149; }
  .bar { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; flex: 1; }
  .bar-fill { height: 100%; border-radius: 3px; }
  .agent-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .agent-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
  .agent-card .name { font-weight: bold; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .agent-card .name .ratio { font-size: 0.8em; color: #7ee787; font-weight: normal; }
  .agent-card .detail { font-size: 0.85em; color: #8b949e; margin-bottom: 8px; }
  .agent-bars { display: flex; flex-direction: column; gap: 4px; }
  .agent-bar-row { display: flex; align-items: center; gap: 6px; }
  .bar-label { font-size: 0.7em; color: #6e7681; width: 45px; text-align: right; }
  .files-section { margin-top: 16px; }
  .file-row { display: grid; grid-template-columns: 1fr 70px 70px 1fr; gap: 8px; padding: 4px 8px; font-size: 0.85em; border-bottom: 1px solid #21262d; align-items: center; }
  .file-row:hover { background: #161b22; }
  .file-header { font-weight: bold; color: #8b949e; font-size: 0.8em; text-transform: uppercase; border-bottom: 2px solid #30363d; }
  .file-add { color: #3fb950; }
  .file-del { color: #f85149; }
  .tool-section { margin-top: 16px; }
  .tool-row { display: grid; grid-template-columns: 1fr 60px 80px 80px 80px 50px; gap: 8px; padding: 4px 8px; font-size: 0.85em; border-bottom: 1px solid #21262d; align-items: center; }
  .tool-row:hover { background: #161b22; }
  .tool-header { font-weight: bold; color: #8b949e; font-size: 0.8em; text-transform: uppercase; border-bottom: 2px solid #30363d; }
  .tool-name { color: #58a6ff; font-family: monospace; }
  .empty { color: #484f58; text-align: center; padding: 40px; }
  .tip { position: relative; cursor: help; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: #30363d; color: #8b949e; font-size: 9px; font-style: italic; font-family: Georgia, serif; margin-left: 4px; vertical-align: middle; flex-shrink: 0; }
  .tip:hover::after { content: attr(data-tip); position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%); background: #1c2028; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-style: normal; font-family: -apple-system, BlinkMacSystemFont, monospace; white-space: nowrap; z-index: 10; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,.4); }
  .waste-section { margin-bottom: 20px; }
  .waste-item { background: #1c1208; border: 1px solid #d29922; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; font-size: 0.9em; }
  .waste-item .type { font-weight: bold; color: #d29922; }
  .waste-item.severe { background: #1c0808; border-color: #f85149; }
  .waste-item.severe .type { color: #f85149; }
  .dur { color: #8b949e; font-size: 0.85em; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .chart-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
  .chart-box h3 { font-size: 0.9em; color: #8b949e; margin-bottom: 10px; }
  .chart-box svg { width: 100%; height: 150px; }
  @media (max-width: 800px) { .charts { grid-template-columns: 1fr; } }
  .chat-toggle { position: fixed; bottom: 20px; right: 20px; background: #238636; color: #fff; border: none; padding: 12px 16px; border-radius: 24px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,.4); z-index: 100; display: flex; align-items: center; gap: 4px; }
  .chat-toggle:hover { background: #2ea043; }
  .chat-toggle:disabled { background: #484f58; cursor: not-allowed; }
  .chat-toggle .dropdown-arrow { padding: 0 4px; margin-left: 4px; border-left: 1px solid rgba(255,255,255,.3); }
  .chat-provider-menu { position: fixed; bottom: 70px; right: 20px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; display: none; flex-direction: column; z-index: 101; box-shadow: 0 4px 12px rgba(0,0,0,.4); overflow: hidden; }
  .chat-provider-menu.open { display: flex; }
  .chat-provider-option { padding: 10px 16px; color: #c9d1d9; cursor: pointer; font-size: 13px; border: none; background: none; text-align: left; }
  .chat-provider-option:hover { background: #21262d; }
  .chat-provider-option.selected { background: #238636; color: #fff; }
  .swarm-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #8b949e; cursor: pointer; user-select: none; }
  .swarm-toggle input { cursor: pointer; }
  .swarm-section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-bottom: 16px; }
  .swarm-section h3 { font-size: 0.95em; color: #58a6ff; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .swarm-section h3 .count { background: #21262d; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; color: #8b949e; }
  .swarm-list { display: flex; flex-direction: column; gap: 6px; }
  .swarm-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #0d1117; border-radius: 6px; font-size: 0.85em; }
  .swarm-item .name { flex: 1; color: #c9d1d9; }
  .swarm-item .status { font-size: 0.8em; padding: 2px 6px; border-radius: 4px; }
  .swarm-item .status.done { background: #1f3a1f; color: #3fb950; }
  .swarm-item .status.pending { background: #1c1208; color: #d29922; }
  .swarm-item .status.approved { background: #1f3a1f; color: #3fb950; }
  .swarm-item .agent { font-size: 0.75em; color: #8b949e; }
  .swarm-btn { background: #21262d; border: 1px solid #30363d; color: #58a6ff; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8em; }
  .swarm-btn:hover { background: #30363d; }
  .swarm-empty { color: #484f58; font-size: 0.85em; padding: 10px; text-align: center; }
  .file-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; max-width: 800px; max-height: 80vh; background: #161b22; border: 1px solid #30363d; border-radius: 12px; z-index: 200; display: none; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,.6); }
  .file-modal.open { display: flex; }
  .file-modal-header { padding: 12px 16px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
  .file-modal-header h3 { font-size: 0.9em; color: #c9d1d9; margin: 0; }
  .file-modal-content { flex: 1; overflow: auto; padding: 16px; }
  .file-modal-content pre { font-size: 12px; color: #c9d1d9; white-space: pre-wrap; word-break: break-word; }
  .md-content { font-size: 13px; line-height: 1.6; }
  .md-content h1 { font-size: 1.4em; color: #58a6ff; margin: 16px 0 8px; border-bottom: 1px solid #30363d; padding-bottom: 4px; }
  .md-content h2 { font-size: 1.2em; color: #58a6ff; margin: 14px 0 6px; }
  .md-content h3 { font-size: 1.1em; color: #8b949e; margin: 12px 0 4px; }
  .md-content p { margin: 8px 0; }
  .md-content ul, .md-content ol { margin: 8px 0; padding-left: 24px; }
  .md-content li { margin: 4px 0; }
  .md-content code { background: #21262d; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  .md-content pre code { display: block; padding: 12px; overflow-x: auto; }
  .md-content blockquote { border-left: 3px solid #30363d; padding-left: 12px; color: #8b949e; margin: 8px 0; }
  .md-content strong { color: #c9d1d9; }
  .md-content hr { border: none; border-top: 1px solid #30363d; margin: 16px 0; }
  .md-content .task-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; background: #0d1117; border-radius: 4px; margin: 4px 0; }
  .md-content .task-check { width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
  .md-content .task-check.done { background: #1f3a1f; color: #3fb950; }
  .md-content .task-check.pending { background: #21262d; color: #484f58; }
  .md-content .task-text { flex: 1; }
  .md-content .task-agent { font-size: 0.8em; color: #8b949e; background: #21262d; padding: 2px 6px; border-radius: 4px; }
  .file-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,.5); z-index: 199; display: none; }
  .file-modal-overlay.open { display: block; }
  .chat-panel { position: fixed; bottom: 80px; right: 20px; width: 420px; max-height: 500px; background: #161b22; border: 1px solid #30363d; border-radius: 12px; display: none; flex-direction: column; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
  .chat-panel.open { display: flex; }
  .chat-header { padding: 12px 16px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
  .chat-header h3 { margin: 0; font-size: 0.95em; color: #c9d1d9; }
  .chat-close { background: none; border: none; color: #8b949e; cursor: pointer; font-size: 18px; }
  .chat-messages { flex: 1; overflow-y: auto; padding: 12px; max-height: 350px; }
  .chat-msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
  .chat-msg.user { background: #1f3a5f; color: #58a6ff; margin-left: 40px; }
  .chat-msg.assistant { background: #21262d; color: #c9d1d9; margin-right: 40px; }
  .chat-msg.system { background: #1c1208; color: #d29922; font-size: 12px; text-align: center; }
  .chat-input-row { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #30363d; }
  .chat-input { flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px; color: #c9d1d9; font-size: 13px; resize: none; }
  .chat-input:focus { outline: none; border-color: #58a6ff; }
  .chat-send { background: #238636; border: none; color: #fff; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .chat-send:hover { background: #2ea043; }
  .chat-send:disabled { background: #484f58; cursor: not-allowed; }
</style></head><body>
<h1>🐝 Swarm Dashboard</h1>
<div class="controls">
  <select id="project"><option value="">Select project...</option></select>
  <select id="session"><option value="">Select session...</option></select>
  <input id="search" placeholder="Filter by name or ID..." />
  <label class="swarm-toggle"><input type="checkbox" id="swarmToggle" /> Swarm Files</label>
</div>
<div id="swarmPanel"></div>
<div id="content"><div class="empty">Select a project and session to view swarm stats</div></div>
<div id="fileModalOverlay" class="file-modal-overlay" onclick="closeFileModal()"></div>
<div id="fileModal" class="file-modal">
  <div class="file-modal-header">
    <h3 id="fileModalTitle">File</h3>
    <button class="chat-close" onclick="closeFileModal()">✕</button>
  </div>
  <div class="file-modal-content" id="fileModalContent"></div>
</div>
<button id="chatToggle" class="chat-toggle" disabled><span id="chatLabel">💬 Chat with OpenCode</span><span class="dropdown-arrow" id="chatDropdown">▾</span></button>
<div id="chatProviderMenu" class="chat-provider-menu">
  <button class="chat-provider-option selected" data-provider="opencode">OpenCode</button>
  <button class="chat-provider-option" data-provider="kiro">Kiro CLI</button>
</div>
<div id="chatPanel" class="chat-panel">
  <div class="chat-header">
    <h3 id="chatTitle">🤖 OpenCode Analysis Chat</h3>
    <button class="chat-close" onclick="closeChat()">✕</button>
  </div>
  <div id="chatMessages" class="chat-messages"></div>
  <div class="chat-input-row">
    <textarea id="chatInput" class="chat-input" rows="2" placeholder="Ask about this session..."></textarea>
    <button id="chatSend" class="chat-send" onclick="sendChat()">Send</button>
  </div>
</div>
<script>
async function api(p) { return (await fetch(p)).json(); }

const projectEl = document.getElementById('project');
const sessionEl = document.getElementById('session');
const searchEl = document.getElementById('search');
const contentEl = document.getElementById('content');
let allSessions = [];

async function init() {
  try {
    console.log('init() called');
    const projects = await api('/api/projects');
    console.log('Got projects:', projects.length);
    for (const p of projects) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.id.slice(0, 8) + ' — ' + (p.directory || 'unknown');
      projectEl.appendChild(o);
    }
  } catch(e) {
    console.error('init error:', e);
  }
}

projectEl.addEventListener('change', async () => {
  sessionEl.innerHTML = '<option value="">Select session...</option>';
  if (!projectEl.value) return;
  allSessions = await api('/api/sessions/' + projectEl.value);
  renderSessionOptions(allSessions);
});

searchEl.addEventListener('input', () => {
  const q = searchEl.value.toLowerCase();
  renderSessionOptions(allSessions.filter(s => !s.parentID && ((s.title||'').toLowerCase().includes(q) || s.id.toLowerCase().includes(q))));
});

function renderSessionOptions(sessions) {
  sessionEl.innerHTML = '<option value="">Select session...</option>';
  for (const s of sessions.filter(s => !s.parentID)) {
    const o = document.createElement('option');
    o.value = s.id;
    const d = s.created ? new Date(s.created).toLocaleDateString() : '';
    o.textContent = (s.title || s.id) + (d ? ' (' + d + ')' : '');
    sessionEl.appendChild(o);
  }
}

let pollInterval = null;
let lastTreeJSON = '';

async function loadTree() {
  if (!projectEl.value || !sessionEl.value) return;
  const tree = await api('/api/tree/' + projectEl.value + '/' + sessionEl.value);
  const json = JSON.stringify(tree);
  if (json !== lastTreeJSON) {
    lastTreeJSON = json;
    if (tree && tree.directory) {
      currentProjectDir = tree.directory;
      currentReferencedFiles = tree.referencedFiles || [];
      if (swarmToggle.checked) loadSwarmFiles();
    }
    renderDashboard(tree);
  }
}

sessionEl.addEventListener('change', async () => {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  lastTreeJSON = '';
  if (!sessionEl.value) { contentEl.innerHTML = '<div class="empty">Select a session</div>'; return; }
  contentEl.innerHTML = '<div class="empty">Loading...</div>';
  await loadTree();
  pollInterval = setInterval(loadTree, 3000);
});

projectEl.addEventListener('change', () => {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  lastTreeJSON = '';
});

function fmtDur(ms) {
  if (!ms) return '—';
  if (ms < 1000) return ms + 'ms';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}

function fmtTokens(t) {
  if (!t) return '—';
  const total = (t.input || 0) + (t.output || 0);
  if (total === 0) return '—';
  const k = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total;
  return t.estimated ? '~' + k : k;
}

function flatten(node, depth = 0, result = []) {
  if (!node) return result;
  result.push({ ...node, depth, children: undefined, childCount: (node.children || []).length });
  for (const c of (node.children || [])) flatten(c, depth + 1, result);
  return result;
}

function detectWaste(flat) {
  const warnings = [];
  for (const n of flat) {
    // Abandoned: has children or >0 msgs but 0 diffs and not a manager/readonly role
    const readOnly = ['product-owner','orchestrator','project-knowledge','validator','code-search','dependency-analyzer','api-documentation'].includes(n.agent);
    if (!readOnly && n.messages <= 2 && n.diffs === 0 && n.childCount === 0) {
      warnings.push({ type: 'Abandoned Session', severity: 'warn', detail: '<span class="agent-tag agent-' + (n.agent||'unknown').replace(/[^a-z-]/g,'') + '">' + (n.agent||'unknown') + '</span> — ' + n.messages + ' msgs, 0 diffs. Session started but produced nothing.', id: n.id });
    }
    // Excessive iteration: >40 msgs for an engineer
    if (!readOnly && n.messages > 40) {
      warnings.push({ type: 'Excessive Iteration', severity: 'severe', detail: '<span class="agent-tag agent-' + (n.agent||'unknown').replace(/[^a-z-]/g,'') + '">' + (n.agent||'unknown') + '</span> — ' + n.messages + ' msgs for ' + n.diffs + ' diffs (' + (n.diffs > 0 ? (n.messages/n.diffs).toFixed(1) + ' msgs/diff' : 'no output') + '). Possible micromanagement or thrashing.', id: n.id });
    }
    // Wasted session: engineer with >5 msgs and 0 diffs
    if (!readOnly && n.messages > 5 && n.diffs === 0 && n.childCount === 0) {
      warnings.push({ type: 'Wasted Compute', severity: 'severe', detail: '<span class="agent-tag agent-' + (n.agent||'unknown').replace(/[^a-z-]/g,'') + '">' + (n.agent||'unknown') + '</span> — ' + n.messages + ' msgs with zero output. Tokens burned with no result.', id: n.id });
    }
    // Duplicate PK calls: count project-knowledge children
    if (n.agent === 'product-owner' || n.agent === 'architect') {
      const pkChildren = flat.filter(c => c.agent === 'project-knowledge' && flat.some(p => p.id === n.id));
      // Check via agents map instead
      const pkSessions = (n.agents && n.agents['project-knowledge']) ? n.agents['project-knowledge'].messages : 0;
    }
  }
  // Duplicate PK: count total PK sessions across tree
  const pkSessions = flat.filter(n => n.agent === 'project-knowledge');
  if (pkSessions.length > 2) {
    warnings.push({ type: 'Duplicate Context Queries', severity: 'warn', detail: 'project-knowledge invoked ' + pkSessions.length + ' times across the tree. Consider context caching to reduce redundant queries.' });
  }
  return warnings;
}

function renderDashboard(tree) {
  if (!tree) { contentEl.innerHTML = '<div class="empty">No data found</div>'; return; }
  const flat = flatten(tree);
  const totalMsgs = flat.reduce((s, n) => s + n.messages, 0);
  const totalDiffs = flat.reduce((s, n) => s + n.diffs, 0);
  const totalAgents = new Set(flat.map(n => n.agent).filter(Boolean)).size;
  const totalSessions = flat.length;
  const totalDuration = tree.duration;

  // Aggregate agents
  const agentAgg = {};
  for (const node of flat) {
    for (const [agent, stats] of Object.entries(node.agents || {})) {
      if (!agentAgg[agent]) agentAgg[agent] = { messages: 0, diffs: 0, sessions: 0, duration: 0, tokens: { input: 0, output: 0, estimated: false }, diffTokens: 0 };
      agentAgg[agent].messages += stats.messages;
      agentAgg[agent].diffs += stats.diffs;
      agentAgg[agent].sessions++;
      agentAgg[agent].diffTokens += stats.diffTokens || 0;
      if (stats.duration) agentAgg[agent].duration += stats.duration;
      if (stats.tokens) {
        agentAgg[agent].tokens.input += stats.tokens.input || 0;
        agentAgg[agent].tokens.output += stats.tokens.output || 0;
        if (stats.tokens.estimated) agentAgg[agent].tokens.estimated = true;
      }
    }
  }

  // Aggregate files
  const fileAgg = {};
  for (const node of flat) {
    for (const [file, stats] of Object.entries(node.files || {})) {
      if (!fileAgg[file]) fileAgg[file] = { additions: 0, deletions: 0, agents: new Set() };
      fileAgg[file].additions += stats.additions;
      fileAgg[file].deletions += stats.deletions;
      for (const a of (stats.agents || [])) fileAgg[file].agents.add(a);
    }
  }

  // Waste detection
  const warnings = detectWaste(flat);

  const maxMsgs = Math.max(...Object.values(agentAgg).map(a => a.messages), 1);
  const maxDiffs = Math.max(...Object.values(agentAgg).map(a => a.diffs), 1);
  const maxTokens = Math.max(...Object.values(agentAgg).map(a => (a.tokens?.input || 0) + (a.tokens?.output || 0)), 1);
  const maxDiffTokens = Math.max(...Object.values(agentAgg).map(a => a.diffTokens || 0), 1);
  const maxDur = Math.max(...Object.values(agentAgg).map(a => a.duration || 0), 1);
  const maxCalls = Math.max(...Object.values(agentAgg).map(a => a.sessions), 1);
  const totalCalls = Object.values(agentAgg).reduce((s, a) => s + a.sessions, 0);
  const totalHuman = tree.humanMessages || 0;

  let html = '<div class="stats">';
  html += stat(totalSessions, 'Sessions', 'Total session count including all subagent sessions');
  html += stat(totalCalls, 'Agent Calls', 'Total number of agent invocations');
  html += stat(totalHuman, 'Human Inputs', 'Number of human messages in root session');
  html += stat(totalMsgs, 'Messages', 'Total assistant + user messages across all sessions');
  html += stat(totalDiffs, 'File Changes', 'Total file diffs produced (edits, creates, deletes)');
  html += stat(totalAgents, 'Agents Used', 'Distinct agent types that participated');
  html += stat(fmtDur(totalDuration), 'Duration', 'Wall-clock time from first to last message');
  html += stat(fmtTokens(tree.tokens), 'Tokens', 'Total tokens used (~ = estimated from content length)');
  const totalTok = (tree.tokens?.input || 0) + (tree.tokens?.output || 0);
  const diffTok = tree.diffTokens || 0;
  const ratio = diffTok > 0 ? Math.round(totalTok / diffTok) : 0;
  html += stat(fmtTokens({input: diffTok, output: 0}), 'Diff Tokens', 'Tokens written to files (estimated from line additions)');
  html += stat(ratio > 0 ? ratio + ':1' : '—', 'Token Ratio', 'Total tokens / diff tokens — lower is more efficient');
  html += '</div>';

  // Charts
  html += '<div class="charts">';
  html += '<div class="chart-box"><h3>Activity Over Time <span class="tip" data-tip="Blue bars = messages, green line = file changes">i</span></h3>' + renderActivityChart(tree.timeline) + '</div>';
  html += '<div class="chart-box"><h3>Agent Usage Over Time <span class="tip" data-tip="Stacked bars showing which agents were active when">i</span></h3>' + renderAgentTimeline(tree.timeline) + '</div>';
  html += '<div class="chart-box"><h3>Token Usage Over Time <span class="tip" data-tip="Cumulative token consumption (~ = estimated)">i</span></h3>' + renderTokenChart(tree.timeline) + '</div>';
  html += '<div class="chart-box"><h3>Top 5 Token Usage by Agent <span class="tip" data-tip="Token distribution across agents">i</span></h3>' + renderTokenByAgent(agentAgg) + '</div>';
  html += '<div class="chart-box"><h3>Human Interactions <span class="tip" data-tip="When human input occurred during the session">i</span></h3>' + renderHumanChart(tree.timeline) + '</div>';
  html += '<div class="chart-box"><h3>Token Efficiency <span class="tip" data-tip="Orange = total tokens, green = diff tokens written">i</span></h3>' + renderEfficiencyChart(tree.timeline) + '</div>';
  html += '</div>';

  // Waste warnings
  if (warnings.length) {
    html += '<h2>⚠ Waste Patterns (' + warnings.length + ') <span class="tip" data-tip="Detected inefficiencies: abandoned sessions, excessive iteration, wasted compute, duplicate queries">i</span></h2><div class="waste-section">';
    for (const w of warnings) {
      html += '<div class="waste-item ' + w.severity + '"><span class="type">' + w.type + '</span> — ' + w.detail + '</div>';
    }
    html += '</div>';
  }

  // Agent summary
  html += '<h2>Agent Summary <span class="tip" data-tip="Aggregated stats per agent across all sessions. Bars show relative values.">i</span></h2><div class="agent-summary">';
  for (const [agent, stats] of Object.entries(agentAgg).sort((a, b) => b[1].messages - a[1].messages)) {
    const cls = 'agent-' + agent.replace(/[^a-z-]/g, '');
    const pctMsgs = Math.round(stats.messages / maxMsgs * 100);
    const pctDiffs = Math.round(stats.diffs / maxDiffs * 100);
    const tokTotal = (stats.tokens?.input || 0) + (stats.tokens?.output || 0);
    const pctTokens = Math.round(tokTotal / maxTokens * 100);
    const pctDiffTok = Math.round((stats.diffTokens || 0) / maxDiffTokens * 100);
    const agentRatio = stats.diffTokens > 0 ? Math.round(tokTotal / stats.diffTokens) + ':1' : '—';
    const pctDur = Math.round((stats.duration || 0) / maxDur * 100);
    const pctCalls = Math.round(stats.sessions / maxCalls * 100);
    html += '<div class="agent-card"><div class="name"><span class="agent-tag ' + cls + '">' + agent + '</span><span class="ratio">' + agentRatio + '</span></div>';
    html += '<div class="detail">' + stats.sessions + ' calls · ' + stats.messages + ' msgs · ' + stats.diffs + ' diffs · ' + fmtTokens(stats.tokens) + ' tok · <span class="dur">' + fmtDur(stats.duration) + '</span></div>';
    html += '<div class="agent-bars">';
    html += '<div class="agent-bar-row"><span class="bar-label">Calls</span><div class="bar"><div class="bar-fill" style="width:' + pctCalls + '%;background:#f778ba"></div></div></div>';
    html += '<div class="agent-bar-row"><span class="bar-label">Msgs</span><div class="bar"><div class="bar-fill" style="width:' + pctMsgs + '%;background:#58a6ff"></div></div></div>';
    html += '<div class="agent-bar-row"><span class="bar-label">Diffs</span><div class="bar"><div class="bar-fill" style="width:' + pctDiffs + '%;background:#3fb950"></div></div></div>';
    html += '<div class="agent-bar-row"><span class="bar-label">Tokens</span><div class="bar"><div class="bar-fill" style="width:' + pctTokens + '%;background:#d29922"></div></div></div>';
    html += '<div class="agent-bar-row"><span class="bar-label">Diff Tok</span><div class="bar"><div class="bar-fill" style="width:' + pctDiffTok + '%;background:#7ee787"></div></div></div>';
    html += '<div class="agent-bar-row"><span class="bar-label">Time</span><div class="bar"><div class="bar-fill" style="width:' + pctDur + '%;background:#bc8cff"></div></div></div>';
    html += '</div></div>';
  }
  html += '</div>';

  // Session tree
  html += '<h2>Session Tree</h2><div class="tree">';
  html += '<div class="tree-row tree-header"><span>Session</span><span>Agent</span><span>Msgs <span class="tip" data-tip="Total messages in this session (red >40, yellow >20)">i</span></span><span>Diffs <span class="tip" data-tip="File changes produced by this session">i</span></span><span>Tokens <span class="tip" data-tip="Token usage (~ = estimated)">i</span></span><span>Ratio <span class="tip" data-tip="Total tokens / diff tokens — lower is more efficient">i</span></span><span>Duration <span class="tip" data-tip="Time from first to last message">i</span></span><span>Efficiency <span class="tip" data-tip="Messages per diff — lower is better. No output = wasted session.">i</span></span></div>';
  for (const node of flat) {
    const indent = '│ '.repeat(node.depth);
    const prefix = node.depth > 0 ? '├─ ' : '';
    const cls = 'agent-' + (node.agent || 'unknown').replace(/[^a-z-]/g, '');
    const efficiency = node.diffs > 0 ? (node.messages / node.diffs).toFixed(1) + ' msg/diff' : '<span class="warn">no output</span>';
    const msgClass = node.messages > 40 ? 'err' : node.messages > 20 ? 'warn' : 'msgs';
    const nodeTok = (node.tokens?.input || 0) + (node.tokens?.output || 0);
    const nodeDiffTok = node.diffTokens || 0;
    const nodeRatio = nodeDiffTok > 0 ? Math.round(nodeTok / nodeDiffTok) + ':1' : '—';
    html += '<div class="tree-row">';
    html += '<span><span class="indent">' + indent + prefix + '</span>' + (node.title || node.id) + '</span>';
    html += '<span class="agent-tag ' + cls + '">' + (node.agent || '—') + '</span>';
    html += '<span class="' + msgClass + '">' + node.messages + '</span>';
    html += '<span class="diffs">' + (node.diffs || '—') + '</span>';
    html += '<span>' + fmtTokens(node.tokens) + '</span>';
    html += '<span>' + nodeRatio + '</span>';
    html += '<span class="dur">' + fmtDur(node.duration) + '</span>';
    html += '<span>' + efficiency + '</span>';
    html += '</div>';
  }
  html += '</div>';

  // File changes
  const fileEntries = Object.entries(fileAgg).sort((a, b) => (b[1].additions + b[1].deletions) - (a[1].additions + a[1].deletions));
  if (fileEntries.length) {
    html += '<h2>File Changes (' + fileEntries.length + ')</h2><div class="files-section">';
    html += '<div class="file-row file-header"><span>File</span><span>Added <span class="tip" data-tip="Lines added">i</span></span><span>Removed <span class="tip" data-tip="Lines removed">i</span></span><span>Agents <span class="tip" data-tip="Which agents modified this file">i</span></span></div>';
    for (const [file, stats] of fileEntries) {
      html += '<div class="file-row">';
      html += '<span>' + file + '</span>';
      html += '<span class="file-add">+' + stats.additions + '</span>';
      html += '<span class="file-del">-' + stats.deletions + '</span>';
      html += '<span>' + [...stats.agents].map(a => '<span class="agent-tag agent-' + a.replace(/[^a-z-]/g,'') + '">' + a + '</span>').join(' ') + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }
  
  // Tool usage
  const toolEntries = Object.entries(tree.toolStats || {}).sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens));
  if (toolEntries.length) {
    const totalToolTokens = toolEntries.reduce((s, [, t]) => s + t.inputTokens + t.outputTokens, 0);
    html += '<h2>Tool Usage <span class="tip" data-tip="Token estimates based on input/output JSON size (~4 chars/token)">i</span></h2><div class="tool-section">';
    html += '<div class="tool-row tool-header"><span>Tool</span><span>Calls</span><span>Input Tok</span><span>Output Tok</span><span>Total</span><span>%</span></div>';
    for (const [tool, stats] of toolEntries) {
      const total = stats.inputTokens + stats.outputTokens;
      const pct = totalToolTokens > 0 ? Math.round(total / totalToolTokens * 100) : 0;
      html += '<div class="tool-row">';
      html += '<span class="tool-name">' + tool + '</span>';
      html += '<span>' + stats.calls + '</span>';
      html += '<span>' + fmtNum(stats.inputTokens) + '</span>';
      html += '<span>' + fmtNum(stats.outputTokens) + '</span>';
      html += '<span>' + fmtNum(total) + '</span>';
      html += '<span>' + pct + '%</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  contentEl.innerHTML = html;
}

function fmtNum(n) { return n >= 1000 ? (n/1000).toFixed(1) + 'k' : n; }

function stat(val, label, tip) {
  const i = tip ? ' <span class="tip" data-tip="' + tip + '">i</span>' : '';
  return '<div class="stat"><div class="val">' + val + '</div><div class="label">' + label + i + '</div></div>';
}

function agentColor(agent) {
  const colors = { 'product-owner': '#56d364', 'architect': '#58a6ff', 'orchestrator': '#d29922', 'system-engineer': '#bc8cff', 'ui-engineer': '#f778ba', 'fullstack-engineer': '#56d4d4', 'validator': '#d4d456', 'project-knowledge': '#7ee787', 'staff-engineer': '#ff7b72', 'shell': '#8b949e', 'debugger': '#ffa657', 'qa-engineer': '#d2a8ff', 'security-engineer': '#ff7b72', 'devops-engineer': '#3fb950', 'documentation-engineer': '#a5d6a7' };
  return colors[agent] || '#8b949e';
}

function renderActivityChart(timeline) {
  if (!timeline || timeline.length < 2) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">Not enough data</text></svg>';
  const minT = timeline[0].time, maxT = timeline[timeline.length - 1].time;
  const range = maxT - minT || 1;
  const buckets = 20;
  const bucketSize = range / buckets;
  const data = Array(buckets).fill(0);
  const diffData = Array(buckets).fill(0);
  for (const e of timeline) {
    const i = Math.min(Math.floor((e.time - minT) / bucketSize), buckets - 1);
    data[i]++;
    diffData[i] += e.diffs;
  }
  const maxVal = Math.max(...data, 1);
  const maxDiff = Math.max(...diffData, 1);
  const w = 400, h = 150, pad = 25, barW = (w - pad * 2) / buckets;
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  // Bars for messages
  for (let i = 0; i < buckets; i++) {
    const barH = (data[i] / maxVal) * (h - pad * 2);
    const x = pad + i * barW;
    const y = h - pad - barH;
    svg += '<rect x="' + x + '" y="' + y + '" width="' + (barW - 2) + '" height="' + barH + '" fill="#58a6ff" opacity="0.7"/>';
  }
  // Line for diffs
  let points = '';
  for (let i = 0; i < buckets; i++) {
    const x = pad + i * barW + barW / 2;
    const y = h - pad - (diffData[i] / maxDiff) * (h - pad * 2);
    points += (i === 0 ? 'M' : 'L') + x + ',' + y;
  }
  svg += '<path d="' + points + '" fill="none" stroke="#3fb950" stroke-width="2"/>';
  // Axes
  svg += '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#30363d"/>';
  svg += '<text x="' + pad + '" y="' + (h - 8) + '" fill="#8b949e" font-size="9">Start</text>';
  svg += '<text x="' + (w - pad) + '" y="' + (h - 8) + '" fill="#8b949e" font-size="9" text-anchor="end">End</text>';
  svg += '<text x="' + (w / 2) + '" y="12" fill="#8b949e" font-size="10" text-anchor="middle"><tspan fill="#58a6ff">■</tspan> Messages  <tspan fill="#3fb950">—</tspan> Diffs</text>';
  svg += '</svg>';
  return svg;
}

function renderAgentTimeline(timeline) {
  if (!timeline || timeline.length < 2) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">Not enough data</text></svg>';
  const minT = timeline[0].time, maxT = timeline[timeline.length - 1].time;
  const range = maxT - minT || 1;
  const agents = [...new Set(timeline.map(e => e.agent))];
  const buckets = 15;
  const bucketSize = range / buckets;
  const data = {};
  for (const a of agents) data[a] = Array(buckets).fill(0);
  for (const e of timeline) {
    const i = Math.min(Math.floor((e.time - minT) / bucketSize), buckets - 1);
    data[e.agent][i]++;
  }
  const w = 400, h = 150, pad = 25, barW = (w - pad * 2) / buckets;
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  // Stacked bars
  for (let i = 0; i < buckets; i++) {
    let y = h - pad;
    const total = agents.reduce((s, a) => s + data[a][i], 0);
    const maxStack = Math.max(...Array(buckets).fill(0).map((_, j) => agents.reduce((s, a) => s + data[a][j], 0)), 1);
    for (const a of agents) {
      const segH = (data[a][i] / maxStack) * (h - pad * 2);
      if (segH > 0) {
        svg += '<rect x="' + (pad + i * barW) + '" y="' + (y - segH) + '" width="' + (barW - 2) + '" height="' + segH + '" fill="' + agentColor(a) + '"/>';
        y -= segH;
      }
    }
  }
  svg += '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#30363d"/>';
  // Legend (top agents only)
  const topAgents = agents.slice(0, 4);
  let lx = pad;
  for (const a of topAgents) {
    svg += '<rect x="' + lx + '" y="4" width="8" height="8" fill="' + agentColor(a) + '"/>';
    svg += '<text x="' + (lx + 10) + '" y="11" fill="#8b949e" font-size="8">' + a.split('-')[0] + '</text>';
    lx += 60;
  }
  svg += '</svg>';
  return svg;
}

function renderTokenChart(timeline) {
  if (!timeline || timeline.length < 2) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">Not enough data</text></svg>';
  const w = 400, h = 150, pad = 25;
  const minT = timeline[0].time, maxT = timeline[timeline.length - 1].time;
  const range = maxT - minT || 1;
  const buckets = 15;
  const bucketSize = range / buckets;
  
  // Get unique agents and bucket tokens by agent
  const agents = [...new Set(timeline.map(e => e.agent))];
  const data = {};
  for (const a of agents) data[a] = Array(buckets).fill(0);
  for (const e of timeline) {
    const i = Math.min(Math.floor((e.time - minT) / bucketSize), buckets - 1);
    data[e.agent][i] += e.tokens || 0;
  }
  
  // Find max stack height
  const maxStack = Math.max(...Array(buckets).fill(0).map((_, i) => agents.reduce((s, a) => s + data[a][i], 0)), 1);
  
  // Cumulative line data
  let cumulative = 0;
  const cumPoints = timeline.map(e => { cumulative += e.tokens || 0; return { time: e.time, tokens: cumulative }; });
  const maxTok = cumPoints[cumPoints.length - 1].tokens || 1;
  
  const barW = (w - pad * 2) / buckets;
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  
  // Stacked bars
  for (let i = 0; i < buckets; i++) {
    let y = h - pad;
    for (const a of agents) {
      const segH = (data[a][i] / maxStack) * (h - pad * 2);
      if (segH > 0) {
        svg += '<rect x="' + (pad + i * barW) + '" y="' + (y - segH) + '" width="' + (barW - 2) + '" height="' + segH + '" fill="' + agentColor(a) + '" opacity="0.7"/>';
        y -= segH;
      }
    }
  }
  
  // Cumulative line (scaled to same height)
  let path = '';
  for (let i = 0; i < cumPoints.length; i++) {
    const x = pad + ((cumPoints[i].time - minT) / range) * (w - pad * 2);
    const y = h - pad - (cumPoints[i].tokens / maxTok) * (h - pad * 2);
    path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }
  svg += '<path d="' + path + '" fill="none" stroke="#d29922" stroke-width="2"/>';
  
  svg += '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#30363d"/>';
  svg += '<text x="' + (w - pad) + '" y="' + (h - 8) + '" fill="#8b949e" font-size="9" text-anchor="end">' + (maxTok >= 1000 ? (maxTok/1000).toFixed(1) + 'k' : maxTok) + ' total</text>';
  svg += '<text x="' + pad + '" y="12" fill="#d29922" font-size="9">— cumulative</text>';
  svg += '</svg>';
  return svg;
}

function renderTokenByAgent(agentAgg) {
  const entries = Object.entries(agentAgg).filter(([_, s]) => s.tokens && (s.tokens.input + s.tokens.output) > 0).sort((a, b) => (b[1].tokens.input + b[1].tokens.output) - (a[1].tokens.input + a[1].tokens.output));
  if (!entries.length) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">No token data</text></svg>';
  const w = 400, h = 150, pad = 25;
  const maxTok = entries[0][1].tokens.input + entries[0][1].tokens.output;
  const barH = Math.min(20, (h - pad * 2) / entries.length - 2);
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  entries.slice(0, 5).forEach(([agent, stats], i) => {
    const total = stats.tokens.input + stats.tokens.output;
    const barW = (total / maxTok) * (w - pad * 2 - 80);
    const y = pad + i * (barH + 4);
    svg += '<rect x="80" y="' + y + '" width="' + barW + '" height="' + barH + '" fill="' + agentColor(agent) + '" rx="2"/>';
    svg += '<text x="78" y="' + (y + barH - 4) + '" fill="#8b949e" font-size="9" text-anchor="end">' + agent.split('-')[0] + '</text>';
    svg += '<text x="' + (82 + barW) + '" y="' + (y + barH - 4) + '" fill="#8b949e" font-size="9">' + (total >= 1000 ? (total/1000).toFixed(1) + 'k' : total) + '</text>';
  });
  svg += '</svg>';
  return svg;
}

function renderHumanChart(timeline) {
  if (!timeline || timeline.length < 2) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">Not enough data</text></svg>';
  const humanEvents = timeline.filter(e => e.agent === 'human');
  if (!humanEvents.length) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">No human interactions</text></svg>';
  
  const w = 400, h = 150, pad = 25;
  const minT = timeline[0].time, maxT = timeline[timeline.length - 1].time;
  const range = maxT - minT || 1;
  
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  
  // Draw timeline axis
  svg += '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#30363d"/>';
  
  // Draw human interaction markers
  humanEvents.forEach((e, i) => {
    const x = pad + ((e.time - minT) / range) * (w - pad * 2);
    svg += '<line x1="' + x + '" y1="' + pad + '" x2="' + x + '" y2="' + (h - pad) + '" stroke="#f778ba" stroke-width="2" opacity="0.6"/>';
    svg += '<circle cx="' + x + '" cy="' + (h/2) + '" r="6" fill="#f778ba"/>';
    svg += '<text x="' + x + '" y="' + (h/2 - 12) + '" fill="#f778ba" font-size="9" text-anchor="middle">' + (i + 1) + '</text>';
  });
  
  svg += '<text x="' + pad + '" y="' + (h - 8) + '" fill="#8b949e" font-size="9">Start</text>';
  svg += '<text x="' + (w - pad) + '" y="' + (h - 8) + '" fill="#8b949e" font-size="9" text-anchor="end">End</text>';
  svg += '<text x="' + (w/2) + '" y="12" fill="#f778ba" font-size="10" text-anchor="middle">' + humanEvents.length + ' human input' + (humanEvents.length > 1 ? 's' : '') + '</text>';
  svg += '</svg>';
  return svg;
}

function renderEfficiencyChart(timeline) {
  if (!timeline || timeline.length < 2) return '<svg viewBox="0 0 400 150"><text x="200" y="75" fill="#484f58" text-anchor="middle" font-size="12">Not enough data</text></svg>';
  
  const w = 400, h = 150, pad = 25;
  const minT = timeline[0].time, maxT = timeline[timeline.length - 1].time;
  const range = maxT - minT || 1;
  const buckets = 20;
  const bucketSize = range / buckets;
  
  // Aggregate tokens and diffTokens per bucket
  const data = Array(buckets).fill(null).map(() => ({ tokens: 0, diffTokens: 0 }));
  timeline.forEach(e => {
    const idx = Math.min(Math.floor((e.time - minT) / bucketSize), buckets - 1);
    data[idx].tokens += e.tokens || 0;
    data[idx].diffTokens += e.diffTokens || 0;
  });
  
  // Cumulative
  let cumTok = 0, cumDiff = 0;
  data.forEach(d => { cumTok += d.tokens; d.cumTok = cumTok; cumDiff += d.diffTokens; d.cumDiff = cumDiff; });
  
  const maxTok = cumTok || 1;
  const chartW = w - pad * 2, chartH = h - pad * 2;
  
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '">';
  svg += '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#30363d"/>';
  svg += '<line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (h - pad) + '" stroke="#30363d"/>';
  
  // Draw cumulative lines
  let tokPath = '', diffPath = '';
  data.forEach((d, i) => {
    const x = pad + (i / buckets) * chartW;
    const yTok = h - pad - (d.cumTok / maxTok) * chartH;
    const yDiff = h - pad - (d.cumDiff / maxTok) * chartH;
    tokPath += (i === 0 ? 'M' : 'L') + x + ',' + yTok;
    diffPath += (i === 0 ? 'M' : 'L') + x + ',' + yDiff;
  });
  svg += '<path d="' + tokPath + '" fill="none" stroke="#f0883e" stroke-width="2"/>';
  svg += '<path d="' + diffPath + '" fill="none" stroke="#3fb950" stroke-width="2"/>';
  
  // Legend
  svg += '<circle cx="' + (w - 100) + '" cy="12" r="4" fill="#f0883e"/><text x="' + (w - 92) + '" y="15" fill="#8b949e" font-size="9">Total</text>';
  svg += '<circle cx="' + (w - 55) + '" cy="12" r="4" fill="#3fb950"/><text x="' + (w - 47) + '" y="15" fill="#8b949e" font-size="9">Diff</text>';
  
  const ratio = cumDiff > 0 ? Math.round(cumTok / cumDiff) : 0;
  svg += '<text x="' + pad + '" y="12" fill="#8b949e" font-size="10">Ratio: ' + (ratio > 0 ? ratio + ':1' : '—') + '</text>';
  svg += '</svg>';
  return svg;
}

// Chat functionality
const chatToggle = document.getElementById('chatToggle');
const chatLabel = document.getElementById('chatLabel');
const chatDropdown = document.getElementById('chatDropdown');
const chatProviderMenu = document.getElementById('chatProviderMenu');
const chatTitle = document.getElementById('chatTitle');
const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
let currentChatId = null;
let chatEventSource = null;
let chatProvider = 'opencode';

chatDropdown.addEventListener('click', e => {
  e.stopPropagation();
  chatProviderMenu.classList.toggle('open');
});

document.querySelectorAll('.chat-provider-option').forEach(btn => {
  btn.addEventListener('click', () => {
    chatProvider = btn.dataset.provider;
    document.querySelectorAll('.chat-provider-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    chatLabel.textContent = '💬 Chat with ' + (chatProvider === 'opencode' ? 'OpenCode' : 'Kiro');
    chatTitle.textContent = '🤖 ' + (chatProvider === 'opencode' ? 'OpenCode' : 'Kiro') + ' Analysis Chat';
    chatProviderMenu.classList.remove('open');
  });
});

document.addEventListener('click', () => chatProviderMenu.classList.remove('open'));

chatToggle.addEventListener('click', e => {
  if (e.target === chatDropdown) return;
  if (chatPanel.classList.contains('open')) {
    closeChat();
  } else {
    startChat();
  }
});

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

async function startChat() {
  if (!projectEl.value || !sessionEl.value) return;
  chatToggle.disabled = true;
  chatToggle.textContent = '⏳ Starting...';
  chatMessages.innerHTML = '<div class="chat-msg system">Connecting to Kiro...</div>';
  
  try {
    const res = await fetch('/api/chat/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectID: projectEl.value, sessionID: sessionEl.value, provider: chatProvider })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    currentChatId = data.chatId;
    chatPanel.classList.add('open');
    chatToggle.textContent = '💬 Chat Open';
    chatToggle.disabled = false;
    chatMessages.innerHTML = '<div class="chat-msg system">Session loaded. Ask questions about this swarm session.</div>';
    
    // Connect SSE
    chatEventSource = new EventSource('/api/chat/stream/' + currentChatId);
    chatEventSource.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.done) {
        chatSend.disabled = false;
        return;
      }
      if (msg.text) {
        appendAssistantText(msg.text);
      }
    };
    chatEventSource.onerror = () => {
      appendSystemMsg('Connection lost');
      chatEventSource.close();
    };
  } catch (e) {
    chatMessages.innerHTML = '<div class="chat-msg system">Error: ' + e.message + '</div>';
    chatToggle.textContent = '💬 Chat with Kiro';
    chatToggle.disabled = false;
  }
}

function closeChat() {
  if (currentChatId) {
    fetch('/api/chat/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: currentChatId })
    });
  }
  if (chatEventSource) chatEventSource.close();
  currentChatId = null;
  chatEventSource = null;
  chatPanel.classList.remove('open');
  chatToggle.textContent = '💬 Chat with Kiro';
}

let lastAssistantEl = null;
function appendAssistantText(text) {
  if (!lastAssistantEl || lastAssistantEl.classList.contains('user')) {
    lastAssistantEl = document.createElement('div');
    lastAssistantEl.className = 'chat-msg assistant';
    chatMessages.appendChild(lastAssistantEl);
  }
  lastAssistantEl.textContent += text;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'chat-msg system';
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  lastAssistantEl = null;
}

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !currentChatId) return;
  
  chatInput.value = '';
  chatSend.disabled = true;
  lastAssistantEl = null;
  
  const userEl = document.createElement('div');
  userEl.className = 'chat-msg user';
  userEl.textContent = msg;
  chatMessages.appendChild(userEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  await fetch('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: currentChatId, message: msg })
  });
}

// Enable chat button when session selected
sessionEl.addEventListener('change', () => {
  chatToggle.disabled = !sessionEl.value;
  if (currentChatId) closeChat();
});

// Swarm files
const swarmToggle = document.getElementById('swarmToggle');
const swarmPanel = document.getElementById('swarmPanel');
const fileModal = document.getElementById('fileModal');
const fileModalOverlay = document.getElementById('fileModalOverlay');
const fileModalTitle = document.getElementById('fileModalTitle');
const fileModalContent = document.getElementById('fileModalContent');
let currentProjectDir = null;
let currentReferencedFiles = [];
let swarmPollInterval = null;

swarmToggle.addEventListener('change', () => {
  if (swarmToggle.checked && currentProjectDir) {
    loadSwarmFiles();
    swarmPollInterval = setInterval(loadSwarmFiles, 5000);
  } else {
    swarmPanel.innerHTML = '';
    if (swarmPollInterval) { clearInterval(swarmPollInterval); swarmPollInterval = null; }
  }
});

projectEl.addEventListener('change', () => {
  currentProjectDir = null;
  swarmPanel.innerHTML = '';
});

async function loadSwarmFiles() {
  if (!currentProjectDir || !swarmToggle.checked) return;
  const swarm = await api('/api/swarm/' + encodeURIComponent(currentProjectDir));
  if (!swarm) { swarmPanel.innerHTML = '<div class="swarm-section"><div class="swarm-empty">No .opencode directory found</div></div>'; return; }
  renderSwarmPanel(swarm);
}

function renderSwarmPanel(swarm) {
  // Filter to only show files referenced in this session
  const refs = new Set(currentReferencedFiles);
  const isReferenced = (path) => refs.has(path) || currentReferencedFiles.some(r => r.includes(path) || path.includes(r.split('/').pop()));
  
  // Also match by ID pattern (e.g., REQ-017 matches requirements/REQ-017.md)
  const extractIds = () => {
    const ids = new Set();
    currentReferencedFiles.forEach(f => {
      const match = f.match(/(?:REQ|TASKS|TASK)-(\d+)/i);
      if (match) ids.add(match[1]);
    });
    return ids;
  };
  const refIds = extractIds();
  const matchesId = (file) => {
    const match = file.match(/(?:REQ|TASKS|TASK)-(\d+)/i);
    return match && refIds.has(match[1]);
  };
  
  const filterByRef = (items, pathKey = 'path') => {
    if (!currentReferencedFiles.length) return items; // Show all if no refs
    return items.filter(item => isReferenced(item[pathKey]) || matchesId(item.file));
  };
  
  let html = '';
  
  // Requirements
  const reqs = filterByRef(swarm.requirements);
  html += '<div class="swarm-section"><h3>📋 Requirements <span class="count">' + reqs.length + '</span></h3>';
  if (reqs.length) {
    html += '<div class="swarm-list">';
    reqs.forEach(r => {
      const status = r.approved === 'true' ? 'approved' : 'pending';
      html += '<div class="swarm-item"><span class="name">' + r.file + '</span>';
      html += '<span class="status ' + status + '">' + (r.approved === 'true' ? 'Approved' : 'Pending') + '</span>';
      html += '<button class="swarm-btn" data-path="' + encodeURIComponent(r.path) + '" onclick="viewFile(decodeURIComponent(this.dataset.path))">View</button></div>';
    });
    html += '</div>';
  } else { html += '<div class="swarm-empty">No requirements for this session</div>'; }
  html += '</div>';
  
  // Designs
  const designs = filterByRef(swarm.designs);
  html += '<div class="swarm-section"><h3>📐 Designs <span class="count">' + designs.length + '</span></h3>';
  if (designs.length) {
    html += '<div class="swarm-list">';
    designs.forEach(d => {
      const status = d.approved === 'true' ? 'approved' : 'pending';
      html += '<div class="swarm-item"><span class="name">' + d.file + '</span>';
      html += '<span class="status ' + status + '">' + (d.approved === 'true' ? 'Approved' : 'Pending') + '</span>';
      html += '<button class="swarm-btn" data-path="' + encodeURIComponent(d.path) + '" onclick="viewFile(decodeURIComponent(this.dataset.path))">View</button></div>';
    });
    html += '</div>';
  } else { html += '<div class="swarm-empty">No designs for this session</div>'; }
  html += '</div>';
  
  // Tasks
  const tasks = filterByRef(swarm.tasks);
  const taskCount = tasks.reduce((s, t) => s + t.items.length, 0);
  html += '<div class="swarm-section"><h3>📝 Tasks <span class="count">' + taskCount + '</span></h3>';
  if (tasks.length) {
    tasks.forEach(taskFile => {
      const done = taskFile.items.filter(t => t.done).length;
      const total = taskFile.items.length;
      html += '<div style="margin-bottom:8px;font-size:0.85em;color:#8b949e">' + taskFile.file + ' (' + done + '/' + total + ' done) <button class="swarm-btn" data-path="' + encodeURIComponent(taskFile.path) + '" onclick="viewFile(decodeURIComponent(this.dataset.path))">View</button></div>';
      html += '<div class="swarm-list">';
      taskFile.items.forEach(t => {
        html += '<div class="swarm-item"><span class="status ' + (t.done ? 'done' : 'pending') + '">' + (t.done ? '✓' : '○') + '</span>';
        html += '<span class="name">' + t.id + ': ' + t.title + '</span>';
        if (t.agent) html += '<span class="agent">' + t.agent + '</span>';
        html += '</div>';
      });
      html += '</div>';
    });
  } else { html += '<div class="swarm-empty">No tasks for this session</div>'; }
  html += '</div>';
  
  // Context cache
  const ctx = filterByRef(swarm.context);
  html += '<div class="swarm-section"><h3>🧠 Cached Knowledge <span class="count">' + ctx.length + '</span></h3>';
  if (ctx.length) {
    html += '<div class="swarm-list">';
    ctx.forEach(c => {
      html += '<div class="swarm-item"><span class="name">' + c.file + '</span>';
      html += '<button class="swarm-btn" data-path="' + encodeURIComponent(c.path) + '" onclick="viewFile(decodeURIComponent(this.dataset.path))">View</button></div>';
    });
    html += '</div>';
  } else { html += '<div class="swarm-empty">No cached knowledge for this session</div>'; }
  html += '</div>';
  
  // Task Progress Chart
  if (tasks.length && taskCount > 0) {
    const totalDone = tasks.reduce((s, t) => s + t.items.filter(i => i.done).length, 0);
    const pct = Math.round((totalDone / taskCount) * 100);
    html += '<div class="swarm-section"><h3>📊 Task Progress</h3>';
    html += '<div style="margin-bottom:8px;font-size:0.9em;color:#c9d1d9">' + totalDone + ' / ' + taskCount + ' tasks complete (' + pct + '%)</div>';
    html += '<div class="bar" style="height:12px;margin-bottom:12px"><div class="bar-fill" style="width:' + pct + '%;background:linear-gradient(90deg, #3fb950, #56d364)"></div></div>';
    // Per-phase breakdown
    tasks.forEach(taskFile => {
      const phases = {};
      taskFile.items.forEach(t => {
        const phase = t.id.split('.')[0];
        if (!phases[phase]) phases[phase] = { done: 0, total: 0 };
        phases[phase].total++;
        if (t.done) phases[phase].done++;
      });
      if (Object.keys(phases).length > 1) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        Object.entries(phases).forEach(([phase, data]) => {
          const phasePct = Math.round((data.done / data.total) * 100);
          const color = phasePct === 100 ? '#3fb950' : phasePct > 0 ? '#d29922' : '#484f58';
          html += '<div style="font-size:0.8em;color:#8b949e">Phase ' + phase + ': <span style="color:' + color + '">' + data.done + '/' + data.total + '</span></div>';
        });
        html += '</div>';
      }
    });
    html += '</div>';
  }
  
  // Validations - filter by task ID
  const vals = swarm.validations.filter(v => refIds.has(v.taskId.replace(/\\D/g, '')) || currentReferencedFiles.some(f => f.includes(v.taskId)));
  html += '<div class="swarm-section"><h3>✅ Validations <span class="count">' + vals.length + '</span></h3>';
  if (vals.length) {
    vals.forEach(v => {
      html += '<div style="margin-bottom:4px;font-size:0.85em;color:#8b949e">' + v.taskId + '</div>';
      html += '<div class="swarm-list">';
      v.phases.forEach(p => {
        const status = p.status === 'PASS' ? 'done' : 'pending';
        html += '<div class="swarm-item"><span class="status ' + status + '">' + (p.status || '?') + '</span>';
        html += '<span class="name">' + p.file + '</span></div>';
      });
      html += '</div>';
    });
  } else { html += '<div class="swarm-empty">No validations for this session</div>'; }
  html += '</div>';
  
  swarmPanel.innerHTML = html;
}

function renderMarkdown(md) {
  if (!md) return '';
  // Remove YAML frontmatter
  let content = md.replace(new RegExp('^---[\\\\s\\\\S]*?---\\\\n*', 'm'), '');
  
  // Escape HTML
  content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Task lists with agent parsing - [ ] or [x] followed by task number and optional (agent)
  content = content.replace(new RegExp('^[-*]\\\\s*\\\\[([x ])\\\\]\\\\s*(?:\\\\*\\\\*)?([0-9]+(?:\\\\.[0-9]+)?)\\\\*?\\\\*?[:.]\\\\s*(.+?)(?:\\\\s*\\\\(([^)]+)\\\\))?$', 'gim'), (_, check, num, text, agent) => {
    const done = check.toLowerCase() === 'x';
    const agentTag = agent ? '<span class="task-agent">' + agent + '</span>' : '';
    return '<div class="task-item"><span class="task-check ' + (done ? 'done' : 'pending') + '">' + (done ? '✓' : '○') + '</span><span class="task-text"><strong>' + num + ':</strong> ' + text + '</span>' + agentTag + '</div>';
  });
  
  // Regular task lists - [ ] or [x]
  content = content.replace(new RegExp('^[-*]\\\\s*\\\\[([x ])\\\\]\\\\s*(.+)$', 'gim'), (_, check, text) => {
    const done = check.toLowerCase() === 'x';
    return '<div class="task-item"><span class="task-check ' + (done ? 'done' : 'pending') + '">' + (done ? '✓' : '○') + '</span><span class="task-text">' + text + '</span></div>';
  });
  
  // Code blocks (using char code to avoid template literal issues)
  const bt = String.fromCharCode(96);
  const codeBlockRe = new RegExp(bt+bt+bt+'(\\\\w*)\\\\n([\\\\s\\\\S]*?)'+bt+bt+bt, 'g');
  content = content.replace(codeBlockRe, '<pre><code>$2</code></pre>');
  
  // Inline code
  const inlineCodeRe = new RegExp(bt+'([^'+bt+']+)'+bt, 'g');
  content = content.replace(inlineCodeRe, '<code>$1</code>');
  
  // Headers
  content = content.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  content = content.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  content = content.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Bold and italic
  content = content.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  content = content.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
  
  // Blockquotes
  content = content.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  
  // Horizontal rules
  content = content.replace(/^---$/gm, '<hr>');
  
  // Lists (simple)
  content = content.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  content = content.replace(new RegExp('(<li>.*</li>\\\\n?)+', 'g'), '<ul>$&</ul>');
  
  // Numbered lists
  content = content.replace(new RegExp('^\\\\d+\\\\. (.+)$', 'gm'), '<li>$1</li>');
  
  // Paragraphs (lines not already wrapped)
  content = content.replace(/^(?!<[hupblo]|<div|<li|<hr)(.+)$/gm, '<p>$1</p>');
  
  // Clean up empty paragraphs
  content = content.replace(new RegExp('<p>\\\\s*</p>', 'g'), '');
  
  return content;
}

async function viewFile(relativePath) {
  if (!currentProjectDir) return;
  const fullPath = currentProjectDir + '/' + relativePath;
  const content = await fetch('/api/file?path=' + encodeURIComponent(fullPath)).then(r => r.text());
  fileModalTitle.textContent = relativePath;
  
  if (relativePath.endsWith('.md')) {
    fileModalContent.innerHTML = '<div class="md-content">' + renderMarkdown(content) + '</div>';
  } else {
    fileModalContent.innerHTML = '<pre>' + content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
  }
  
  fileModal.classList.add('open');
  fileModalOverlay.classList.add('open');
}

function closeFileModal() {
  fileModal.classList.remove('open');
  fileModalOverlay.classList.remove('open');
}

init();
</script></body></html>`;

function generateReportContext(tree) {
  if (!tree) return 'No session data available.';
  const flat = [];
  function flatten(n, d = 0) { flat.push({ ...n, depth: d }); (n.children || []).forEach(c => flatten(c, d + 1)); }
  flatten(tree);
  
  let ctx = `# Swarm Session Report\n\n`;
  ctx += `**Session:** ${tree.title || tree.id}\n`;
  ctx += `**Total Messages:** ${flat.reduce((s, n) => s + n.messages, 0)}\n`;
  ctx += `**Total Diffs:** ${flat.reduce((s, n) => s + n.diffs, 0)}\n`;
  ctx += `**Tokens:** ${tree.tokens ? (tree.tokens.input + tree.tokens.output) + (tree.tokens.estimated ? ' (estimated)' : '') : 'N/A'}\n\n`;
  
  ctx += `## Session Tree\n`;
  for (const n of flat) {
    const indent = '  '.repeat(n.depth);
    ctx += `${indent}- **${n.agent || 'unknown'}**: ${n.messages} msgs, ${n.diffs} diffs${n.tokens ? ', ' + (n.tokens.input + n.tokens.output) + ' tokens' : ''}\n`;
  }
  
  ctx += `\n## Agent Summary\n`;
  const agentAgg = {};
  for (const n of flat) {
    for (const [a, s] of Object.entries(n.agents || {})) {
      if (!agentAgg[a]) agentAgg[a] = { messages: 0, diffs: 0, tokens: 0 };
      agentAgg[a].messages += s.messages;
      agentAgg[a].diffs += s.diffs;
      if (s.tokens) agentAgg[a].tokens += (s.tokens.input || 0) + (s.tokens.output || 0);
    }
  }
  for (const [a, s] of Object.entries(agentAgg).sort((x, y) => y[1].messages - x[1].messages)) {
    ctx += `- **${a}**: ${s.messages} msgs, ${s.diffs} diffs, ${s.tokens} tokens\n`;
  }
  
  return ctx;
}

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(HTML);
  }

  if (url.pathname === '/api/projects') {
    const projects = getProjects().map(id => {
      const sessions = getSessions(id);
      return { id, directory: sessions[0]?.directory, sessions: sessions.length };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(projects));
  }

  if (url.pathname.startsWith('/api/sessions/')) {
    const projectID = url.pathname.split('/')[3];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getSessions(projectID)));
  }

  if (url.pathname.startsWith('/api/tree/')) {
    const parts = url.pathname.split('/');
    const tree = buildTree(parts[3], parts[4]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(tree));
  }

  // Swarm files
  if (url.pathname.startsWith('/api/swarm/')) {
    const projectDir = decodeURIComponent(url.pathname.slice(11));
    const swarm = getSwarmFiles(projectDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(swarm));
  }

  // Read file content
  if (url.pathname === '/api/file' && url.searchParams.has('path')) {
    const filePath = url.searchParams.get('path');
    // Security: only allow .opencode paths
    if (!filePath.includes('.opencode/')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const content = readFile(filePath);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(content || 'File not found');
  }

  // Chat: Start new session
  if (url.pathname === '/api/chat/start' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { projectID, sessionID, provider } = JSON.parse(body);
        const tree = buildTree(projectID, sessionID);
        const context = generateReportContext(tree);
        const chatId = 'chat_' + Date.now();
        
        const cmd = provider === 'kiro' ? 'kiro-cli' : 'opencode';
        const args = provider === 'kiro' ? ['chat'] : ['chat', '-p'];
        
        const proc = spawn(cmd, args, {
          cwd: KIRO_CWD,
          env: { ...process.env, TERM: 'dumb' },
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        chatSessions.set(chatId, { proc, clients: [], buffer: '' });
        
        // Send initial context
        const initPrompt = `You are analyzing an OpenCode swarm session. Here is the session report:\n\n${context}\n\nThe user will ask questions about this session. Answer based on the data provided. Be concise.\n\nReady to answer questions about this session.`;
        proc.stdin.write(initPrompt + '\n');
        
        proc.stdout.on('data', data => {
          const session = chatSessions.get(chatId);
          if (session) {
            const text = data.toString();
            session.buffer += text;
            session.clients.forEach(c => c.write(`data: ${JSON.stringify({ text })}\n\n`));
          }
        });
        
        proc.stderr.on('data', data => {
          console.error('kiro stderr:', data.toString());
        });
        
        proc.on('close', () => {
          const session = chatSessions.get(chatId);
          if (session) {
            session.clients.forEach(c => { c.write('data: {"done":true}\n\n'); c.end(); });
            chatSessions.delete(chatId);
          }
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ chatId }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Chat: Send message
  if (url.pathname === '/api/chat/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { chatId, message } = JSON.parse(body);
        const session = chatSessions.get(chatId);
        if (!session) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Chat session not found' }));
        }
        session.buffer = '';
        session.proc.stdin.write(message + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Chat: SSE stream
  if (url.pathname.startsWith('/api/chat/stream/')) {
    const chatId = url.pathname.split('/')[4];
    const session = chatSessions.get(chatId);
    if (!session) {
      res.writeHead(404);
      return res.end('Chat not found');
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    session.clients.push(res);
    // Send buffered content
    if (session.buffer) {
      res.write(`data: ${JSON.stringify({ text: session.buffer })}\n\n`);
    }
    req.on('close', () => {
      session.clients = session.clients.filter(c => c !== res);
    });
    return;
  }

  // Chat: End session
  if (url.pathname === '/api/chat/end' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { chatId } = JSON.parse(body);
      const session = chatSessions.get(chatId);
      if (session) {
        session.proc.stdin.write('/quit\n');
        session.proc.kill();
        chatSessions.delete(chatId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

http.createServer(handler).listen(PORT, () => {
  console.log(`Swarm Dashboard: http://localhost:${PORT}`);
  console.log(`Kiro CWD: ${KIRO_CWD}`);
});
