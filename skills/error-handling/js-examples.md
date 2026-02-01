# JavaScript/TypeScript Implementation Examples

Complete implementation examples for hybrid AI-human error handling in JavaScript/TypeScript.

## Error Type Definition

```typescript
// src/errors/auth/Error156.ts

export interface RemediationAction {
    name: string;
    execute: () => Promise<boolean>;
    fallback?: RemediationAction;
}

export class Error156 extends Error {
    readonly code = "E-156";
    readonly severity = "HIGH";
    readonly userId: string;
    readonly expiresAt: Date;

    constructor(userId: string, expiresAt: Date) {
        super(`E-156: Authentication token expired for user ${userId}`);
        this.name = "Error156";
        this.userId = userId;
        this.expiresAt = expiresAt;
    }

    // Optional: Define remediation
    remediation(): RemediationAction {
        return {
            name: "RefreshAuthToken",
            execute: async () => {
                try {
                    await authService.refreshToken(this.userId);
                    return true;
                } catch (err) {
                    return false;
                }
            },
            fallback: {
                name: "ReauthenticateUser",
                execute: async () => {
                    await authService.reauthenticate(this.userId);
                    return true;
                }
            }
        };
    }
}
```

## Dual Logger Implementation

```typescript
// src/logger/DualLogger.ts

type LogMode = "both" | "ai" | "human";
type LogLevel = "info" | "warn" | "error" | "fatal";

export class DualLogger {
    private mode: LogMode;
    private level: LogLevel;
    private levelPriority: Record<LogLevel, number> = {
        info: 0,
        warn: 1,
        error: 2,
        fatal: 3
    };

    constructor(mode?: LogMode, level?: LogLevel) {
        this.mode = mode || (process.env.LOG_MODE as LogMode) || "both";
        this.level = level || (process.env.LOG_LEVEL as LogLevel) || "info";
    }

    info(message: string, context?: Record<string, any>): void {
        if (this.mode === "ai") return;
        if (this.shouldLog("info")) {
            this.logHuman("INFO", message, context);
        }
    }

    warn(message: string, context?: Record<string, any>): void {
        if (this.mode === "ai") return;
        if (this.shouldLog("warn")) {
            this.logHuman("WARN", message, context);
        }
    }

    error(message: string, context?: Record<string, any>): void {
        if (this.mode === "ai") return;
        if (this.shouldLog("error")) {
            this.logHuman("ERROR", message, context);
        }
    }

    fatal(message: string, context?: Record<string, any>): void {
        if (this.mode === "ai") return;
        if (this.shouldLog("fatal")) {
            this.logHuman("FATAL", message, context);
        }
    }

    ai(level: string, code: string, context?: Record<string, string>): void {
        if (this.mode === "human") return;
        if (this.shouldLog(level.toLowerCase() as LogLevel)) {
            let msg = `ai:${level} ${code}`;
            if (context) {
                for (const [key, value] of Object.entries(context)) {
                    msg += ` ${key}=${value}`;
                }
            }
            console.log(msg);
        }
    }

    private logHuman(level: string, message: string, context?: Record<string, any>): void {
        const timestamp = new Date().toISOString();
        const ctx = context ? ` ${JSON.stringify(context)}` : "";
        const output = `${timestamp} ${level} ${message}${ctx}`;
        
        if (level === "ERROR" || level === "FATAL") {
            console.error(output);
        } else {
            console.log(output);
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return this.levelPriority[level] >= this.levelPriority[this.level];
    }
}
```

## Usage Example

```typescript
// src/services/auth.ts

import { DualLogger } from '../logger/DualLogger';
import { Error156 } from '../errors/auth/Error156';

const logger = new DualLogger();

export async function authenticateUser(userId: string): Promise<void> {
    try {
        // Simulate token validation
        const token = await validateToken(userId);
        
        // Success
        logger.info(`User authenticated successfully (user_id=${userId})`);
        logger.ai("INFO", "CHECKPOINT", {
            state: "authenticated",
            user_id: userId
        });
        
    } catch (err) {
        if (err instanceof Error156) {
            // Human channel: Descriptive error
            logger.error(err.message, { userId: err.userId });
            
            // AI channel: Structured signal
            logger.ai("ERROR", err.code, {
                user_id: err.userId,
                expires_at: err.expiresAt.toISOString()
            });
            
            // Optional: Attempt automated remediation
            const remediation = err.remediation();
            if (remediation) {
                logger.ai("INFO", "REMEDIATION_START", {
                    action: remediation.name
                });
                
                const success = await remediation.execute();
                
                if (!success && remediation.fallback) {
                    logger.ai("WARN", "REMEDIATION_FALLBACK", {
                        action: remediation.fallback.name
                    });
                    
                    const fallbackSuccess = await remediation.fallback.execute();
                    
                    if (fallbackSuccess) {
                        logger.ai("INFO", "REMEDIATION_SUCCESS", {
                            action: remediation.fallback.name
                        });
                        return;
                    }
                } else if (success) {
                    logger.ai("INFO", "REMEDIATION_SUCCESS", {
                        action: remediation.name
                    });
                    return;
                }
                
                logger.ai("ERROR", "REMEDIATION_FAILED", {
                    action: remediation.name
                });
            }
            
            throw err;
        }
        
        throw err;
    }
}

async function validateToken(userId: string): Promise<string> {
    // Simulate expired token
    throw new Error156(userId, new Date(Date.now() - 3600000));
}
```

