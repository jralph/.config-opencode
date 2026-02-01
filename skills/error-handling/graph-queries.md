# Code Graph Query Examples

Cypher queries that AI agents use to understand error context and relationships through Code Property Graph analysis.

## Find Error Definition

### Locate Error Type

```cypher
// Find where Error156 is defined
MATCH (e:Type {name: "Error156"})
RETURN e.file, e.line, e.package

// Find all properties of Error156
MATCH (e:Type {name: "Error156"})-[:HAS_FIELD]->(f:Field)
RETURN f.name, f.type

// Find methods on Error156
MATCH (e:Type {name: "Error156"})-[:HAS_METHOD]->(m:Method)
RETURN m.name, m.signature
```

### Find Error Interface

```cypher
// Find interfaces implemented by Error156
MATCH (e:Type {name: "Error156"})-[:IMPLEMENTS]->(i:Interface)
RETURN i.name, i.package

// Find all types implementing same interface
MATCH (e:Type {name: "Error156"})-[:IMPLEMENTS]->(i:Interface)<-[:IMPLEMENTS]-(other:Type)
RETURN other.name, other.file
```

## Find Error Usage Sites

### Instantiation Sites

```cypher
// Find all locations where Error156 is instantiated
MATCH (e:Type {name: "Error156"})<-[:INSTANTIATES]-(call:CallSite)
RETURN call.file, call.line, call.function

// Find instantiation with specific context
MATCH (e:Type {name: "Error156"})<-[:INSTANTIATES]-(call:CallSite)
WHERE call.file CONTAINS "auth"
RETURN call.file, call.line, call.context
```

### Functions That Return/Throw Error

```cypher
// Find all functions that can throw/return Error156
MATCH (f:Function)-[:THROWS|RETURNS]->(e:Type {name: "Error156"})
RETURN f.name, f.file, f.signature

// Find call chain leading to error
MATCH path = (entry:Function)-[:CALLS*]->(f:Function)-[:THROWS]->(e:Type {name: "Error156"})
WHERE entry.name = "main"
RETURN path
```

### Error Propagation

```cypher
// Find how Error156 propagates through the codebase
MATCH (e:Type {name: "Error156"})<-[:THROWS]-(f1:Function)<-[:CALLS]-(f2:Function)
RETURN f1.name as thrower, f2.name as caller, f2.file

// Find error handling sites
MATCH (e:Type {name: "Error156"})<-[:CATCHES]-(handler:CatchBlock)
RETURN handler.file, handler.line, handler.function
```

## Find Remediation Chain

### Remediation Actions

```cypher
// Find remediation actions for Error156
MATCH (e:Type {name: "Error156"})-[:HAS_REMEDIATION]->(r:RemediationAction)
RETURN r.name, r.type

// Find remediation implementation
MATCH (e:Type {name: "Error156"})-[:HAS_REMEDIATION]->(r:RemediationAction)-[:DEFINED_IN]->(f:File)
RETURN f.path, r.name
```

### Fallback Chain

```cypher
// Find complete fallback chain
MATCH (e:Type {name: "Error156"})-[:HAS_REMEDIATION]->(r:RemediationAction)
OPTIONAL MATCH (r)-[:FALLBACK*]->(fb:RemediationAction)
RETURN r.name as primary, collect(fb.name) as fallbacks

// Find depth of fallback chain
MATCH (e:Type {name: "Error156"})-[:HAS_REMEDIATION]->(r:RemediationAction)
OPTIONAL MATCH path = (r)-[:FALLBACK*]->(fb:RemediationAction)
RETURN r.name, length(path) as fallback_depth
```

### Shared Remediations

```cypher
// Find all errors with same remediation
MATCH (e:Type)-[:HAS_REMEDIATION]->(r:RemediationAction {name: "RefreshAuthToken"})
RETURN e.name, e.code

// Find remediation usage frequency
MATCH (e:Type)-[:HAS_REMEDIATION]->(r:RemediationAction)
RETURN r.name, count(e) as error_count
ORDER BY error_count DESC
```

