from rest_framework import serializers
from .models import BinSnapshot


class BinSnapshotSerializer(serializers.ModelSerializer):
    xyz = serializers.SerializerMethodField()
    dims = serializers.SerializerMethodField()
    metrics = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = BinSnapshot
        fields = [
            "bin_id",
            "xyz",
            "dims",
            "level",
            "storage_type",
            "zone",
            "metrics",
            "status",
        ]

    def get_xyz(self, obj):
        return [obj.x, obj.y, obj.z]

    def get_dims(self, obj):
        return [obj.width, obj.height, obj.depth]

    def get_metrics(self, obj):
        return {
            "abc": obj.abc,
            "hits": obj.hits,
            "qty": obj.qty,
            "utilization": obj.utilization,
        }

    def get_status(self, obj):
        return {
            "occupied": obj.occupied,
            "over_capacity": obj.over_capacity,
            "open_movements": obj.open_movements,
            "assigned": obj.assigned,
        }
