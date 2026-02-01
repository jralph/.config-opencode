# Property-Based Testing Examples

Complete testing patterns for hybrid AI-human error handling using property-based testing.

## Go Testing with gopter

### Basic Error Properties

```go
// errors/auth/error156_test.go
package auth_test

import (
    "strings"
    "testing"
    "time"
    
    "github.com/leanovate/gopter"
    "github.com/leanovate/gopter/gen"
    "github.com/leanovate/gopter/prop"
    
    "myapp/errors/auth"
)

func TestError156Properties(t *testing.T) {
    properties := gopter.NewProperties(nil)

    // Property: Error code is always E-156
    properties.Property("Error156 always returns code E-156", prop.ForAll(
        func(userId string) bool {
            err := auth.Error156{UserID: userId}
            return err.Code() == "E-156"
        },
        gen.AnyString(),
    ))

    // Property: Error message contains user ID
    properties.Property("Error message contains user ID", prop.ForAll(
        func(userId string) bool {
            if userId == "" {
                return true // Skip empty strings
            }
            err := auth.Error156{UserID: userId}
            return strings.Contains(err.Error(), userId)
        },
        gen.AnyString().SuchThat(func(s string) bool { return s != "" }),
    ))

    // Property: Severity is always HIGH
    properties.Property("Severity is always HIGH", prop.ForAll(
        func(userId string) bool {
            err := auth.Error156{UserID: userId}
            return err.Severity() == "HIGH"
        },
        gen.AnyString(),
    ))

    // Property: Error message format is consistent
    properties.Property("Error message starts with E-156", prop.ForAll(
        func(userId string) bool {
            err := auth.Error156{UserID: userId}
            return strings.HasPrefix(err.Error(), "E-156:")
        },
        gen.AnyString(),
    ))

    properties.TestingRun(t)
}
```

### Remediation Properties

```go
func TestError156RemediationProperties(t *testing.T) {
    properties := gopter.NewProperties(nil)

    // Property: Remediation action has correct name
    properties.Property("Remediation action is RefreshAuthToken", prop.ForAll(
        func(userId string) bool {
            err := auth.Error156{UserID: userId}
            remediation := err.Remediation()
            return remediation != nil && remediation.Name() == "RefreshAuthToken"
        },
        gen.AnyString(),
    ))

    // Property: Remediation has fallback
    properties.Property("Remediation has fallback action", prop.ForAll(
        func(userId string) bool {
            err := auth.Error156{UserID: userId}
            remediation := err.Remediation()
            if remediation == nil {
                return false
            }
            fallback := remediation.Fallback()
            return fallback != nil && fallback.Name() == "ReauthenticateUser"
        },
        gen.AnyString(),
    ))

    // Property: Fallback has no further fallback
    properties.Property("Fallback action has no further fallback", prop.ForAll(
        func(userId string) bool {
            err := auth.Error156{UserID: userId}
            remediation := err.Remediation()
            if remediation == nil {
                return false
            }
            fallback := remediation.Fallback()
            if fallback == nil {
                return false
            }
            return fallback.Fallback() == nil
        },
        gen.AnyString(),
    ))

    properties.TestingRun(t)
}
```

### Logger Filtering Properties