## Find Related Errors

### Same Package/Module

```cypher
// Find errors in same package
MATCH (e1:Type {name: "Error156"}), (e2:Type)
WHERE e1.package = e2.package AND e2.name STARTS WITH "Error"
RETURN e2.name, e2.code

// Find errors in same file
MATCH (e1:Type {name: "Error156"}), (e2:Type)
WHERE e1.file = e2.file AND e2.name STARTS WITH "Error"
RETURN e2.name, e2.code
```

### Same Severity

```cypher
// Find errors with same severity
MATCH (e:Type)-[:HAS_PROPERTY {name: "severity", value: "HIGH"}]
WHERE e.name STARTS WITH "Error"
RETURN e.name, e.code

// Find severity distribution
MATCH (e:Type)-[:HAS_PROPERTY {name: "severity"}]->(p:Property)
WHERE e.name STARTS WITH "Error"
RETURN p.value as severity, count(e) as count
ORDER BY count DESC
```

### Error Dependencies

```cypher
// Find error dependency graph
MATCH (e1:Type {name: "Error156"})-[:DEPENDS_ON*]->(e2:Type)
WHERE e2.name STARTS WITH "Error"
RETURN e1.name, collect(e2.name) as dependencies

// Find errors that depend on Error156
MATCH (e1:Type)-[:DEPENDS_ON*]->(e2:Type {name: "Error156"})
WHERE e1.name STARTS WITH "Error"
RETURN e1.name, e1.code
```

## Find Test Coverage

### Direct Tests

```cypher
// Find tests for Error156
MATCH (e:Type {name: "Error156"})<-[:TESTS]-(t:TestFunction)
RETURN t.name, t.file

// Find test coverage percentage
MATCH (e:Type)
WHERE e.name STARTS WITH "Error"
OPTIONAL MATCH (e)<-[:TESTS]-(t:TestFunction)
WITH e, count(t) as test_count
RETURN 
    count(e) as total_errors,
    sum(CASE WHEN test_count > 0 THEN 1 ELSE 0 END) as tested_errors,
    100.0 * sum(CASE WHEN test_count > 0 THEN 1 ELSE 0 END) / count(e) as coverage_pct
```

### Untested Errors

```cypher
// Find untested error types
MATCH (e:Type)
WHERE e.name STARTS WITH "Error" AND NOT (e)<-[:TESTS]-()
RETURN e.name, e.code, e.file

// Find errors with insufficient tests
MATCH (e:Type)<-[:TESTS]-(t:TestFunction)
WHERE e.name STARTS WITH "Error"
WITH e, count(t) as test_count
WHERE test_count < 3
RETURN e.name, e.code, test_count
```

### Property-Based Tests

```cypher
// Find property-based tests
MATCH (e:Type {name: "Error156"})<-[:TESTS]-(t:TestFunction)
WHERE t.name CONTAINS "Property" 
   OR t.uses_framework = "gopter" 
   OR t.uses_framework = "fast-check"
RETURN t.name, t.properties_tested

// Find errors without property-based tests
MATCH (e:Type)
WHERE e.name STARTS WITH "Error"
  AND NOT (e)<-[:TESTS]-(t:TestFunction)
  WHERE t.uses_framework IN ["gopter", "fast-check"]
RETURN e.name, e.code
```

## Find Logging Patterns

### AI Channel Usage

```cypher
// Find where Error156 is logged to AI channel
MATCH (e:Type {name: "Error156"})<-[:LOGS]-(call:CallSite)
WHERE call.channel = "ai"
RETURN call.file, call.line, call.function

// Find errors without AI channel logging
MATCH (e:Type)
WHERE e.name STARTS WITH "Error"
  AND NOT (e)<-[:LOGS]-(call:CallSite {channel: "ai"})
RETURN e.name, e.code
```

### Human Channel Usage

