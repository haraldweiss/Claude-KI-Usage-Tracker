/**
 * Database Model Type Definitions
 * Defines the structure of data stored in SQLite
 */
// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================
/**
 * Success status enum for tracking API call outcomes
 * Values: 'success', 'error', 'unknown'
 */
export var SuccessStatus;
(function (SuccessStatus) {
    SuccessStatus["Success"] = "success";
    SuccessStatus["Error"] = "error";
    SuccessStatus["Unknown"] = "unknown";
})(SuccessStatus || (SuccessStatus = {}));
/**
 * Source type enum for tracking where usage data originates
 */
export var SourceType;
(function (SourceType) {
    SourceType["ClaudeAi"] = "claude_ai";
    SourceType["AnthropicApi"] = "anthropic_api";
    SourceType["Extension"] = "extension";
    SourceType["Manual"] = "manual";
})(SourceType || (SourceType = {}));
/**
 * Pricing source enum for tracking pricing data origin
 * Values: 'manual' (user input), 'auto' (scheduled update), 'anthropic' (official)
 */
export var PricingSource;
(function (PricingSource) {
    PricingSource["Manual"] = "manual";
    PricingSource["Auto"] = "auto";
    PricingSource["Anthropic"] = "anthropic";
})(PricingSource || (PricingSource = {}));
//# sourceMappingURL=models.js.map