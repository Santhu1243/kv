from .normalizer import normalize_xyz
from ..models import StorageBin, BinStock, Warehouse

def sync_bins_from_sap(sap_rows):
    wh, _ = Warehouse.objects.get_or_create(code="WH01", name="Main Warehouse")

    for r in sap_rows:
        x, y, z = normalize_xyz(r["Xcord"], r["Ycord"], r["Zcord"])

        bin_obj, _ = StorageBin.objects.update_or_create(
            warehouse=wh,
            bin_code=r["Storagebin"],
            defaults={
                "sap_x": r["Xcord"],
                "sap_y": r["Ycord"],
                "sap_z": r["Zcord"],
                "x": x,
                "y": y,
                "z": z,
            },
        )

        BinStock.objects.update_or_create(
            bin=bin_obj,
            defaults={
                "material": r["Matnr"],
                "batch": r.get("Batch"),
                "quantity": float(r["Quan"]),
                "uom": r["Auom"],
            },
        )
