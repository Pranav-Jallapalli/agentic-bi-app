import json
import math
import sys


def normalize_rows(rows):
    normalized = []
    for row in rows:
        if isinstance(row, dict):
            label = row.get('product') or row.get('region') or row.get('customer') or 'Metric'
            value = float(row.get('revenue', 0) or 0)
            normalized.append({"label": str(label), "value": value})
    return normalized


def analyze(rows, context_notes):
    items = normalize_rows(rows)
    if not items:
        return {
            "summary": "No rows were provided for ML analysis.",
            "anomalies": [],
            "forecast": {"period": "next quarter", "forecastRevenue": 0, "trend": "stable"},
            "contextSignals": context_notes or [],
        }

    values = [item["value"] for item in items]
    avg = sum(values) / len(values)
    anomalies = []
    for item in items:
        delta = ((item["value"] - avg) / avg * 100) if avg else 0
        if avg and item["value"] < avg * 0.75:
            anomalies.append({
                "label": item["label"],
                "value": round(item["value"], 2),
                "deltaPct": round(delta, 2),
                "severity": "watch" if delta > -35 else "critical",
            })

    base = values[-1] if values else 0
    if len(values) >= 2:
        slope = (values[-1] - values[0]) / max(1, len(values) - 1)
    else:
        slope = 0
    forecast_value = max(0, base + slope * 2)

    trend = "upward" if forecast_value > base else "stable" if abs(forecast_value - base) < 0.01 else "downward"

    return {
        "summary": f"The local ML service reviewed {len(items)} business segments and detected {len(anomalies)} material anomalies relative to the baseline.",
        "anomalies": anomalies,
        "forecast": {
            "period": "next quarter",
            "forecastRevenue": round(forecast_value, 2),
            "trend": trend,
            "confidence": "moderate" if anomalies else "steady",
            "currentRevenue": round(base, 2),
        },
        "contextSignals": context_notes or [],
    }


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    rows = payload.get("rows", [])
    context_notes = payload.get("contextNotes", [])
    result = analyze(rows, context_notes)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
