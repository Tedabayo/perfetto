# Supervisor Example Transaction

## Transaction

Ethereum mainnet transaction:

`0x2bb6d2ca3b52a01ff9ec01c931f68762ded9a05693ea65d911a20602eea02763`

This transaction is used as a validation example for the generic
smart-contract trace visualization pipeline. The Perfetto implementation
must not contain transaction-specific addresses, selectors, counts, or
vulnerability labels.

## Files

### `raw_callTracer_with_logs_response.json`

Raw `debug_traceTransaction` response retrieved with Geth `callTracer`
and `tracerConfig.withLog = true`.

This is the primary execution-trace evidence used by the converter.

Observed during validation:

- 213 call frames
- maximum call depth: 6
- 22 failed/reverted call frames
- CALL, DELEGATECALL, and STATICCALL frames
- 51 emitted logs
- 25 standard `Transfer(address,address,uint256)` logs

### `raw_receipt_response.json`

Raw `eth_getTransactionReceipt` response.

Used as independent RPC evidence for validation of transaction status
and emitted logs.

Observed during validation:

- transaction status: success
- 51 receipt logs
- 25 standard Transfer-signature logs

### `perfetto_trace_with_assets.json`

Generated Perfetto trace produced by:

`../calltracer_to_perfetto.py`

The normalized trace separates:

- `record_type = call_frame`
- `record_type = asset_transfer`

Validated execution evidence:

- 213 call frames
- maximum depth: 6
- 22 failed/reverted frames
- 7 calls with non-zero native value
- 2 realized native-value movements
- 5 reverted native-value attempts
- 25 standard token-transfer records

Token amounts remain in raw units when token decimals are not available.
Function names and token metadata are not guessed by the core converter.

## External Cross-Validation

The transaction visualization was manually cross-checked with:

- BlockSec Phalcon Explorer
- Tenderly

The comparison included transaction status, call hierarchy, gas,
internal reverts, and asset-flow evidence.

External explorer labels or vulnerability classifications are not
assigned by the converter itself.
