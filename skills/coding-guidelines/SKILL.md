---
name: coding-guidelines
description: General coding principles, complexity standards, and best practices. Use as a baseline for code quality and review.
---

# General Coding Guidelines

## Core Principles
- **Language**: English for all code, comments, and names.
- **Idiomatic Style**: Follow official style guides for the target language.
- **Clarity**: Prioritize readability over cleverness.
- **Return Early**: Use `if (!condition) { return; }` to reduce nesting.
- **KISS & DRY**: Keep it simple, don't repeat yourself.

## Naming & Structure
- **Descriptive Names**: Explicit over abbreviated.
- **Single Responsibility**: Small, focused functions/classes.
- **Verbs for Functions**: `calculateTotal`, `fetchData`.
- **Nouns for Data**: `user`, `orderList`.

## Error Handling
- **Explicit Handling**: Handle errors with language-appropriate mechanisms.
- **Fail Fast**: Validate inputs early.
- **Context**: Provide clear error messages for debugging.

## Security
- **Validate Inputs**: Sanitize all external inputs.
- **Secrets**: Never hardcode secrets. Use environment variables.
- **Least Privilege**: Minimal permissions for DBs, files, APIs.

## Complexity Standards

Maintain code quality by enforcing complexity thresholds.

### Metrics
- **Cyclomatic Complexity**: 
  - **≤10**: Acceptable
  - **11-15**: Warning (Refactor)
  - **>15**: Critical (Must Refactor)
- **Cognitive Complexity**:
  - **≤30**: Acceptable
  - **>30**: Warning
  - **>50**: Critical
- **Function Length**:
  - **Lines**: ≤60
  - **Statements**: ≤40

### Refactoring Strategies
- **Extract Helper Functions**: Break down large functions.
- **Use Early Returns**: Flatten nested logic.

### Process Integration (Chain of Code)
To consistently meet these complexity standards:
- **Draft First**: Use the **Chain of Code (CoC)** protocol to draft your interface and logic structure *before* implementation.
- **Simulate**: "Run" the draft in your head. If the draft looks complex, the code will be worse. Refactor the draft.

## Documentation
- **Why, not What**: Document intent and decisions.
- **Public API**: Document purpose, parameters, returns.
- **Keep Current**: Update comments when code changes.

## Testing
- **Deterministic**: Use fixed test data.
- **Coverage**: Test happy paths, edge cases, and errors.
- **Descriptive Naming**: Reflect the scenario being tested.
