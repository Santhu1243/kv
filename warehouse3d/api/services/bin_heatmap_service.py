import pandas as pd
import numpy as np
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

FILES = {
    "xyz": BASE_DIR / "data/XYZ bin coordinates.xlsx",
    "stock": BASE_DIR / "data/STOCK in bin file.xlsx",
    "outbound": BASE_DIR / "data/OUTBOUND GI Completed Data.xlsx",
}

def load_xyz_bins():
    df = pd.read_excel(FILES["xyz"])
    df = df.rename(columns={
        "Storage Bin": "bin",
        "X Coordinate": "x",
        "Y Coordinate": "y",
        "Z Coordinate": "z"
    })

    return df[["bin", "x", "y", "z"]]

def load_stock_per_bin():
    df = pd.read_excel(FILES["stock"])

    # If quantity column exists, use it; otherwise count rows
    if "Quantity" in df.columns:
        stock = df.groupby("Storage Bin")["Quantity"].sum().reset_index()
        stock.columns = ["bin", "qty"]
    else:
        stock = df.groupby("Storage Bin").size().reset_index(name="qty")
        stock.columns = ["bin", "qty"]

    return stock

def load_hits_per_bin():
    df = pd.read_excel(FILES["outbound"])

    # Each row = one completed outbound movement
    hits = df.groupby("Storage Bin").size().reset_index(name="hits")
    hits.columns = ["bin", "hits"]

    return hits

def build_bin_base_table():
    xyz = load_xyz_bins()
    stock = load_stock_per_bin()
    hits = load_hits_per_bin()

    df = xyz.merge(stock, on="bin", how="left") \
            .merge(hits, on="bin", how="left")

    df["qty"] = df["qty"].fillna(0)
    df["hits"] = df["hits"].fillna(0)

    return df

def assign_abc(df):
    df = df.sort_values("hits", ascending=False)
    total_hits = df["hits"].sum()

    df["cum_pct"] = df["hits"].cumsum() / (total_hits if total_hits else 1)

    def classify(p):
        if p <= 0.70:
            return "A"
        elif p <= 0.90:
            return "B"
        return "C"

    df["abc"] = df["cum_pct"].apply(classify)
    return df

def generate_bin_heatmap_data():
    df = build_bin_base_table()
    df = assign_abc(df)

    result = []

    for _, row in df.iterrows():
        result.append({
            "bin": row["bin"],
            "x": float(row["x"]),
            "y": float(row["y"]),
            "z": float(row["z"]),
            "qty": int(row["qty"]),
            "hits": int(row["hits"]),
            "abc": row["abc"],
            "width": 1.2,
            "depth": 1.2,
            "height": 0.6
        })

    return result
