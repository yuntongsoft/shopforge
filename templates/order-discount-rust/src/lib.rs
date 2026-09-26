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
 *   1. Parse config from discount.metafield.value (JSON string)
 *   2. Read cart subtotal
 *   3. If subtotal >= minSubtotal → apply discountPercent to all cart lines
 *   4. Otherwise → no discount (return empty discounts)
 *
 * Prerequisites:
 *   1. schema.graphql must be present (download the full schema via Shopify CLI):
 *      shopify app function typegen
 *   2. Rust wasm target installed:
 *      rustup target add wasm32-unknown-unknown
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release --locked
 *   Output: target/wasm32-unknown-unknown/release/order_discount.wasm
 */
use shopify_function::prelude::*;
use shopify_function::Result;

mod run;

#[typegen("schema.graphql")]
pub mod schema {
    #[query("src/input.graphql")]
    pub mod run {}
}

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::FunctionRunResult> {
    run::process(input)
}
