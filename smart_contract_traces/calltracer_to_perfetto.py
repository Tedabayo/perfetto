import json
import sys


CALL_TYPES = {
    "CALL",
    "STATICCALL",
    "DELEGATECALL",
    "CALLCODE",
    "CREATE",
    "CREATE2",
}

# keccak256("Transfer(address,address,uint256)")
TRANSFER_TOPIC = (
    "0xddf252ad1be2c89b69c2b068fc378daa"
    "952ba7f163c4a11628f55a4df523b3ef"
)


def hex_to_int(value):
    if value is None:
        return 0

    if isinstance(value, bool):
        return int(value)

    if isinstance(value, int):
        return value

    text = str(value).strip()

    if not text:
        return 0

    try:
        if text.startswith(("0x", "0X")):
            return int(text, 16)

        return int(text)

    except (ValueError, TypeError):
        return 0


def optional_hex_to_int(value):
    if value is None:
        return None

    if isinstance(value, int):
        return value

    text = str(value).strip()

    if not text:
        return None

    try:
        if text.startswith(("0x", "0X")):
            return int(text, 16)

        return int(text)

    except (ValueError, TypeError):
        return None


def wei_to_eth_string(value_wei):
    value_wei = int(value_wei)

    whole = value_wei // 10**18
    fraction = value_wei % 10**18

    if fraction == 0:
        return str(whole)

    fraction_text = f"{fraction:018d}".rstrip("0")

    return f"{whole}.{fraction_text}"


def function_selector(input_data):
    if not isinstance(input_data, str):
        return None

    if input_data.startswith("0x") and len(input_data) >= 10:
        return input_data[:10]

    return None


def frame_name(frame):
    call_type = str(frame.get("type", "UNKNOWN")).upper()
    selector = function_selector(frame.get("input"))

    if selector:
        return f"{call_type} {selector}"

    return call_type


def topic_to_address(topic):
    if not isinstance(topic, str):
        return None

    text = topic.lower()

    if not text.startswith("0x"):
        return None

    hex_part = text[2:]

    if len(hex_part) < 40:
        return None

    return "0x" + hex_part[-40:]


def is_standard_value_transfer_log(log):
    """
    Recognise the common Transfer(address,address,uint256) layout:

      topic[0] = Transfer signature
      topic[1] = from
      topic[2] = to
      data     = uint256 value

    A Transfer log with an indexed third argument is deliberately not
    interpreted here as a fungible-token amount.
    """

    topics = log.get("topics")

    if not isinstance(topics, list):
        return False

    if len(topics) != 3:
        return False

    return str(topics[0]).lower() == TRANSFER_TOPIC


def parse_transfer_log(log):
    if not is_standard_value_transfer_log(log):
        return None

    topics = log.get("topics", [])

    sender = topic_to_address(topics[1])
    receiver = topic_to_address(topics[2])

    if sender is None or receiver is None:
        return None

    raw_amount_int = optional_hex_to_int(log.get("data"))

    raw_amount = (
        str(raw_amount_int)
        if raw_amount_int is not None
        else "unavailable"
    )

    log_index = optional_hex_to_int(log.get("index"))

    if log_index is None:
        log_index = optional_hex_to_int(log.get("position"))

    return {
        "sender": sender,
        "receiver": receiver,
        "token_contract": log.get("address"),
        "transfer_amount_raw": raw_amount,
        "log_index": log_index,
        "event_signature": TRANSFER_TOPIC,
    }


