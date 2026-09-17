/**
 * Shopify Function: Hello World (Minimal Example)
 *
 * This is the simplest possible Function — returns no discounts.
 * Use it to verify your WASM build pipeline works.
 *
 * For a real-world template with actual discount logic, see:
 *   extensions/order-discount/ — Spend threshold → percentage off
 *
 * Build & test:
 *   cd extensions/hello-function
 *   cargo wasi build --release
 *   shopify app function run --function hello-function
 */
use shopify_function::prelude::*;
use shopify_function::Result;

// Input: Query to fetch data from Shopify
#[shopify_function::shopify_function]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    // No-op: return empty targets (no discount applied)
    // Replace this with your discount logic
    Ok(output::FunctionRunResult {
        targets: vec![],
        errors: None,
    })
}
