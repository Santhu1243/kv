# api/models.py
from django.db import models

class Bin(models.Model):
    name = models.CharField(max_length=50)
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()
    qty = models.IntegerField()

    def __str__(self):
        return self.name

from django.db import models

class WarehouseConfig(models.Model):
    rows = models.IntegerField(default=6)
    racks_per_row = models.IntegerField(default=8)
    max_levels = models.IntegerField(default=4)

    rack_type = models.CharField(
        max_length=20,
        choices=[("basic", "Basic"), ("pallet", "Pallet")],
        default="basic"
    )

    rack_width = models.FloatField(default=4)
    rack_depth = models.FloatField(default=2)
    shelf_gap = models.FloatField(default=2)

    bin_width = models.FloatField(default=1.2)
    bin_height = models.FloatField(default=0.7)
    bin_depth = models.FloatField(default=1.2)

    updated_at = models.DateTimeField(auto_now=True)


# ******************************New ******************************
from django.db import models


class Warehouse(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)

    bounds_x = models.FloatField(default=200)
    bounds_y = models.FloatField(default=50)
    bounds_z = models.FloatField(default=160)

    def __str__(self):
        return f"{self.code} - {self.name}"

class WarehouseSnapshot(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE)
    version = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("warehouse", "version")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.warehouse.code} @ {self.version}"

class BinSnapshot(models.Model):
    snapshot = models.ForeignKey(WarehouseSnapshot, on_delete=models.CASCADE)

    bin_id = models.CharField(max_length=100)

    # Geometry (Excel / UI)
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()

    width = models.FloatField()
    height = models.FloatField()
    depth = models.FloatField()

    level = models.IntegerField()
    storage_type = models.CharField(max_length=50)

    # Slotting / zone
    zone = models.CharField(max_length=50, null=True, blank=True)

    # Metrics (SAP / WMS)
    abc = models.CharField(max_length=1)
    hits = models.IntegerField(default=0)
    qty = models.IntegerField(default=0)
    utilization = models.FloatField(default=0)

    # Status
    occupied = models.BooleanField(default=False)
    over_capacity = models.BooleanField(default=False)
    open_movements = models.IntegerField(default=0)
    assigned = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=["bin_id"]),
            models.Index(fields=["zone"]),
        ]

    def __str__(self):
        return self.bin_id





class StorageBin(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE)
    bin_code = models.CharField(max_length=50)

    # SAP coordinates (raw)
    sap_x = models.FloatField()
    sap_y = models.FloatField()
    sap_z = models.FloatField()

    # normalized 3D coordinates (meters)
    x = models.FloatField()
    y = models.FloatField()
    z = models.FloatField()

    width = models.FloatField(default=1.2)
    height = models.FloatField(default=0.7)
    depth = models.FloatField(default=1.2)

    zone = models.CharField(max_length=50, null=True, blank=True)

    class Meta:
        unique_together = ("warehouse", "bin_code")

    def __str__(self):
        return self.bin_code


class BinStock(models.Model):
    bin = models.OneToOneField(StorageBin, on_delete=models.CASCADE)

    material = models.CharField(max_length=50)
    batch = models.CharField(max_length=50, null=True, blank=True)
    quantity = models.FloatField()
    uom = models.CharField(max_length=10)

    abc_class = models.CharField(
        max_length=1,
        choices=[("A", "A"), ("B", "B"), ("C", "C")],
        null=True,
        blank=True,
    )

    hit_count = models.IntegerField(default=0)

    last_sync = models.DateTimeField(auto_now=True)