def convert_calltracer(root):
    call_events = []
    asset_events = []

    timestamp = 0
    call_index = 0

    retained_logs = 0
    standard_transfer_logs = 0
    skipped_indexed_transfer_logs = 0

    realized_native_value_calls = 0
    reverted_native_value_attempts = 0

    def walk(
        frame,
        depth,
        parent_call_index=None,
        ancestor_failed=False,
    ):
        nonlocal timestamp
        nonlocal call_index
        nonlocal retained_logs
        nonlocal standard_transfer_logs
        nonlocal skipped_indexed_transfer_logs
        nonlocal realized_native_value_calls
        nonlocal reverted_native_value_attempts

        current_index = call_index
        call_index += 1

        begin_timestamp = timestamp

        call_type = str(
            frame.get("type", "UNKNOWN")
        ).upper()

        gas_assigned = hex_to_int(frame.get("gas"))
        gas_used = hex_to_int(frame.get("gasUsed"))
        value_decimal = hex_to_int(frame.get("value"))

        error = frame.get("error")
        revert_reason = frame.get("revertReason")

        frame_failed = (
            error is not None
            or revert_reason is not None
        )

        effective_failed = (
            ancestor_failed
            or frame_failed
        )

        has_native_value = value_decimal > 0

        has_realized_native_value = (
            has_native_value
            and not effective_failed
        )

        if not has_native_value:
            native_value_status = "none"

        elif has_realized_native_value:
            native_value_status = "realized"
            realized_native_value_calls += 1

        else:
            native_value_status = "reverted_attempt"
            reverted_native_value_attempts += 1

        selector = function_selector(frame.get("input"))

        if has_native_value:
            visual_category = "money_flow"

        elif call_type in CALL_TYPES:
            visual_category = "contract_call"

        else:
            visual_category = "normal_call"

        frame_logs = frame.get("logs", [])

        if not isinstance(frame_logs, list):
            frame_logs = []

        args = {
            "record_type": "call_frame",
            "call_index": current_index,
            "parent_call_index": parent_call_index,
            "depth": depth,
            "kind": call_type,
            "call_type": call_type,
            "from": frame.get("from"),
            "to": frame.get("to"),
            "gas_assigned_decimal": gas_assigned,
            "gas_used_decimal": gas_used,
            "value_decimal": value_decimal,
            "value_eth": wei_to_eth_string(
                value_decimal
            ),
            "visual_category": visual_category,

            # Native-value evidence.
            "has_native_value": has_native_value,
            "has_realized_native_value":
                has_realized_native_value,
            "native_value_status":
                native_value_status,

            # Token-transfer metadata belongs to separate
            # asset_transfer records.
            "has_transfer_metadata": 0,

            "success": 0 if frame_failed else 1,
            "error": error,
            "revert_reason": revert_reason,
            "function_selector": selector,
            "input": frame.get("input"),
            "output": frame.get("output"),
            "emitted_log_count": len(frame_logs),
        }

        call_events.append({
            "name": frame_name(frame),
            "cat": visual_category,
            "ph": "B",
            "ts": timestamp,
            "pid": 1,
            "tid": 1,
            "args": args,
        })

        timestamp += 1

        for child in frame.get("calls", []):
            walk(
                child,
                depth + 1,
                parent_call_index=current_index,
                ancestor_failed=effective_failed,
            )

        call_events.append({
            "name": frame_name(frame),
            "cat": visual_category,
            "ph": "E",
            "ts": timestamp,
            "pid": 1,
            "tid": 1,
        })

        timestamp += 1

        # Logs emitted inside reverted execution do not represent
        # persistent transaction-level asset movement.
        if effective_failed:
            return

        local_transfer_index = 0

        for log in frame_logs:
            retained_logs += 1

            topics = log.get("topics", [])

            if not isinstance(topics, list) or not topics:
                continue

            topic0 = str(topics[0]).lower()

            if topic0 != TRANSFER_TOPIC:
                continue

            # Transfer events with a different indexed layout are
            # preserved in the raw trace but are not interpreted as
            # fungible-token amount transfers here.
            if len(topics) != 3:
                skipped_indexed_transfer_logs += 1
                continue

            parsed = parse_transfer_log(log)

            if parsed is None:
                continue

            standard_transfer_logs += 1

            transfer_ts = (
                begin_timestamp
                + 0.25
                + (local_transfer_index * 0.0001)
            )

            local_transfer_index += 1

            log_index = parsed["log_index"]

            transfer_args = {
                "record_type": "asset_transfer",
                "visual_category": "money_flow",
                "has_transfer_metadata": 1,
                "has_native_value": 0,
                "has_realized_native_value": 0,
                "native_value_status": "none",

                # Link back to the execution frame that emitted
                # the event.
                "emitting_call_index": current_index,
                "call_index": current_index,
                "emitting_call_depth": depth,
                "emitting_call_type": call_type,
                "emitting_contract": frame.get("to"),

                "log_index": (
                    log_index
                    if log_index is not None
                    else -1
                ),

                "token_contract":
                    parsed["token_contract"],

                "from":
                    parsed["sender"],

                "to":
                    parsed["receiver"],

                # Exact event-log integer.
                "transfer_amount_raw":
                    parsed["transfer_amount_raw"],

                # Deliberately unavailable until token metadata
                # enrichment provides decimals.
                "transfer_amount_normalized": None,
                "token_symbol": None,
                "token_decimals": None,

                "transfer_event_signature":
                    parsed["event_signature"],
            }

            asset_events.append({
                "name": "Transfer event",
                "cat": "money_flow",
                "ph": "X",
                "ts": transfer_ts,
                "dur": 0.00005,
                "pid": 1,
                "tid": 2,
                "args": transfer_args,
            })

    walk(root, 0)

    metadata_events = [
        {
            "name": "process_name",
            "ph": "M",
            "pid": 1,
            "args": {
                "name": "Smart Contract Transaction",
            },
        },
        {
            "name": "thread_name",
            "ph": "M",
            "pid": 1,
            "tid": 1,
            "args": {
                "name": "Smart Contract Execution",
            },
        },
        {
            "name": "thread_name",
            "ph": "M",
            "pid": 1,
            "tid": 2,
            "args": {
                "name": "Asset Transfer Events",
            },
        },
    ]

    return {
        "traceEvents": (
            metadata_events
            + call_events
            + asset_events
        ),
        "metadata": {
            "source_format":
                "geth_callTracer_with_optional_logs",

            "logical_timestamps": True,

            "call_record_type":
                "call_frame",

            "asset_record_type":
                "asset_transfer",

            "function_names_enriched": False,

            "token_metadata_enriched": False,

            "gas_heavy_classification":
                "not_assigned",

            "standard_transfer_recognition":
                "Transfer(address,address,uint256) "
                "with non-indexed uint256 value",

            "retained_logs":
                retained_logs,

            "standard_transfer_records":
                standard_transfer_logs,

            "indexed_transfer_logs_not_converted":
                skipped_indexed_transfer_logs,

            "realized_native_value_calls":
                realized_native_value_calls,

            "reverted_native_value_attempts":
                reverted_native_value_attempts,
        },
    }


