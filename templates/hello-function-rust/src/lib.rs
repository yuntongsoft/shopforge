/**
 * Shopify Function: Hello World (Minimal Example)
 *
 * This is the simplest possible Function — returns no discounts.
 * Use it to verify your WASM build pipeline works.
 *
 * For a real-world template with actual discount logic, see:
 *   templates/order-discount-rust/ — Spend threshold → percentage off
 *
 * Prerequisites:
 *   1. schema.graphql must be present (download the full schema via Shopify CLI):
 *      shopify app function typegen
 *   2. Rust wasm target installed:
 *      rustup target add wasm32-unknown-unknown
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release --locked
 *   Output: target/wasm32-unknown-unknown/release/hello_function.wasm
 */
use shopify_function::prelude::*;
use shopify_function::Result;

#[typegen("schema.graphql")]
pub mod schema {
    #[query("src/input.graphql")]
    pub mod run {}
}

#[shopify_function]
fn run(_input: schema::run::Input) -> Result<schema::FunctionRunResult> {
    // No-op: return empty discounts (no discount applied).
    // Replace this with your discount logic.
    Ok(schema::FunctionRunResult {
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
        discounts: vec![],
    })
}