```go
// pkg/logger/dual_logger_test.go
package logger_test

import (
    "bytes"
    "log"
    "strings"
    "testing"
    
    "github.com/leanovate/gopter"
    "github.com/leanovate/gopter/gen"
    "github.com/leanovate/gopter/prop"
    
    "myapp/pkg/logger"
)

func TestDualLoggerFilteringProperties(t *testing.T) {
    properties := gopter.NewProperties(nil)

    // Property: AI mode never emits human logs
    properties.Property("AI mode filters human logs", prop.ForAll(
        func(level string, message string) bool {
            var buf bytes.Buffer
            log.SetOutput(&buf)
            defer log.SetOutput(os.Stderr)
            
            l := logger.NewDualLogger("ai", "info")
            
            switch level {
            case "info":
                l.Info(message)
            case "warn":
                l.Warn(message)
            case "error":
                l.Error(message)
            case "fatal":
                l.Fatal(message)
            }
            
            output := buf.String()
            // Should not contain timestamp (human format)
            return !strings.Contains(output, "T") || strings.HasPrefix(output, "ai:")
        },
        gen.OneConstOf("info", "warn", "error", "fatal"),
        gen.AnyString(),
    ))

    // Property: Human mode never emits AI logs
    properties.Property("Human mode filters AI logs", prop.ForAll(
        func(code string) bool {
            var buf bytes.Buffer
            log.SetOutput(&buf)
            defer log.SetOutput(os.Stderr)
            
            l := logger.NewDualLogger("human", "info")
            l.AI("ERROR", code, nil)
            
            output := buf.String()
            // Should not contain ai: prefix
            return !strings.HasPrefix(output, "ai:")
        },
        gen.AnyString(),
    ))

    // Property: Log level filtering respects hierarchy
    properties.Property("Log level filtering respects hierarchy", prop.ForAll(
        func(configLevel, msgLevel string) bool {
            levels := map[string]int{
                "info": 0, "warn": 1, "error": 2, "fatal": 3,
            }
            
            var buf bytes.Buffer
            log.SetOutput(&buf)
            defer log.SetOutput(os.Stderr)
            
            l := logger.NewDualLogger("both", configLevel)
            l.AI(strings.ToUpper(msgLevel), "TEST-001", nil)
            
            output := buf.String()
            shouldShow := levels[msgLevel] >= levels[configLevel]
            didShow := len(output) > 0
            
            return shouldShow == didShow
        },
        gen.OneConstOf("info", "warn", "error", "fatal"),
        gen.OneConstOf("info", "warn", "error", "fatal"),
    ))

    properties.TestingRun(t)
}
```

### AI Channel Format Properties

```go
func TestAIChannelFormatProperties(t *testing.T) {
    properties := gopter.NewProperties(nil)

    // Property: AI messages always start with "ai:"
    properties.Property("AI messages start with ai: prefix", prop.ForAll(
        func(level, code string) bool {
            var buf bytes.Buffer
            log.SetOutput(&buf)
            defer log.SetOutput(os.Stderr)
            
            l := logger.NewDualLogger("ai", "info")
            l.AI(level, code, nil)
            
            output := buf.String()
            return strings.Contains(output, "ai:")
        },
        gen.OneConstOf("INFO", "WARN", "ERROR", "FATAL"),
        gen.AnyString(),
    ))

    // Property: Context key-value pairs are formatted correctly
    properties.Property("Context formatted as key=value", prop.ForAll(
        func(key, value string) bool {
            if key == "" || value == "" {
                return true
            }
            
            var buf bytes.Buffer
            log.SetOutput(&buf)
            defer log.SetOutput(os.Stderr)
            
            l := logger.NewDualLogger("ai", "info")
            l.AI("INFO", "TEST", map[string]string{key: value})
            
            output := buf.String()
            expected := key + "=" + value
            return strings.Contains(output, expected)
        },
        gen.AnyString().SuchThat(func(s string) bool { return s != "" }),
        gen.AnyString().SuchThat(func(s string) bool { return s != "" }),
    ))

    properties.TestingRun(t)
}
```

## JavaScript/TypeScript Testing with fast-check

### Basic Error Properties

```typescript
// src/errors/auth/Error156.test.ts
import * as fc from 'fast-check';
import { Error156 } from './Error156';

describe('Error156 Properties', () => {
    it('always returns code E-156', () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const err = new Error156(userId, new Date());
                return err.code === 'E-156';
            })
        );
    });

    it('error message contains user ID', () => {
        fc.assert(
            fc.property(
                fc.string().filter(s => s.length > 0),
                (userId) => {
                    const err = new Error156(userId, new Date());
                    return err.message.includes(userId);
                }
            )
        );
    });

    it('severity is always HIGH', () => {
        fc.assert(
            fc.property(fc.string(), fc.date(), (userId, expiresAt) => {
                const err = new Error156(userId, expiresAt);
                return err.severity === 'HIGH';
            })
        );
    });

    it('error message starts with E-156', () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const err = new Error156(userId, new Date());
                return err.message.startsWith('E-156:');
            })
        );
    });

    it('name property is Error156', () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const err = new Error156(userId, new Date());
                return err.name === 'Error156';
            })
        );
    });
});
```

