# Go Implementation Examples

Complete implementation examples for hybrid AI-human error handling in Go.

## Error Type Definition

```go
// errors/auth/error156.go
package auth

import (
    "context"
    "fmt"
    "time"
)

// Error156 represents an expired authentication token
type Error156 struct {
    UserID    string
    ExpiresAt time.Time
}

func (e Error156) Error() string {
    return fmt.Sprintf("E-156: Authentication token expired for user %s at %s",
        e.UserID, e.ExpiresAt)
}

func (e Error156) Code() string {
    return "E-156"
}

func (e Error156) Severity() string {
    return "HIGH"
}

// Optional: Define remediation
func (e Error156) Remediation() RemediationAction {
    return &RefreshTokenAction{
        UserID:   e.UserID,
        Fallback: &ReauthenticateAction{UserID: e.UserID},
    }
}
```

## Remediation Actions

```go
// errors/auth/remediation.go
package auth

import "context"

// RemediationAction defines automated error recovery
type RemediationAction interface {
    Name() string
    Execute(ctx context.Context) error
    Fallback() RemediationAction
}

// RefreshTokenAction attempts to refresh the expired token
type RefreshTokenAction struct {
    UserID   string
    Fallback RemediationAction
}

func (a *RefreshTokenAction) Name() string {
    return "RefreshAuthToken"
}

func (a *RefreshTokenAction) Execute(ctx context.Context) error {
    // Attempt token refresh
    token, err := authService.RefreshToken(ctx, a.UserID)
    if err != nil {
        if a.Fallback != nil {
            return a.Fallback.Execute(ctx)
        }
        return err
    }
    // Store new token
    return tokenStore.Save(ctx, a.UserID, token)
}

func (a *RefreshTokenAction) Fallback() RemediationAction {
    return a.Fallback
}

// ReauthenticateAction forces full re-authentication
type ReauthenticateAction struct {
    UserID string
}

func (a *ReauthenticateAction) Name() string {
    return "ReauthenticateUser"
}

func (a *ReauthenticateAction) Execute(ctx context.Context) error {
    // Force user to re-authenticate
    return authService.InvalidateSession(ctx, a.UserID)
}

func (a *ReauthenticateAction) Fallback() RemediationAction {
    return nil // No fallback for full re-auth
}
```

## Dual Logger Implementation

```go
// pkg/logger/dual_logger.go
package logger

import (
    "fmt"
    "log"
    "os"
    "time"
)

// DualLogger handles both AI and human channels with filtering
type DualLogger struct {
    mode  string // "both", "ai", "human"
    level string // "info", "warn", "error", "fatal"
}

// NewDualLogger creates a logger with environment-based configuration
func NewDualLogger(mode, level string) *DualLogger {
    if mode == "" {
        mode = "both"
    }
    if level == "" {
        level = "info"
    }
    return &DualLogger{mode: mode, level: level}
}

// NewDualLoggerFromEnv creates a logger from environment variables
func NewDualLoggerFromEnv() *DualLogger {
    return NewDualLogger(
        os.Getenv("LOG_MODE"),
        os.Getenv("LOG_LEVEL"),
    )
}

// Info logs an informational message (human channel)
func (l *DualLogger) Info(format string, args ...interface{}) {
    if l.mode == "ai" {
        return
    }
    if l.shouldLog("info") {
        l.logHuman("INFO", format, args...)
    }
}

// Warn logs a warning message (human channel)
func (l *DualLogger) Warn(format string, args ...interface{}) {
    if l.mode == "ai" {
        return
    }
    if l.shouldLog("warn") {
        l.logHuman("WARN", format, args...)
    }
}

// Error logs an error message (human channel)
func (l *DualLogger) Error(format string, args ...interface{}) {
    if l.mode == "ai" {
        return
    }
    if l.shouldLog("error") {
        l.logHuman("ERROR", format, args...)
    }
}

// Fatal logs a fatal message (human channel)
func (l *DualLogger) Fatal(format string, args ...interface{}) {
    if l.mode == "ai" {
        return
    }
    if l.shouldLog("fatal") {
        l.logHuman("FATAL", format, args...)
    }
}

// AI logs a message to the AI channel
func (l *DualLogger) AI(level, code string, context map[string]string) {
    if l.mode == "human" {
        return
    }
    if l.shouldLog(level) {
        msg := fmt.Sprintf("ai:%s %s", level, code)
        for k, v := range context {
            msg += fmt.Sprintf(" %s=%s", k, v)
        }
        log.Println(msg)
    }
}

// logHuman formats and logs a human-readable message
func (l *DualLogger) logHuman(level, format string, args ...interface{}) {
    timestamp := time.Now().UTC().Format(time.RFC3339)
    message := fmt.Sprintf(format, args...)
    log.Printf("%s %s %s", timestamp, level, message)
}

// shouldLog checks if a message at the given level should be logged
func (l *DualLogger) shouldLog(level string) bool {
    levels := map[string]int{
        "info":  0,
        "warn":  1,
        "error": 2,
        "fatal": 3,
    }
    configLevel := levels[l.level]
    msgLevel := levels[level]
    return msgLevel >= configLevel
}
```

