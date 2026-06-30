import json
import sys


ACCESS_CONTROL_KEYWORDS = [
    "whitelist", "blacklist", "owner", "admin", "role", "access",
    "permission", "auth", "grant", "revoke", "approve", "allowance",
    "setrouter", "setvault", "setcontroller", "iswhitelisted",
    "onlyowner", "onlyadmin", "gettokendetails"
]

CALL_KINDS = {
    "CALL",
    "STATICCALL",
    "DELEGATECALL",
    "CALLCODE",
    "CREATE",
    "CREATE2",
}


def hex_to_int(value):
    if value is None:
        return 0

    if isinstance(value, bool):
        return int(value)

    if isinstance(value, int):
        return value

    try:
        value_str = str(value).strip()

        if value_str == "":
            return 0

        if value_str.startswith(("0x", "0X")):
            return int(value_str, 16)

        return int(value_str)

    except Exception:
        return 0


def get_int_arg(args, *keys):
    for key in keys:
        if key in args:
            return hex_to_int(args.get(key))
    return 0


def compute_p90(values):
    values = sorted([v for v in values if v > 0])

    if not values:
        return 0

    index = 0.9 * (len(values) - 1)
    lower = int(index)
    upper = lower + 1

    if upper >= len(values):
        return round(values[-1])

    fraction = index - lower
    interpolated = values[lower] + fraction * (values[upper] - values[lower])

    return round(interpolated)


def is_access_control(name):
    name_lower = str(name).lower()
    return any(keyword in name_lower for keyword in ACCESS_CONTROL_KEYWORDS)


def normalize_kind(args, event):
    kind = (
        args.get("kind")
        or args.get("type")
        or "CALL"
    )

    kind = str(kind).strip().upper()

    if kind == "":
        return "CALL"

    return kind

def compute_depths(events):
    stack = []
    depths = {}

    for i, event in enumerate(events):
        ph = event.get("ph")

        if ph == "B":
            depths[i] = len(stack)
            stack.append(i)

        elif ph == "E":
            if stack:
                stack.pop()

    return depths


def assign_category(name, kind, value_decimal, amount_decimal, gas_used, p90):
    if is_access_control(name):
        return "access_control"

    if value_decimal > 0 or amount_decimal > 0:
        return "money_flow"

    if gas_used >= p90:
        return "gas_heavy"

    if kind in CALL_KINDS:
        return "contract_call"

    return "normal_call"


def process_trace(input_path, output_path):
    with open(input_path, "r") as f:
        data = json.load(f)

    if isinstance(data, list):
        events = data
    else:
        events = data.get("traceEvents", [])

    begin_events = [e for e in events if e.get("ph") == "B"]

    gas_values = []
    for event in begin_events:
        args = event.get("args", {})
        gas_used = get_int_arg(args, "gasUsed", "gas_used", "gas_used_decimal")
        gas_values.append(gas_used)

    p90 = compute_p90(gas_values)
    depths = compute_depths(events)

    updated_events = []
    category_counts = {}
    money_flow_count = 0
    total_value_decimal = 0
    total_amount_decimal = 0

    for event_index, event in enumerate(events):
        new_event = dict(event)
        args = dict(new_event.get("args", {}))

        if new_event.get("ph") == "B":
            name = new_event.get("name", "")

            kind = normalize_kind(args, new_event)

            gas_used = get_int_arg(
                args,
                "gasUsed",
                "gas_used",
                "gas_used_decimal"
            )

            gas_assigned = get_int_arg(
                args,
                "gas",
                "gasAssigned",
                "gas_assigned",
                "gas_assigned_decimal",
                "gas_decimal"
            )

            value_decimal = get_int_arg(
                args,
                "value",
                "value_decimal"
            )

            amount_decimal = get_int_arg(
                args,
                "amount",
                "amount_decimal"
            )

            gas_usage_ratio = (
                round(gas_used / gas_assigned, 6)
                if gas_assigned > 0
                else "not_available"
            )

            depth = args.get("depth")
            if depth is None:
                depth = depths.get(event_index, 0)

            category = assign_category(
                name=name,
                kind=kind,
                value_decimal=value_decimal,
                amount_decimal=amount_decimal,
                gas_used=gas_used,
                p90=p90,
            )

            args["kind"] = kind
            args["visual_category"] = category
            args["gas_used_decimal"] = gas_used
            args["gas_assigned_decimal"] = gas_assigned
            args["gas_usage_ratio"] = gas_usage_ratio
            args["gas_heavy_threshold_90th"] = p90
            args["is_gas_heavy"] = gas_used >= p90
            args["value_decimal"] = value_decimal
            args["amount_decimal"] = amount_decimal
            args["is_money_flow"] = value_decimal > 0 or amount_decimal > 0
            args["depth"] = depth

            new_event["args"] = args
            new_event["cat"] = category

            category_counts[category] = category_counts.get(category, 0) + 1

            if args["is_money_flow"]:
                money_flow_count += 1
                total_value_decimal += value_decimal
                total_amount_decimal += amount_decimal

        updated_events.append(new_event)

    output_data = {"traceEvents": updated_events}

    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2)

    print("Conversion complete")
    print(f"Input file: {input_path}")
    print(f"Output file: {output_path}")
    print(f"Total calls: {len(begin_events)}")
    print(f"P90 threshold: {p90}")
    print(f"Max gas used: {max(gas_values) if gas_values else 0}")

    print("\nCategory counts:")
    for category, count in sorted(category_counts.items()):
        print(f"  {category}: {count}")

    print("\nMoney flow:")
    print(f"  Money-flow calls: {money_flow_count}")
    print(f"  Total value decimal: {total_value_decimal}")
    print(f"  Total amount decimal: {total_amount_decimal}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 convert_trace.py <input_json> <output_json>")
        sys.exit(1)

    process_trace(sys.argv[1], sys.argv[2])