### Remediation Properties

```typescript
describe('Error156 Remediation Properties', () => {
    it('remediation action has correct name', () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const err = new Error156(userId, new Date());
                const remediation = err.remediation();
                return remediation.name === 'RefreshAuthToken';
            })
        );
    });

    it('remediation has fallback action', () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const err = new Error156(userId, new Date());
                const remediation = err.remediation();
                return remediation.fallback !== undefined &&
                       remediation.fallback.name === 'ReauthenticateUser';
            })
        );
    });

    it('fallback action has no further fallback', () => {
        fc.assert(
            fc.property(fc.string(), (userId) => {
                const err = new Error156(userId, new Date());
                const remediation = err.remediation();
                return remediation.fallback?.fallback === undefined;
            })
        );
    });

    it('remediation execute returns Promise<boolean>', () => {
        fc.assert(
            fc.property(fc.string(), async (userId) => {
                const err = new Error156(userId, new Date());
                const remediation = err.remediation();
                const result = remediation.execute();
                return result instanceof Promise;
            })
        );
    });
});
```

### Logger Filtering Properties

```typescript
// src/logger/DualLogger.test.ts
import * as fc from 'fast-check';
import { DualLogger } from './DualLogger';

describe('DualLogger Filtering Properties', () => {
    const levels = ['info', 'warn', 'error', 'fatal'] as const;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('AI mode never emits human logs', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...levels),
                fc.string(),
                (level, message) => {
                    const logger = new DualLogger('ai', 'info');
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
                    
                    logger[level](message);
                    
                    const humanLogged = spy.mock.calls.some(call => 
                        call[0].includes('T') && !call[0].startsWith('ai:')
                    ) || errorSpy.mock.calls.length > 0;
                    
                    spy.mockRestore();
                    errorSpy.mockRestore();
                    
                    return !humanLogged;
                }
            )
        );
    });

    it('human mode never emits AI logs', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...levels),
                fc.string(),
                (level, code) => {
                    const logger = new DualLogger('human', 'info');
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    logger.ai(level.toUpperCase(), code);
                    
                    const aiLogged = spy.mock.calls.some(call => 
                        call[0].startsWith('ai:')
                    );
                    
                    spy.mockRestore();
                    
                    return !aiLogged;
                }
            )
        );
    });

    it('log level filtering respects hierarchy', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...levels),
                fc.constantFrom(...levels),
                (configLevel, msgLevel) => {
                    const priority = { info: 0, warn: 1, error: 2, fatal: 3 };
                    const logger = new DualLogger('both', configLevel);
                    
                    const shouldShow = priority[msgLevel] >= priority[configLevel];
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    logger.ai(msgLevel.toUpperCase(), 'TEST-001');
                    const wasShown = spy.mock.calls.length > 0;
                    spy.mockRestore();
                    
                    return shouldShow === wasShown;
                }
            )
        );
    });

    it('both mode emits both channels', () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.string(),
                (message, code) => {
                    const logger = new DualLogger('both', 'info');
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    
                    logger.info(message);
                    logger.ai('INFO', code);
                    
                    const humanLogged = spy.mock.calls.some(call => 
                        call[0].includes('T') && !call[0].startsWith('ai:')
                    );
                    const aiLogged = spy.mock.calls.some(call => 
                        call[0].startsWith('ai:')
                    );
                    
                    spy.mockRestore();
                    
                    return humanLogged && aiLogged;
                }
            )
        );
    });
});
```

### AI Channel Format Properties

