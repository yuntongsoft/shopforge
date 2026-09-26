/**
 * Discount logic: parse config → check threshold → build discounts.
 *
 * The `process` function receives the typed input from the Shopify runtime
 * and returns a `FunctionRunResult` with applicable discounts.
 */
use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;
use serde::Deserialize;

/// Discount configuration stored in discount node's metafield.
///
/// Metafield value example:
/// ```json
/// { "minSubtotal": "50.0", "discountPercent": 10.0 }
/// ```
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscountConfig {
    /// Minimum cart subtotal (in shop currency, e.g. "50.0")
    min_subtotal: String,
    /// Discount percentage (0–100)
    discount_percent: f64,
}

/// Main discount processing entry point.
pub fn process(input: schema::run::Input) -> Result<schema::FunctionRunResult> {
    // Step 1: Parse config from metafield
    let config = match parse_config(&input) {
        Some(c) => c,
        None => return Ok(empty_result()),
    };

    // Step 2: Calculate cart subtotal
    let subtotal: f64 = input
        .cart()
        .cost()
        .subtotal_amount()
        .amount()
        .0;

    // Step 3: Check if cart meets threshold
    let min_subtotal: f64 = config.min_subtotal.parse().unwrap_or(0.0);
    if subtotal < min_subtotal {
        return Ok(empty_result());
    }

    // Step 4: Build discount targets (all cart lines)
    let targets: Vec<schema::Target> = input
        .cart()
        .lines()
        .iter()
        .map(|line| schema::Target {
            cart_line: Some(schema::CartLineTarget {
                id: line.id().clone(),
            }),
            product_variant: None,
        })
        .collect();

    // Step 5: Return discount
    Ok(schema::FunctionRunResult {
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
        discounts: vec![schema::Discount {
            message: Some(format!(
                "{}% off orders over ${}",
                config.discount_percent as i32,
                min_subtotal as i32
            )),
            targets,
            value: schema::Value {
                percentage: Some(schema::Percentage {
                    value: Decimal(config.discount_percent),
                }),
                fixed_amount: None,
            },
        }],
    })
}

/// Parse DiscountConfig from the discount node's metafield value.
/// Returns None if metafield is missing or JSON is invalid.
fn parse_config(input: &schema::run::Input) -> Option<DiscountConfig> {
    let metafield = input.discount()?.metafield()?;
    let value = metafield.value();

    if value.is_empty() {
        return None;
    }

    serde_json::from_str::<DiscountConfig>(value).ok()
}

/// Return an empty result (no discounts applied).
fn empty_result() -> schema::FunctionRunResult {
    schema::FunctionRunResult {
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
        discounts: vec![],
    }
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