```cypher
// Find where Error156 is logged to human channel
MATCH (e:Type {name: "Error156"})<-[:LOGS]-(call:CallSite)
WHERE call.channel = "human"
RETURN call.file, call.line, call.function

// Find dual-channel logging sites
MATCH (e:Type {name: "Error156"})<-[:LOGS]-(ai:CallSite {channel: "ai"})
MATCH (e)<-[:LOGS]-(human:CallSite {channel: "human"})
WHERE ai.function = human.function
RETURN ai.function, ai.file
```

## Error Code Analysis

### Code Range Usage

```cypher
// Find errors by code range
MATCH (e:Type)
WHERE e.code STARTS WITH "E-1"  // Auth errors (E-100 to E-199)
RETURN e.name, e.code, e.severity
ORDER BY e.code

// Find gaps in error code sequence
MATCH (e:Type)
WHERE e.code STARTS WITH "E-1"
WITH toInteger(substring(e.code, 2)) as code_num
ORDER BY code_num
WITH collect(code_num) as codes
UNWIND range(100, 199) as expected
WHERE NOT expected IN codes
RETURN expected as missing_code
```

### Code Conflicts

```cypher
// Find duplicate error codes
MATCH (e1:Type), (e2:Type)
WHERE e1.code = e2.code AND e1.name <> e2.name
RETURN e1.name, e2.name, e1.code as duplicate_code

// Find errors with invalid code format
MATCH (e:Type)
WHERE e.name STARTS WITH "Error"
  AND NOT e.code =~ "E-[0-9]{3}"
RETURN e.name, e.code as invalid_code
```

## Impact Analysis

### Change Impact

```cypher
// Find all code affected by Error156 changes
MATCH (e:Type {name: "Error156"})<-[:USES|INSTANTIATES|CATCHES]-(affected)
RETURN DISTINCT affected.file, affected.type

// Find high-impact errors (used in many places)
MATCH (e:Type)<-[:USES|INSTANTIATES|CATCHES]-(usage)
WHERE e.name STARTS WITH "Error"
WITH e, count(DISTINCT usage.file) as usage_count
WHERE usage_count > 10
RETURN e.name, e.code, usage_count
ORDER BY usage_count DESC
```

### Remediation Impact

```cypher
// Find services affected by remediation changes
MATCH (e:Type {name: "Error156"})-[:HAS_REMEDIATION]->(r:RemediationAction)
MATCH (r)-[:CALLS]->(service:Service)
RETURN service.name, service.type

// Find remediation dependencies
MATCH (r:RemediationAction {name: "RefreshAuthToken"})-[:DEPENDS_ON]->(dep)
RETURN dep.name, dep.type
```

## Best Practices

### Query Optimization

```cypher
// Use indexes for faster lookups
CREATE INDEX ON :Type(name)
CREATE INDEX ON :Type(code)
CREATE INDEX ON :Function(name)

// Limit result sets
MATCH (e:Type {name: "Error156"})<-[:INSTANTIATES]-(call:CallSite)
RETURN call.file, call.line
LIMIT 100

// Use EXPLAIN to analyze query performance
EXPLAIN MATCH (e:Type {name: "Error156"})<-[:INSTANTIATES]-(call:CallSite)
RETURN call.file
```

### Query Patterns

```cypher
// Use OPTIONAL MATCH for nullable relationships
MATCH (e:Type {name: "Error156"})
OPTIONAL MATCH (e)-[:HAS_REMEDIATION]->(r:RemediationAction)
RETURN e.name, r.name

// Use WITH for intermediate processing
MATCH (e:Type)
WHERE e.name STARTS WITH "Error"
WITH e, size((e)<-[:TESTS]-()) as test_count
WHERE test_count = 0
RETURN e.name, e.code

// Use CASE for conditional logic
MATCH (e:Type)
WHERE e.name STARTS WITH "Error"
RETURN e.name, 
       CASE e.severity
         WHEN "HIGH" THEN "🔴"
         WHEN "MEDIUM" THEN "🟡"
         ELSE "🟢"
       END as indicator
```
