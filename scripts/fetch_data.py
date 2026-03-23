#!/usr/bin/env python3
"""Fetch economic indicators data and append to metrics.json."""

import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yfinance as yf

DATA_FILE = Path(__file__).parent.parent / "data" / "metrics.json"
START_DATE = "2026-02-23"

YFINANCE_TICKERS = {
    "brent_oil": {"ticker": "BZ=F", "name": "נפט ברנט", "unit": "דולר/חבית"},
    "ta125": {"ticker": "^TA125.TA", "name": "ת״א-125", "unit": "נקודות"},
    "sp500": {"ticker": "^GSPC", "name": "S&P 500", "unit": "נקודות"},
    "stoxx600": {"ticker": "^STOXX", "name": "STOXX Europe 600", "unit": "נקודות"},
    "asia_pacific": {
        "ticker": "^302000-USD-STRD",
        "fallback": "^N225",
        "name": "אסיה-פסיפיק",
        "unit": "נקודות",
    },
}

INTERVAL_SECONDS = 3600  # 1 hour


def load_data():
    """Load existing metrics.json or return empty structure."""
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass

    return {
        "last_updated": None,
        "metrics": {
            "brent_oil": {"name": "נפט ברנט", "ticker": "BZ=F", "unit": "דולר/חבית", "data": []},
            "ta125": {"name": "ת״א-125", "ticker": "^TA125.TA", "unit": "נקודות", "data": []},
            "sp500": {"name": "S&P 500", "ticker": "^GSPC", "unit": "נקודות", "data": []},
            "stoxx600": {"name": "STOXX Europe 600", "ticker": "^STOXX", "unit": "נקודות", "data": []},
            "asia_pacific": {"name": "אסיה-פסיפיק", "ticker": "^302000-USD-STRD", "unit": "נקודות", "data": []},
        },
    }


def save_data(data):
    """Write metrics data to JSON file."""
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def round_to_hour(dt):
    """Round a datetime to the nearest full hour."""
    rounded = dt.replace(minute=0, second=0, microsecond=0)
    if dt.minute >= 30:
        rounded += timedelta(hours=1)
    return rounded


def thin_points(points):
    """Keep one point per ~1h window, using time-gap approach."""
    if not points:
        return points
    result = [points[0]]
    for p in points[1:]:
        last_ts = datetime.fromisoformat(result[-1]["timestamp"].replace("Z", "+00:00"))
        cur_ts = datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00"))
        if (cur_ts - last_ts).total_seconds() >= INTERVAL_SECONDS - 300:  # 55min tolerance
            result.append(p)
    return result


def forward_fill(points):
    """Fill gaps > 1h with the last known value at 1h intervals (straight line when closed)."""
    if len(points) < 2:
        return points
    filled = [points[0]]
    for p in points[1:]:
        last_ts = datetime.fromisoformat(filled[-1]["timestamp"].replace("Z", "+00:00"))
        cur_ts = datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00"))
        gap = (cur_ts - last_ts).total_seconds()
        # If gap is larger than ~1.5 intervals, insert fill points
        if gap > INTERVAL_SECONDS * 1.5:
            last_val = filled[-1]["value"]
            fill_ts = last_ts + timedelta(seconds=INTERVAL_SECONDS)
            while fill_ts < cur_ts - timedelta(seconds=INTERVAL_SECONDS * 0.5):
                filled.append({
                    "timestamp": fill_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "value": last_val,
                    "fill": True,
                })
                fill_ts += timedelta(seconds=INTERVAL_SECONDS)
        filled.append(p)
    return filled


def extend_to_now(points):
    """Extend the last data point forward to the current hour."""
    if not points:
        return points
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    last_ts = datetime.fromisoformat(points[-1]["timestamp"].replace("Z", "+00:00"))
    last_val = points[-1]["value"]
    fill_ts = last_ts + timedelta(seconds=INTERVAL_SECONDS)
    while fill_ts <= now:
        points.append({
            "timestamp": fill_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "value": last_val,
            "fill": True,
        })
        fill_ts += timedelta(seconds=INTERVAL_SECONDS)
    return points


def fetch_yfinance_ticker(key, config, existing_data):
    """Fetch hourly data for a yfinance ticker, appending to existing data."""
    existing_timestamps = {d["timestamp"] for d in existing_data}
    # Strip forward-filled points (keep only real trade data for dedup)
    real_data = [d for d in existing_data if not d.get("fill")]

    # Determine start date
    if real_data:
        last_ts = max(d["timestamp"] for d in real_data)
        start = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
    else:
        start = datetime.strptime(START_DATE, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    if (now - start).total_seconds() < INTERVAL_SECONDS:
        print(f"  {key}: no new data needed (last update < 1h ago)")
        return existing_data

    ticker_symbol = config["ticker"]
    df = yf.download(ticker_symbol, start=start, end=now, interval="1h", progress=False)

    # Fallback for asia_pacific
    if df.empty and "fallback" in config:
        print(f"  {key}: primary ticker empty, trying fallback {config['fallback']}")
        ticker_symbol = config["fallback"]
        df = yf.download(ticker_symbol, start=start, end=now, interval="1h", progress=False)

    if df.empty:
        print(f"  {key}: no new data available")
        return existing_data

    # Handle MultiIndex columns from yfinance
    if hasattr(df.columns, 'levels'):
        df.columns = df.columns.get_level_values(0)

    new_points = []
    for ts, row in df.iterrows():
        # Normalize to UTC
        if hasattr(ts, 'tz_convert'):
            ts_utc = ts.tz_convert("UTC")
        else:
            ts_utc = ts

        # Round to nearest full hour
        ts_rounded = round_to_hour(ts_utc)
        iso = ts_rounded.strftime("%Y-%m-%dT%H:%M:%SZ")

        if iso not in existing_timestamps:
            close_val = float(row["Close"])
            if close_val > 0:
                new_points.append({"timestamp": iso, "value": round(close_val, 2)})
                existing_timestamps.add(iso)  # prevent duplicates from rounding

    if new_points:
        print(f"  {key}: +{len(new_points)} new raw points")

    # Merge real data + new points, thin to ~1h, then forward-fill gaps
    merged = real_data + new_points
    merged.sort(key=lambda d: d["timestamp"])
    merged = thin_points(merged)
    merged = forward_fill(merged)
    merged = extend_to_now(merged)
    return merged


def main():
    print(f"Fetching economic data at {datetime.now(timezone.utc).isoformat()}")
    data = load_data()

    # Fetch yfinance tickers
    for key, config in YFINANCE_TICKERS.items():
        existing = data["metrics"][key]["data"]
        try:
            updated = fetch_yfinance_ticker(key, config, existing)
            data["metrics"][key]["data"] = updated
            print(f"  {key}: {len(updated)} total points")
        except Exception as e:
            print(f"  {key}: ERROR - {e}", file=sys.stderr)
        time.sleep(1)  # Be nice to Yahoo Finance

    data["last_updated"] = datetime.now(timezone.utc).isoformat()
    save_data(data)
    print(f"Data saved to {DATA_FILE}")


if __name__ == "__main__":
    main()
