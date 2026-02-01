# OpenCode Agent Swarm Configuration

This repository contains a sophisticated multi-agent system built on [OpenCode](https://opencode.ai) for automated software development workflows.

## Overview

Our setup uses a **protocol-driven agent swarm** with clear separation of concerns, human approval gates, and reusable skills. The system follows a structured workflow from requirements gathering through implementation to validation.

## Architecture

### Agent Flow

```
User Request
    ↓
Product Owner (requirements approval)
    ↓
Architect (design approval)
    ↓
Orchestrator (merge approval)
    ↓
Engineers (implementation)
    ↓
Validator (quality gate)
```

### Key Principles

- **Protocol-Driven**: Agents communicate via XML payloads for structured handoffs
- **Human Gates**: Critical decisions require human approval (requirements, design, merge)
- **Context Injection**: Sub-agents receive full context via XML to prevent hallucination
- **Circuit Breaker**: Automatic rollback and escalation on repeated failures
- **One-Way Handoffs**: Clear ownership boundaries (no callback loops)

## Agents

### Primary Agents

#### Product Owner (`product-owner.md`)
**Role**: Requirements gathering and EARS validation  
**Mode**: Primary  
**Triggers**: User requests for new features

**Thought Pattern**: EARS Translation
1. **Context**: Read user preferences from memory
2. **Clarify**: Ask questions if request is vague (never guess)
3. **Translate**: Convert user request to EARS format (Trigger → Response)
4. **Document**: Write `.opencode/requirements/REQ-[id].md`
5. **Gate**: Get human approval before handoff

**Responsibilities**:
- Transform user requests into EARS-formatted requirements
- Validate requirements are unambiguous
- Create `.opencode/requirements/REQ-[id].md` files
- Get human approval before handoff
- Delegate to Architect

**Key Rules**:
- Cannot read or write source code (Air Gap Rule)
- Cannot run shell commands
- Must use EARS templates (Event-Driven, State-Driven, etc.)
- Reads user preferences from memory

### Subagents

#### Architect (`architect.md`)
**Role**: Design and architecture validation  
**Model**: google/gemini-3-pro-preview  
**Max Steps**: 25

**Thought Pattern**: Skeleton of Thought (SoT)
1. **Skeleton**: Output file tree or interface definitions ONLY
2. **Review**: Verify skeleton covers all requirements
3. **Expansion**: Generate detailed content only after skeleton approval

**Responsibilities**:
- Validate EARS requirements (reject if ambiguous)
- Create interface skeletons (types.ts, interface.go)
- Write design documentation (`.opencode/designs/[feature].md`)
- Get human approval on architecture
- Hand off to Orchestrator

**Key Protocols**:
- **EARS Gatekeeper**: Reject non-compliant requirements
- **Context First**: Always query project-knowledge before designing
- **Design Only**: No implementation, no worktrees

#### Orchestrator (`orchestrator.md`)
**Role**: Implementation coordination and gate management  
**Model**: google/gemini-3-pro-preview  
**Max Steps**: 30

**Thought Pattern**: Task Decomposition + Context Injection
1. **Parse**: Extract design from Architect's XML handoff
2. **Decompose**: Break into atomic tasks (≤3 files each) using task-planner skill
3. **Route**: Determine which engineer handles each task
4. **Inject**: Provide full context via XML payloads (goal, design doc, target file, protocol)
5. **Monitor**: Track progress and handle failures

**Responsibilities**:
- Create isolated worktrees for features
- Break design into atomic tasks (≤3 files each)
- Delegate to specialized engineers via XML payloads
- Manage security, validation, and merge gates
- Handle feasibility issues autonomously
- Clean up worktrees after completion

**Key Protocols**:
- **Context Injection**: Provide full context to engineers via XML (prevents cold boot hallucination)
- **Circuit Breaker**: Rollback and escalate after 3 failures or >$2 cost
- **PBT Selection**: Require property-based testing for data transformation, math, crypto
- **Feasibility Authority**: Make implementation calls without callback to Architect

#### Engineering Specialists

**System Engineer** (`system-engineer.md`)
- Backend logic and business rules
- **Thought Pattern**: Chain of Code (CoC)
  - Simulate: Draft interface/pseudocode in `sequentialthinking`
  - Execute: Immediately implement with `edit_file`
  - Silence: Keep draft in tool, don't output to chat
- Uses code graph for context discovery

**UI Engineer** (`ui-engineer.md`)
- Frontend components and visual elements
- **Thought Pattern**: Chain of Draft (CoD)
  - Draft: Plan component structure (JSX hierarchy, CSS classes, state/props)
  - Execute: Immediately implement with `edit_file`
  - Silence: Keep draft in tool, don't output to chat
- Uses `canvas_render` to verify visual output

**DevOps Engineer** (`devops-engineer.md`)
- Infrastructure, CI/CD, deployment
- **Thought Pattern**: Chain of Code (CoC)
  - Simulate: Draft configuration/script in `sequentialthinking`
  - Execute: Immediately implement
  - Silence: Keep draft in tool
- Terraform, Docker, GitHub Actions expertise

**Fullstack Engineer** (`fullstack-engineer.md`)
- Atomic tasks (<3 files only)
- **Thought Pattern**: Chain of Code (CoC)
  - Same as System Engineer but with strict file limit
  - Delegates if scope exceeds 3 files
- Cross-stack features

**QA Engineer** (`qa-engineer.md`)
- Unit, integration, and property-based tests
- **Thought Pattern**: EARS Mapping
  - Translate requirements to test cases
  - EARS: "When [X], System shall [Y]" → Test: "When [X], should [Y]"
  - AAA pattern (Arrange-Act-Assert)
- 80% coverage minimum, 90% target
- Property-based testing for data transformation, math, crypto

**Security Engineer** (`security-engineer.md`)
- Security audits for auth, payments, crypto
- **Thought Pattern**: Data Flow Analysis
  - Trace tainted data through code graph
  - Hunt for vulnerability patterns (injection, XSS, secrets)
  - Report findings without fixing (read-only)
- OWASP compliance

**Documentation Engineer** (`documentation-engineer.md`)
- Technical documentation
- API docs, README updates

#### Support Agents

**Staff Engineer** (`staff-engineer.md`)
- Complex debugging and rescue missions
- **Thought Pattern**: Anti-Hallucination Protocol
  - Verify: Read live documentation with `webfetch`/`chrome-devtools` before using new libraries
  - Analyze: Trace dependencies deep into `node_modules` with code graph
  - Implement: Only after verification
- New library integration
- Cross-cutting changes (>3 domains)

**Validator** (`validator.md`)
- Quality gatekeeper
- **Thought Pattern**: Three-Verdict System
  - FAIL: Logic bugs, missed requirements, failing tests
  - WARN: Style issues (functional but messy)
  - PASS: Perfect compliance
- Cannot edit code (read-only)
- Runs linters, tests, checks requirements coverage

**Project Knowledge** (`project-knowledge.md`)
- Project memory and context management
- **Thought Pattern**: Graph + Memory Synthesis
  - Query code graph for structural context
  - Query memory for lessons learned
  - Synthesize into actionable context map
- Memory audits every 10 tasks or >500 lines

**Tech Lead** (`tech-lead.md`) ⚠️ DEPRECATED
- Legacy agent being phased out
- Functionality split into Architect + Orchestrator

## Skills

Skills are reusable instruction sets loaded on-demand by agents. Located in `skills/` directory.

### Available Skills

#### `bash-strategy`
Safe shell command execution patterns. Prevents destructive operations.

#### `code-style-analyst`
Pattern recognition for existing code style. Ensures consistency with codebase conventions.

#### `coding-guidelines`
Core coding principles: naming, error handling, security, testing standards.

#### `dependency-management`
Pre-approved library lists, security vetting, version pinning standards.

**Pre-approved Libraries**:
- Testing: jest, vitest, pytest, testify, fast-check
- Dev Tools: eslint, prettier, golangci-lint

#### `design-architect`
Technical design document standards. Table of contents, Mermaid diagrams, external references.

#### `git-workflow`
Conventional commits, branching strategy, PR standards, semantic versioning.

#### `golang-expert`
Go-specific best practices: Clean Architecture, microservices, OpenTelemetry, performance.

#### `memory-management`
Memory audit protocol, conflict resolution, garbage collection. Triggers every 10 tasks or >500 lines.

#### `prompt-engineering`
Effective prompt construction for AI agents.

#### `task-planner`
Task breakdown standards. Rule of 3 (≤3 files per task), requirements/design linking.

#### `technical-writer`
Documentation standards for user-facing content.

#### `terraform-expert`
Infrastructure as Code best practices for Terraform.

#### `testing-standards`
Comprehensive testing guidance: unit, integration, property-based, E2E. Testing pyramid ratios.

## Protocols

### XML Handoff Format

**Product Owner → Architect**:
```xml
<handoff type="requirements">
  <context>
    <constraint>[User Pref 1]</constraint>
  </context>
  <requirements>
    <file>.opencode/requirements/REQ-[id].md</file>
  </requirements>
  <goal>[Brief summary]</goal>
</handoff>
```

**Architect → Orchestrator**:
```xml
<handoff type="design">
  <context>
    <constraint>[User Pref 1]</constraint>
  </context>
  <design>
    <file>.opencode/designs/[feature].md</file>
    <interfaces>
      <file>src/types.ts</file>
    </interfaces>
  </design>
  <requirements>
    <file>.opencode/requirements/REQ-[id].md</file>
  </requirements>
  <goal>[Brief summary]</goal>
</handoff>
```

**Orchestrator → Engineer**:
```xml
<task type="implementation">
  <objective>Implement the UUID generator logic.</objective>
  <resources>
    <design_doc>.opencode/designs/utils.md</design_doc>
    <target_file>src/utils.ts</target_file>
    <interface_file>src/types.ts</interface_file>
  </resources>
  <protocol>
    <instruction>Use Chain of Code. Do not chat. Output code immediately.</instruction>
    <test_strategy>property</test_strategy>
  </protocol>
</task>
```

### EARS Requirements Format

All requirements use [EARS syntax](https://alistairmavin.com/ears/) for unambiguous specifications:

- **Ubiquitous**: The system shall [response].
- **Event-Driven**: When [trigger], the system shall [response].
- **State-Driven**: While [state], the system shall [response].
- **Optional**: Where [feature] is present, the system shall [response].
- **Unwanted**: If [condition], then the system shall [response].

### Testing Strategy Selection

**Property-Based Testing** required for:
- Data transformation (parsers, converters)
- Math/financial logic (billing, scoring)
- Cryptography/security (hashing, sanitization)

**Unit Testing** for all other features.

## File Structure

```
.
├── agents/                    # Agent definitions
│   ├── architect.md
│   ├── orchestrator.md
│   ├── product-owner.md
│   ├── system-engineer.md
│   ├── ui-engineer.md
│   ├── devops-engineer.md
│   ├── fullstack-engineer.md
│   ├── qa-engineer.md
│   ├── security-engineer.md
│   ├── documentation-engineer.md
│   ├── staff-engineer.md
│   ├── validator.md
│   ├── project-knowledge.md
│   └── tech-lead.md          # DEPRECATED
├── skills/                    # Reusable instruction sets
│   ├── bash-strategy/
│   ├── code-style-analyst/
│   ├── coding-guidelines/
│   ├── dependency-management/
│   ├── design-architect/
│   ├── git-workflow/
│   ├── golang-expert/
│   ├── memory-management/
│   ├── prompt-engineering/
│   ├── task-planner/
│   ├── technical-writer/
│   ├── terraform-expert/
│   └── testing-standards/
├── memory/                    # Project memory
│   ├── human.md              # User preferences
│   └── persona.md            # Agent personality
├── opencode.json             # OpenCode configuration
└── README.md                 # This file
```

## Usage

### Starting a New Feature

1. **Describe your feature** to the Product Owner agent
2. **Review requirements** when prompted (approval gate)
3. **Review architecture** when Architect presents design (approval gate)
4. **Monitor progress** as Orchestrator delegates to engineers
5. **Approve merge** when Validator passes (approval gate)

### Invoking Specific Agents

Use `@agent-name` in chat to invoke subagents directly:
- `@architect` - For design questions
- `@validator` - To check code quality
- `@project-knowledge` - To query project context
- `@staff-engineer` - For complex debugging

### Switching Primary Agents

Use `Tab` key to cycle between primary agents (Product Owner, etc.)

## Configuration

### Agent Configuration (`opencode.json`)

Agents are configured with:
- `description`: What the agent does
- `mode`: primary, subagent, or all
- `model`: LLM model to use
- `maxSteps`: Maximum agentic iterations
- `tools`: Available tools (boolean flags)
- `permissions`: allow, ask, or deny for sensitive operations

### Skill Configuration

Skills are markdown files with YAML frontmatter:
```yaml
---
name: skill-name
description: What the skill provides
---
```

## Best Practices

### For Users

- **Be specific** in feature requests
- **Review gates carefully** (requirements, design, merge)
- **Trust the process** - agents handle implementation details
- **Interrupt if needed** - you can stop any agent mid-execution

### For Agent Developers

- **Follow protocols** - XML handoffs, EARS format, conventional commits
- **Respect boundaries** - no callback loops, one-way handoffs
- **Document decisions** - use project-knowledge for lessons learned
- **Test thoroughly** - 80% coverage minimum
- **Keep tasks atomic** - ≤3 files per task

## Troubleshooting

### Agent Not Found
Ensure agent file exists in `agents/` directory and has correct frontmatter.

### Permission Denied
Check agent's `permissions` section in frontmatter. Some operations require `allow`.

### Circuit Breaker Triggered
Agent failed 3 times or exceeded $2 cost. Staff Engineer will be called automatically.

### Requirements Rejected
Architect found ambiguous requirements. Revise using EARS templates.

## Contributing

When adding new agents or skills:

1. Follow existing frontmatter format
2. Document protocols and workflows
3. Add to this README
4. Test with sample features
5. Use conventional commits

## Resources

- [OpenCode Documentation](https://opencode.ai/docs)
- [EARS Requirements](https://alistairmavin.com/ears/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)

## License

This configuration is part of your project. Adjust licensing as needed.