def main(input_path, output_path):
    with open(input_path, "r") as f:
        data = json.load(f)

    if isinstance(data, dict) and "error" in data:
        raise ValueError(
            f"RPC trace returned an error: "
            f"{data['error']}"
        )

    if isinstance(data, dict) and "result" in data:
        root = data["result"]
    else:
        root = data

    if not isinstance(root, dict):
        raise ValueError(
            "Input does not contain a "
            "callTracer root frame"
        )

    converted = convert_calltracer(root)

    with open(output_path, "w") as f:
        json.dump(
            converted,
            f,
            indent=2,
        )

    call_frames = [
        event
        for event in converted["traceEvents"]
        if (
            event.get("ph") == "B"
            and event.get(
                "args",
                {},
            ).get("record_type")
            == "call_frame"
        )
    ]

    asset_transfers = [
        event
        for event in converted["traceEvents"]
        if (
            event.get("ph") == "X"
            and event.get(
                "args",
                {},
            ).get("record_type")
            == "asset_transfer"
        )
    ]

    failed = sum(
        1
        for event in call_frames
        if event.get(
            "args",
            {},
        ).get("success") == 0
    )

    max_depth = max(
        (
            event.get(
                "args",
                {},
            ).get("depth", 0)
            for event in call_frames
        ),
        default=0,
    )

    native_value_calls = sum(
        1
        for event in call_frames
        if event.get(
            "args",
            {},
        ).get("has_native_value") is True
    )

    realized_native_value_calls = sum(
        1
        for event in call_frames
        if event.get(
            "args",
            {},
        ).get(
            "has_realized_native_value"
        ) is True
    )

    reverted_native_value_attempts = sum(
        1
        for event in call_frames
        if event.get(
            "args",
            {},
        ).get(
            "native_value_status"
        ) == "reverted_attempt"
    )

    category_counts = {}

    for event in call_frames:
        category = event.get(
            "args",
            {},
        ).get(
            "visual_category",
            "normal_call",
        )

        category_counts[category] = (
            category_counts.get(
                category,
                0,
            ) + 1
        )

    metadata = converted["metadata"]

    print("Conversion complete")
    print(
        "Source format: geth callTracer"
    )

    print(
        "Total call frames:",
        len(call_frames),
    )

    print(
        "Maximum depth:",
        max_depth,
    )

    print(
        "Failed/reverted frames:",
        failed,
    )

    print(
        "All native-value calls:",
        native_value_calls,
    )

    print(
        "Realized native-value calls:",
        realized_native_value_calls,
    )

    print(
        "Reverted native-value attempts:",
        reverted_native_value_attempts,
    )

    print(
        "Retained logs:",
        metadata["retained_logs"],
    )

    print(
        "Asset-transfer records:",
        len(asset_transfers),
    )

    print(
        "Indexed Transfer logs not converted:",
        metadata[
            "indexed_transfer_logs_not_converted"
        ],
    )

    print(
        "Function-name enrichment: "
        "not performed"
    )

    print(
        "Token metadata normalization: "
        "not performed"
    )

    print(
        "Gas-heavy classification: "
        "not assigned"
    )

    print(
        "\nCall-frame visual categories:"
    )

    for category, count in sorted(
        category_counts.items()
    ):
        print(
            f"  {category}: {count}"
        )

    print(
        "\nOutput:",
        output_path,
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(
            "Usage: python3 "
            "calltracer_to_perfetto.py "
            "<raw_calltracer.json> "
            "<perfetto.json>"
        )
        sys.exit(1)

    main(
        sys.argv[1],
        sys.argv[2],
    )
    