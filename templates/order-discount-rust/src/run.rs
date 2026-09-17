/**
 * Order Discount Function — Spend Threshold → Percentage Off
 *
 * Pattern: Read config from metafield → check cart condition → apply discount
 *
 * Config metafield (written by Remix UI when merchant creates discount):
 *   namespace: "custom", key: "discount_config"
 *   value: { "minSubtotal": "50.0", "discountPercent": 10.0 }
 *
 * Logic:
 *   1. Parse config from discount.metafield
 *   2. Sum cart subtotal
 *   3. If subtotal >= minSubtarget → apply discountPercent to all eligible lines
 *   4. Otherwise → no discount (return empty targets)
 *
 * Performance: < 50ms execution, < 64KB memory (Shopify limits)
 */
use shopify_function::prelude::*;
use shopify_function::Result;
use serde::Deserialize;

// ─────────────────────────────────────────────────────────────────────────────
// Config struct — matches the JSON stored in the metafield
// ─────────────────────────────────────────────────────────────────────────────

/// Discount configuration stored in discount node's metafield.
///
/// Metafield value example:
/// ```json
/// { "minSubtotal": "50.0", "discountPercent": 10.0 }
/// ```
///
/// Extend this struct to add more conditions:
///   - `maxSubtotal: Option<String>` — upper limit
///   - `customerTags: Option<Vec<String>>` — customer segment filter
///   - `excludeProductIds: Option<Vec<String>>` — excluded products
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct DiscountConfig {
    /// Minimum cart subtotal (in shop currency, e.g. "50.0")
    min_subtotal: String,
    /// Discount percentage (0-100)
    discount_percent: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

#[shopify_function::shopify_function]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    // Step 1: Parse config from metafield
    let config = match parse_config(&input) {
        Some(c) => c,
        None => {
            // No config or invalid → no discount (safe fallback)
            return Ok(output::FunctionRunResult {
                discounts: vec![],
                discountApplicationStrategy: output::DiscountApplicationStrategy::FIRST,
            });
        }
    };

    // Step 2: Calculate cart subtotal
    let subtotal: f64 = input
        .cart
        .cost
        .subtotal_amount
        .amount
        .parse()
        .unwrap_or(0.0);

    // Step 3: Check if cart meets threshold
    let min_subtotal: f64 = config.min_subtotal.parse().unwrap_or(0.0);
    if subtotal < min_subtotal {
        // Cart doesn't meet minimum → no discount
        return Ok(output::FunctionRunResult {
            discounts: vec![],
            discountApplicationStrategy: output::DiscountApplicationStrategy::FIRST,
        });
    }

    // Step 4: Build discount targets (all eligible cart lines)
    let targets: Vec<output::Target> = input
        .cart
        .lines
        .iter()
        .filter_map(|line| {
            // Only discount ProductVariant merchandise (not gift cards, etc.)
            match &line.merchandise {
                input::CartLinesMerchandise::ProductVariant(variant) => {
                    // Optional: filter by product tag
                    // if !variant.product.has_any_tag { return None; }

                    Some(output::Target {
                        id: variant.id.clone(),
                    })
                }
                _ => None,
            }
        })
        .collect();

    // Step 5: Return discount
    Ok(output::FunctionRunResult {
        discounts: vec![output::Discount {
            message: Some(format!("{}% off orders over ${}", config.discount_percent as i32, min_subtotal as i32)),
            targets,
            value: output::Value::Percentage(output::Percentage {
                value: Decimal(config.discount_percent),
            }),
            conditions: None,
        }],
        discountApplicationStrategy: output::DiscountApplicationStrategy::FIRST,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Parse DiscountConfig from the discount node's metafield.
/// Returns None if metafield is missing or JSON is invalid.
fn parse_config(input: &input::ResponseData) -> Option<DiscountConfig> {
    let metafield_value = input
        .discount
        .metafield
        .as_ref()
        .map(|m| m.value.as_str())
        .unwrap_or("");

    if metafield_value.is_empty() {
        return None;
    }

    serde_json::from_str::<DiscountConfig>(metafield_value).ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_config_valid() {
        let json = r#"{"minSubtotal":"50.0","discountPercent":10.0}"#;
        let config = serde_json::from_str::<DiscountConfig>(json).unwrap();
        assert_eq!(config.min_subtotal, "50.0");
        assert_eq!(config.discount_percent, 10.0);
    }

    #[test]
    fn test_parse_config_invalid() {
        let json = r#"{"invalid": true}"#;
        let result = serde_json::from_str::<DiscountConfig>(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_subtotal_comparison() {
        let subtotal: f64 = "75.00".parse().unwrap();
        let min: f64 = "50.0".parse().unwrap();
        assert!(subtotal >= min);
    }
}