## Usage Example

```go
// main.go or service code
package main

import (
    "context"
    "myapp/errors/auth"
    "myapp/pkg/logger"
)

func main() {
    // Create logger from environment variables
    log := logger.NewDualLoggerFromEnv()
    
    // Simulate authentication
    if err := authenticateUser(log, "user123"); err != nil {
        log.Fatal("Authentication failed: %v", err)
    }
}

func authenticateUser(log *logger.DualLogger, userID string) error {
    // Simulate token validation
    token, err := validateToken(userID)
    if err != nil {
        // Check if it's our typed error
        if authErr, ok := err.(auth.Error156); ok {
            // Human channel: Descriptive error
            log.Error("Authentication failed: %v", authErr)
            
            // AI channel: Structured signal
            log.AI("ERROR", authErr.Code(), map[string]string{
                "user_id": authErr.UserID,
                "expires_at": authErr.ExpiresAt.Format(time.RFC3339),
            })
            
            // Optional: Attempt automated remediation
            if remediation := authErr.Remediation(); remediation != nil {
                log.AI("INFO", "REMEDIATION_START", map[string]string{
                    "action": remediation.Name(),
                })
                
                ctx := context.Background()
                if err := remediation.Execute(ctx); err != nil {
                    log.AI("ERROR", "REMEDIATION_FAILED", map[string]string{
                        "action": remediation.Name(),
                        "reason": err.Error(),
                    })
                    return err
                }
                
                log.AI("INFO", "REMEDIATION_SUCCESS", map[string]string{
                    "action": remediation.Name(),
                })
                return nil
            }
        }
        return err
    }
    
    // Success
    log.Info("User authenticated successfully (user_id=%s)", userID)
    log.AI("INFO", "CHECKPOINT", map[string]string{
        "state": "authenticated",
        "user_id": userID,
    })
    
    return nil
}

func validateToken(userID string) (string, error) {
    // Simulate expired token
    return "", auth.Error156{
        UserID:    userID,
        ExpiresAt: time.Now().Add(-1 * time.Hour),
    }
}
```

## Additional Error Examples

### Network Error (E-200)

```go
// errors/network/error200.go
package network

import (
    "context"
    "fmt"
    "time"
)

// Error200 represents a connection timeout
type Error200 struct {
    Host    string
    Port    int
    Timeout time.Duration
}

func (e Error200) Error() string {
    return fmt.Sprintf("E-200: Connection timeout to %s:%d after %v",
        e.Host, e.Port, e.Timeout)
}

func (e Error200) Code() string {
    return "E-200"
}

func (e Error200) Severity() string {
    return "MEDIUM"
}

func (e Error200) Remediation() RemediationAction {
    return &RetryWithBackoffAction{
        Host:        e.Host,
        Port:        e.Port,
        MaxRetries:  3,
        BackoffBase: 1 * time.Second,
    }
}

// RetryWithBackoffAction retries connection with exponential backoff
type RetryWithBackoffAction struct {
    Host        string
    Port        int
    MaxRetries  int
    BackoffBase time.Duration
}

func (a *RetryWithBackoffAction) Name() string {
    return "RetryWithBackoff"
}

func (a *RetryWithBackoffAction) Execute(ctx context.Context) error {
    for i := 0; i < a.MaxRetries; i++ {
        backoff := a.BackoffBase * time.Duration(1<<uint(i))
        time.Sleep(backoff)
        
        if err := attemptConnection(a.Host, a.Port); err == nil {
            return nil
        }
    }
    return fmt.Errorf("max retries exceeded")
}

func (a *RetryWithBackoffAction) Fallback() RemediationAction {
    return nil
}
```

### Database Error (E-300)

```go
// errors/database/error300.go
package database

import (
    "context"
    "fmt"
)

// Error300 represents a database connection pool exhaustion
type Error300 struct {
    PoolSize    int
    ActiveConns int
}

func (e Error300) Error() string {
    return fmt.Sprintf("E-300: Database connection pool exhausted (%d/%d active)",
        e.ActiveConns, e.PoolSize)
}

func (e Error300) Code() string {
    return "E-300"
}

func (e Error300) Severity() string {
    return "CRITICAL"
}

func (e Error300) Remediation() RemediationAction {
    return &IncreasePoolSizeAction{
        CurrentSize: e.PoolSize,
        TargetSize:  e.PoolSize * 2,
    }
}

// IncreasePoolSizeAction dynamically increases connection pool size
type IncreasePoolSizeAction struct {
    CurrentSize int
    TargetSize  int
}

func (a *IncreasePoolSizeAction) Name() string {
    return "IncreasePoolSize"
}

func (a *IncreasePoolSizeAction) Execute(ctx context.Context) error {
    return dbPool.Resize(ctx, a.TargetSize)
}

func (a *IncreasePoolSizeAction) Fallback() RemediationAction {
    return &CloseIdleConnectionsAction{}
}
```

## Testing

See [testing-examples.md](testing-examples.md) for complete property-based testing patterns.