```typescript
describe('AI Channel Format Properties', () => {
    it('AI messages always start with ai: prefix', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('INFO', 'WARN', 'ERROR', 'FATAL'),
                fc.string(),
                (level, code) => {
                    const logger = new DualLogger('ai', 'info');
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    logger.ai(level, code);
                    
                    const output = spy.mock.calls[0]?.[0] || '';
                    spy.mockRestore();
                    
                    return output.startsWith('ai:');
                }
            )
        );
    });

    it('context formatted as key=value', () => {
        fc.assert(
            fc.property(
                fc.string().filter(s => s.length > 0 && !s.includes('=')),
                fc.string().filter(s => s.length > 0 && !s.includes(' ')),
                (key, value) => {
                    const logger = new DualLogger('ai', 'info');
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    logger.ai('INFO', 'TEST', { [key]: value });
                    
                    const output = spy.mock.calls[0]?.[0] || '';
                    spy.mockRestore();
                    
                    return output.includes(`${key}=${value}`);
                }
            )
        );
    });

    it('multiple context values are space-separated', () => {
        fc.assert(
            fc.property(
                fc.dictionary(fc.string(), fc.string()),
                (context) => {
                    if (Object.keys(context).length === 0) return true;
                    
                    const logger = new DualLogger('ai', 'info');
                    
                    const spy = jest.spyOn(console, 'log').mockImplementation();
                    logger.ai('INFO', 'TEST', context);
                    
                    const output = spy.mock.calls[0]?.[0] || '';
                    spy.mockRestore();
                    
                    // Check all key=value pairs are present
                    return Object.entries(context).every(([k, v]) => 
                        output.includes(`${k}=${v}`)
                    );
                }
            )
        );
    });
});
```

## Integration Testing

### Testing Error Handling Flow

```typescript
// src/services/auth.test.ts
import * as fc from 'fast-check';
import { authenticateUser } from './auth';
import { Error156 } from '../errors/auth/Error156';

describe('Authentication Error Handling', () => {
    it('handles Error156 with remediation', async () => {
        await fc.assert(
            fc.asyncProperty(fc.string(), async (userId) => {
                // Mock token validation to throw Error156
                jest.spyOn(tokenService, 'validate').mockRejectedValue(
                    new Error156(userId, new Date())
                );
                
                // Mock successful remediation
                jest.spyOn(authService, 'refreshToken').mockResolvedValue('new-token');
                
                // Should not throw due to successful remediation
                await expect(authenticateUser(userId)).resolves.not.toThrow();
                
                return true;
            })
        );
    });

    it('escalates when remediation fails', async () => {
        await fc.assert(
            fc.asyncProperty(fc.string(), async (userId) => {
                // Mock token validation to throw Error156
                jest.spyOn(tokenService, 'validate').mockRejectedValue(
                    new Error156(userId, new Date())
                );
                
                // Mock failed remediation
                jest.spyOn(authService, 'refreshToken').mockRejectedValue(
                    new Error('Refresh failed')
                );
                jest.spyOn(authService, 'reauthenticate').mockRejectedValue(
                    new Error('Reauth failed')
                );
                
                // Should throw after all remediations fail
                await expect(authenticateUser(userId)).rejects.toThrow();
                
                return true;
            })
        );
    });
});
```

## Best Practices

### Property Selection

Choose properties that test invariants:
- **Identity**: `f(f(x)) === f(x)` (idempotence)
- **Round-trip**: `decode(encode(x)) === x`
- **Consistency**: Error code always matches type name
- **Format**: Output always follows specified format

### Generator Configuration

```typescript
// Good: Constrained generators
fc.string({ minLength: 1, maxLength: 100 })
fc.integer({ min: 0, max: 1000 })
fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })

// Bad: Unconstrained generators (may produce invalid test cases)
fc.string()
fc.integer()
fc.date()
```

### Iteration Count

```typescript
// Default: 100 iterations (usually sufficient)
fc.assert(fc.property(...))

// High confidence: 1000 iterations
fc.assert(fc.property(...), { numRuns: 1000 })

// Quick smoke test: 10 iterations
fc.assert(fc.property(...), { numRuns: 10 })
```

### Shrinking

Let the framework find minimal failing cases:

```typescript
// Framework will automatically shrink to smallest failing input
fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
        // If this fails with [1, 2, 3, 4, 5], framework will try:
        // [1, 2, 3], [1, 2], [1], []
        // To find the minimal failing case
        return myFunction(arr) >= 0;
    })
);
```
