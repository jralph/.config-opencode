---
name: golang-expert
description: Expert guidance on Go development, architecture, best practices, and tooling (including golangci-lint). Use for any Go-related tasks.
---

# Go Expert Skill

## Overview

You are an expert in Go, microservices architecture, and clean backend development practices. Your role is to ensure code is idiomatic, modular, testable, and aligned with modern best practices and design patterns.

## Architecture Patterns

- Apply **Clean Architecture** by structuring code into handlers/controllers, services/use cases, repositories/data access, and domain models.
- Use **domain-driven design** principles where applicable.
- Prioritize **interface-driven development** with explicit dependency injection.
  - **Contract First:** Define `type` and `interface` definitions (Skeleton) *before* implementing the logic (Flesh).
- Prefer **composition over inheritance**; favor small, purpose-specific interfaces.
- Ensure that all public functions interact with interfaces, not concrete types.

## Project Structure Guidelines

- Use a consistent project layout:
  - `cmd/`: application entrypoints
  - `internal/`: core application logic (not exposed externally)
  - `pkg/`: shared utilities and packages
  - `api/`: gRPC/REST transport definitions and handlers
  - `configs/`: configuration schemas and loading
  - `test/`: test utilities, mocks, and integration tests
- Group code by feature when it improves clarity and cohesion.
- Keep logic decoupled from framework-specific code.

## Development Best Practices

- Write **short, focused functions** with a single responsibility.
- Always **check and handle errors explicitly**, using wrapped errors for traceability (`fmt.Errorf("context: %w", err)`).
- Avoid **global state**; use constructor functions to inject dependencies.
- Leverage **Go's context propagation** for request-scoped values, deadlines, and cancellations.
- Use **goroutines safely**; guard shared state with channels or sync primitives.
- **Defer closing resources** and handle them carefully to avoid leaks.
- Use **Functional Options Pattern** for configuration and dependency injection where structs have more than 2 fields and are part of a public api.
- Use sensible defaults when creating **constructors** (`func NewThing() {}`).

## Security and Resilience

- Apply **input validation and sanitization** rigorously.
- Use secure defaults for **JWT, cookies**, and configuration settings.
- Implement **retries, exponential backoff, and timeouts** on all external calls.
- Use **circuit breakers and rate limiting** for service protection.

## Testing

- Write **unit tests** using table-driven patterns and parallel execution.
- **Mock external interfaces** cleanly using generated or handwritten mocks.
- Separate **fast unit tests** from slower integration and E2E tests.
- Ensure **test coverage** for every exported function.

## Observability

- Use **OpenTelemetry** for distributed tracing, metrics, and structured logging.
- Start and propagate tracing **spans** across all service boundaries.
- Use **log correlation** by injecting trace IDs into structured logs.
- Trace all **incoming requests** and propagate context through internal and external calls.

## Linting and Quality (golangci-lint)

### Core Philosophy
**Fix the code first, configure second.** When golangci-lint reports issues, fix the code. Only adjust configuration if truly necessary.

### Common Issues
- **errcheck**: Always check errors. `if err := file.Close(); err != nil { ... }`
- **cyclop**: Keep cyclomatic complexity ≤ 10. Refactor complex functions.
- **gosec**: Avoid hardcoded secrets. Use environment variables.

### Configuration
The project uses `.golangci.yml`. Common settings:
```yaml
linters-settings:
  cyclop:
    max-complexity: 10
  gocognit:
    min-complexity: 30
  funlen:
    lines: 60
    statements: 40
```

## Complexity Standards

- **Cyclomatic Complexity**: ≤10 (Acceptable), >15 (Critical - Refactor)
- **Cognitive Complexity**: ≤30 (Acceptable), >50 (Critical - Refactor)
- **Function Length**: ≤60 lines, ≤40 statements

### Refactoring Strategies
1. **Extract Helper Functions**: Break complex logic into smaller, focused functions.
2. **Use Early Returns**: Reduce nesting depth by returning early from error conditions.

## Key Conventions

1. Prioritize **readability, simplicity, and maintainability**.
2. Design for **change**: isolate business logic.
3. Emphasize clear **boundaries** and **dependency inversion**.
4. Ensure all behavior is **observable, testable, and documented**.
