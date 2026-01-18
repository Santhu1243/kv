from django.db import models


# ============================================================
# WAREHOUSE MASTER
# ============================================================

class Warehouse(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)

    bounds_x = models.FloatField(default=200.0)
    bounds_y = models.FloatField(default=50.0)
    bounds_z = models.FloatField(default=160.0)

    def __str__(self):
        return f"{self.code} - {self.name}"


# ============================================================
# WAREHOUSE CONFIG (VISUAL / STRUCTURAL)
# ============================================================

class WarehouseConfig(models.Model):
    warehouse = models.OneToOneField(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="config"
    )

    rows = models.IntegerField(default=6)
    racks_per_row = models.IntegerField(default=8)
    max_levels = models.IntegerField(default=4)

    rack_type = models.CharField(
        max_length=20,
        choices=[("basic", "Basic"), ("pallet", "Pallet")],
        default="basic"
    )

    rack_width = models.FloatField(default=4.0)
    rack_depth = models.FloatField(default=2.0)
    shelf_gap = models.FloatField(default=2.0)

    bin_width = models.FloatField(default=1.2)
    bin_height = models.FloatField(default=1.2)
    bin_depth = models.FloatField(default=1.2)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Config - {self.warehouse.code}"


# ============================================================
# PRODUCT MASTER (SKU)
# ============================================================

class Product(models.Model):
    sku = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)

    image_url = models.URLField(null=True, blank=True)

    def __str__(self):
        return f"{self.sku} - {self.name}"


# ============================================================
# PHYSICAL STORAGE BIN (3D + LOCATION)
# ============================================================

class StorageBin(models.Model):
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="bins"
    )

    bin_code = models.CharField(max_length=50)

    # Logical layout
    row = models.IntegerField(default=0)
    shelf = models.IntegerField(default=0)
    level = models.IntegerField(default=0)

    # World coordinates (meters)
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()

    # Geometry
    width = models.FloatField(default=1.2)
    height = models.FloatField(default=1.2)
    depth = models.FloatField(default=1.2)

    zone = models.CharField(max_length=50, null=True, blank=True)
    abc_class = models.CharField(
        max_length=1,
        choices=[("A", "A"), ("B", "B"), ("C", "C")],
        default="C",
        db_index=True
    )

    class Meta:
        unique_together = ("warehouse", "bin_code")
        indexes = [
            models.Index(fields=["warehouse", "bin_code"]),
            models.Index(fields=["zone"]),
            models.Index(fields=["row", "shelf", "level"]),
        ]


    def __str__(self):
        return f"{self.bin_code} ({self.warehouse.code})"


# ============================================================
# BIN STOCK (MULTI-PRODUCT PER BIN)
# ============================================================

class BinStock(models.Model):
    bin = models.ForeignKey(
        StorageBin,
        related_name="stocks",
        on_delete=models.CASCADE
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT
    )

    batch = models.CharField(max_length=50, null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)

    quantity = models.FloatField(default=0.0)
    uom = models.CharField(max_length=10, default="EA")

    abc_class = models.CharField(
        max_length=1,
        choices=[("A", "A"), ("B", "B"), ("C", "C")],
        default="C"
    )

    hit_count = models.IntegerField(default=0)

    last_sync = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("bin", "product", "batch")
        indexes = [
            models.Index(fields=["product"]),
            models.Index(fields=["abc_class"]),
        ]

    def __str__(self):
        return f"{self.bin.bin_code} → {self.product.sku}"


# ============================================================
# SNAPSHOT MASTER (HISTORY)
# ============================================================

class WarehouseSnapshot(models.Model):
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="snapshots"
    )

    version = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("warehouse", "version")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.warehouse.code} @ {self.version}"


# ============================================================
# BIN SNAPSHOT (READ-ONLY STATE)
# ============================================================

class BinSnapshot(models.Model):
    snapshot = models.ForeignKey(
        WarehouseSnapshot,
        on_delete=models.CASCADE,
        related_name="bin_snapshots"
    )

    bin_code = models.CharField(max_length=100)

    # Geometry
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()

    width = models.FloatField()
    height = models.FloatField()
    depth = models.FloatField()

    row = models.IntegerField()
    shelf = models.IntegerField()
    level = models.IntegerField()

    zone = models.CharField(max_length=50, null=True, blank=True)

    # Aggregated metrics
    abc = models.CharField(max_length=1, default="C")
    hits = models.IntegerField(default=0)
    qty = models.FloatField(default=0.0)

    utilization = models.FloatField(default=0.0)

    occupied = models.BooleanField(default=False)
    over_capacity = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["bin_code"]),
            models.Index(fields=["zone"]),
        ]

    def __str__(self):
        return f"{self.bin_code} @ {self.snapshot.version}"



# Analytics
from django.db import models

class PickingHeatmap(models.Model):
    file = models.FileField(upload_to="picking_heatmap/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Picking Heatmap {self.id} - {self.uploaded_at.date()}"

from django.db import models


class ReplenishmentUpload(models.Model):
    file = models.FileField(upload_to="replenishment/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Replenishment Upload {self.id}"