## Additional Error Examples

### Network Error (E-200)

```typescript
// src/errors/network/Error200.ts

export class Error200 extends Error {
    readonly code = "E-200";
    readonly severity = "MEDIUM";
    readonly host: string;
    readonly port: number;
    readonly timeout: number;

    constructor(host: string, port: number, timeout: number) {
        super(`E-200: Connection timeout to ${host}:${port} after ${timeout}ms`);
        this.name = "Error200";
        this.host = host;
        this.port = port;
        this.timeout = timeout;
    }

    remediation(): RemediationAction {
        return {
            name: "RetryWithBackoff",
            execute: async () => {
                const maxRetries = 3;
                const backoffBase = 1000;
                
                for (let i = 0; i < maxRetries; i++) {
                    const backoff = backoffBase * Math.pow(2, i);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                    
                    try {
                        await attemptConnection(this.host, this.port);
                        return true;
                    } catch (err) {
                        // Continue to next retry
                    }
                }
                
                return false;
            }
        };
    }
}

async function attemptConnection(host: string, port: number): Promise<void> {
    // Connection logic here
}
```

### Database Error (E-300)

```typescript
// src/errors/database/Error300.ts

export class Error300 extends Error {
    readonly code = "E-300";
    readonly severity = "CRITICAL";
    readonly poolSize: number;
    readonly activeConns: number;

    constructor(poolSize: number, activeConns: number) {
        super(`E-300: Database connection pool exhausted (${activeConns}/${poolSize} active)`);
        this.name = "Error300";
        this.poolSize = poolSize;
        this.activeConns = activeConns;
    }

    remediation(): RemediationAction {
        return {
            name: "IncreasePoolSize",
            execute: async () => {
                try {
                    const targetSize = this.poolSize * 2;
                    await dbPool.resize(targetSize);
                    return true;
                } catch (err) {
                    return false;
                }
            },
            fallback: {
                name: "CloseIdleConnections",
                execute: async () => {
                    await dbPool.closeIdle();
                    return true;
                }
            }
        };
    }
}
```

### Validation Error (E-400)

```typescript
// src/errors/validation/Error400.ts

export class Error400 extends Error {
    readonly code = "E-400";
    readonly severity = "LOW";
    readonly field: string;
    readonly value: any;
    readonly constraint: string;

    constructor(field: string, value: any, constraint: string) {
        super(`E-400: Validation failed for field '${field}': ${constraint}`);
        this.name = "Error400";
        this.field = field;
        this.value = value;
        this.constraint = constraint;
    }

    // No remediation - validation errors require user input
}
```

## Express.js Middleware Integration

```typescript
// src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from 'express';
import { DualLogger } from '../logger/DualLogger';

const logger = new DualLogger();

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Check if it's a typed error with code
    const typedError = err as any;
    
    if (typedError.code && typedError.severity) {
        // Human channel
        logger.error(err.message, {
            path: req.path,
            method: req.method,
            userId: req.user?.id
        });
        
        // AI channel
        logger.ai("ERROR", typedError.code, {
            path: req.path,
            method: req.method,
            user_id: req.user?.id || "anonymous"
        });
        
        // Attempt remediation if available
        if (typedError.remediation) {
            const remediation = typedError.remediation();
            logger.ai("INFO", "REMEDIATION_START", {
                action: remediation.name
            });
            
            remediation.execute().then(success => {
                if (success) {
                    logger.ai("INFO", "REMEDIATION_SUCCESS", {
                        action: remediation.name
                    });
                } else {
                    logger.ai("ERROR", "REMEDIATION_FAILED", {
                        action: remediation.name
                    });
                }
            });
        }
        
        // Send appropriate HTTP response
        const statusCode = getStatusCode(typedError.code);
        res.status(statusCode).json({
            error: {
                code: typedError.code,
                message: err.message,
                severity: typedError.severity
            }
        });
    } else {
        // Generic error
        logger.error(`Unhandled error: ${err.message}`, {
            stack: err.stack
        });
        
        res.status(500).json({
            error: {
                message: "Internal server error"
            }
        });
    }
}

function getStatusCode(errorCode: string): number {
    const prefix = errorCode.split('-')[1];
    const codeNum = parseInt(prefix);
    
    if (codeNum >= 100 && codeNum < 200) return 401; // Auth errors
    if (codeNum >= 200 && codeNum < 300) return 503; // Network errors
    if (codeNum >= 300 && codeNum < 400) return 500; // Database errors
    if (codeNum >= 400 && codeNum < 500) return 400; // Validation errors
    
    return 500;
}
```

## Testing

See [testing-examples.md](testing-examples.md) for complete property-based testing patterns.
