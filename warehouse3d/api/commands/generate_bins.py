from django.core.management.base import BaseCommand
from api.models import Warehouse, WarehouseConfig, StorageBin

class Command(BaseCommand):
    help = "Generate storage bins based on warehouse config"

    def handle(self, *args, **options):
        wh = Warehouse.objects.get(code="WH1")
        cfg = wh.config

        StorageBin.objects.filter(warehouse=wh).delete()

        bins = []
        for row in range(1, cfg.rows + 1):
            for shelf in range(1, cfg.racks_per_row + 1):
                for level in range(1, cfg.max_levels + 1):

                    x = (shelf - cfg.racks_per_row / 2) * (cfg.rack_width + 1.0)
                    y = level * cfg.shelf_gap
                    z = (row - cfg.rows / 2) * (cfg.rack_depth + 3.0)

                    bin_code = f"R{row}-S{shelf}-L{level}"

                    bins.append(StorageBin(
                        warehouse=wh,
                        bin_code=bin_code,
                        row=row,
                        shelf=shelf,
                        level=level,
                        x=x,
                        y=y,
                        z=z,
                        width=cfg.bin_width,
                        height=cfg.bin_height,
                        depth=cfg.bin_depth,
                    ))

        StorageBin.objects.bulk_create(bins)
        self.stdout.write(self.style.SUCCESS(f"Generated {len(bins)} bins"))
