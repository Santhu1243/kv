def calculate_abc(bin_movements):
    """
    bin_movements = {
      bin_code: hit_count
    }
    """
    total_hits = sum(bin_movements.values())
    sorted_bins = sorted(bin_movements.items(), key=lambda x: x[1], reverse=True)

    cumulative = 0
    abc_map = {}

    for bin_code, hits in sorted_bins:
        cumulative += hits
        ratio = cumulative / total_hits

        if ratio <= 0.7:
            abc_map[bin_code] = "A"
        elif ratio <= 0.9:
            abc_map[bin_code] = "B"
        else:
            abc_map[bin_code] = "C"

    return abc_map


from ..models import StorageBin, BinStock

def update_abc(abc_map):
    for bin_code, abc in abc_map.items():
        try:
            stock = BinStock.objects.get(bin__bin_code=bin_code)
            stock.abc_class = abc
            stock.save(update_fields=["abc_class"])
        except BinStock.DoesNotExist:
            pass
