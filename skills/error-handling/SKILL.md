---
name: error-handling
description: Standardized error handling for both human and llm/ai consumption.
---

# SKILL: Hybrid AI-Human Logging & Error Architecture

## Objective

Generate log outputs that serve two distinct consumers:
1. **Humans:** Verbose, natural language context for debugging
2. **AI Agents:** Deterministic, strongly-typed signals for instant graph retrieval and resolution

## The Protocol: Dual-Channel Logging

Every significant log event emits two signals.

### AI Channel Format

```
ai:<LEVEL> <CODE> [<KEY>=<VALUE>]...
```

**Examples:**
```
ai:ERROR E-156
ai:WARN E-042 retry_count=3 backoff_ms=1000
ai:INFO CHECKPOINT state=authenticated user_id=12345
ai:FATAL E-999 component=database
```

**Constraint:** Error codes must map to defined type symbols (Class/Struct) in the codebase.

### Human Channel Format

Standard natural language logging with timestamps:

```
2024-02-01T10:00:00Z INFO User authenticated successfully (user_id=12345)
2024-02-01T10:00:01Z ERROR Connection refused: timeout after 30s (host=db.example.com)
```

## Type-Driven Errors

### The "Class-per-Error" Rule

Every unique AI error code must exist as a dedicated type in the codebase.

**Bad:** `logger.error("E-156: Token expired")` (String Literal)  
**Good:** `logger.error(new Error156())` (Typed Symbol)

### Why This Matters for AI

When AI reads `ai:ERROR E-156`:
1. **Symbol Lookup:** Maps `E-156` to struct/class `Error156`
2. **Graph Traversal:** Queries Code Property Graph for node `Error156`
3. **Instant Context:** Reveals definition location, usage sites, interfaces, and remediation actions

### Naming Convention

* **Log Output:** `ai:ERROR E-156`
* **Type Name:** `Error156` or `Error156ConnectionRefused`
* **File Path:** `errors/network/error156.go` or `src/errors/network/Error156.ts`

## Log Level Protocol

| Log Level | AI Tag | Agent Action |
|-----------|--------|--------------|
| **INFO** | `ai:INFO` | **State Update:** Record checkpoint |
| **WARN** | `ai:WARN` | **Self-Correct:** Trigger retry logic |
| **ERROR** | `ai:ERROR` | **Graph Lookup:** Find definition of Type `E-{code}` |
| **FATAL** | `ai:FATAL` | **Escalate:** Handover to human |

## Log Filtering with Environment Variables

### LOG_MODE

Controls which channel(s) to emit:

```bash
LOG_MODE=both      # Default: Show both AI and human logs
LOG_MODE=ai        # AI channel only (machine-readable)
LOG_MODE=human     # Human channel only (traditional logging)
```

### LOG_LEVEL

Controls severity threshold:

```bash
LOG_LEVEL=info     # Default: Show info and above
LOG_LEVEL=warn     # Show warn, error, fatal only
LOG_LEVEL=error    # Show error and fatal only
```

### Combined Usage

```bash
# Default: Show everything
LOG_LEVEL=info LOG_MODE=both

# AI-only mode: Machine-readable only
LOG_LEVEL=warn LOG_MODE=ai
# Output: ai:WARN E-042 retry_count=3
#         ai:ERROR E-156

# Human-only mode: Traditional logging
LOG_LEVEL=info LOG_MODE=human
# Output: 2024-02-01T10:00:00Z INFO User authenticated successfully

# Production debugging: AI errors only
LOG_MODE=ai LOG_LEVEL=error
# Output: ai:ERROR E-156
#         ai:FATAL E-999
```

## Remediation Actions (Optional)

Errors can optionally define remediation actions for automated recovery.

### Remediation Interface

**Go:**
```go
type RemediationAction interface {
    Name() string
    Execute(ctx context.Context) error
    Fallback() RemediationAction // Optional
}
```

**JavaScript/TypeScript:**
```typescript
interface RemediationAction {
    name: string;
    execute: () => Promise<boolean>;
    fallback?: RemediationAction;
}
```

### When to Use Remediation

Only add remediation for errors with clear automated recovery paths:
- Token refresh/re-authentication
- Retry with backoff
- Fallback to alternative service
- Cache invalidation

**Guidelines:**
- Keep remediation actions idempotent
- Always provide fallback actions for critical paths
- Log remediation attempts and outcomes

## Quick Reference

### Error Code Assignment

- Use sequential numbering within categories:
  - E-100 to E-199: Authentication
  - E-200 to E-299: Network
  - E-300 to E-399: Database
  - E-400 to E-499: Validation
- Document ranges in central registry
- Never reuse error codes (deprecate instead)

### Testing Requirements

- Every error type must have property-based tests
- Test both channels (AI and human) independently
- Verify log filtering behavior
- Test remediation execution and fallback chains

### Documentation

- Document error codes in code comments
- Maintain central error catalog
- Include remediation steps in error documentation
- Link to related errors and common causes

## Implementation Examples

For complete implementation examples, see:
- [Go Implementation](go-examples.md) - Complete Go error types, logger, and usage
- [JavaScript/TypeScript Implementation](js-examples.md) - Complete JS/TS error types, logger, and usage
- [Testing Patterns](testing-examples.md) - Property-based testing with gopter and fast-check
- [Graph Query Examples](graph-queries.md) - Cypher queries for error analysis

## Best Practices

1. **Fix the code, not the logger:** When errors occur, improve error handling before adjusting log configuration
2. **Start simple:** Begin with basic error types, add remediation only when needed
3. **Test thoroughly:** Use property-based testing to verify error behavior across all inputs
4. **Document clearly:** Every error code should have clear documentation explaining cause and resolution
5. **Monitor both channels:** Use LOG_MODE to switch between human debugging and AI analysis as needed
