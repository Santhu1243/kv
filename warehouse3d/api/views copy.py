# api/views.py
from django.http import JsonResponse
from django.shortcuts import render
import json
from pathlib import Path

def warehouse_data(request):
    file_path = Path("api/data/bins.json")
    data = json.loads(file_path.read_text())
    return JsonResponse(data, safe=False)

def viewer(request):
    return render(request, "api/new.html")

# testing ---------------------------------------------------------------------------------------------------------------------------------------

 

import matplotlib.pyplot as plt 

from mpl_toolkits.mplot3d.art3d import Poly3DCollection 

import numpy as np 

 

class AdvancedBoxPacker3D: 

  def __init__(self, box_dimensions, cutoff_weight, buffer_percentage): 

    self.box_length, self.box_width, self.box_height = box_dimensions 

    self.box_volume = self.box_length * self.box_width * self.box_height 

    self.cutoff_weight = cutoff_weight 

    self.buffer_percentage = buffer_percentage / 100 

    self.max_fillable_volume = self.box_volume * self.buffer_percentage 

    self.packed_items = [] 

    self.total_volume = 0 

    self.total_weight = 0 

    self.extreme_points = [(0, 0, 0)] # Starting with one point in the box corner 

 

  def rotate_item(self, item_dimensions, orientation): 

    """ Rotate item to different orientations. """ 

    l, w, h = item_dimensions 

    if orientation == 0: return (l, w, h) 

    elif orientation == 1: return (l, h, w) 

    elif orientation == 2: return (w, l, h) 

    elif orientation == 3: return (w, h, l) 

    elif orientation == 4: return (h, l, w) 

    elif orientation == 5: return (h, w, l) 

 

  def can_fit_item(self, position, item_dimensions, placed_items): 

    """ Check if item can be placed at a given position without overlapping others. """ 

    x, y, z = position 

    item_length, item_width, item_height = item_dimensions 

 

    # Ensure item fits within the box dimensions 

    if (x + item_length > self.box_length or 

      y + item_width > self.box_width or 

      z + item_height > self.box_height): 

      return False 

 

    # Check for overlap with existing placed items 

    for packed_item in placed_items: 

      px, py, pz, pl, pw, ph = packed_item 

 

      if not (x + item_length <= px or px + pl <= x or 

          y + item_width <= py or py + pw <= y or 

          z + item_height <= pz or pz + ph <= z): 

        return False 

 

    return True 

 

  def update_extreme_points(self, new_item): 

    """ Update extreme points after placing a new item to account for new available spaces. """ 

    x, y, z, l, w, h = new_item 

 

    # Add new extreme points based on the item's position 

    new_points = [ 

      (x + l, y, z),   # Right of the item 

      (x, y + w, z),   # In front of the item 

      (x, y, z + h)   # Above the item 

    ] 

 

    # Filter out invalid points that are outside the box boundaries 

    self.extreme_points.extend([point for point in new_points if 

      point[0] <= self.box_length and 

      point[1] <= self.box_width and 

      point[2] <= self.box_height]) 

 

  def find_best_fit_point(self, item_dimensions, placed_items): 

    """ Use a score-based heuristic to select the best fit point for the item. """ 

    best_point = None 

    best_score = float('inf') 

    best_orientation = None 

 

    for orientation in range(6): 

      rotated_item = self.rotate_item(item_dimensions, orientation) 

 

      for point in self.extreme_points: 

        if self.can_fit_item(point, rotated_item, placed_items): 

          score = self.evaluate_fit_score(point, rotated_item) 

           

          if score < best_score: # Lower score means a better fit 

            best_point = point 

            best_orientation = orientation 

            best_score = score 

 

    return best_point, best_orientation 

 

  def evaluate_fit_score(self, point, item_dimensions): 

    """ Heuristic function to evaluate how well an item fits at a given point. 

      The score can consider factors like volume efficiency, proximity to other items, etc. """ 

    x, y, z = point 

    l, w, h = item_dimensions 

 

    # Calculate the remaining volume after placing the item (maximize utilization) 

    remaining_volume = (self.box_length - (x + l)) * (self.box_width - (y + w)) * (self.box_height - (z + h)) 

 

    # Add proximity and compactness to avoid leaving large gaps 

    proximity_score = (x + y + z) # Closer to the origin is better 

    total_score = remaining_volume + proximity_score 

 

    return total_score 

 

  def pack_items(self, items): 

    # Sort items by volume (largest first) to maximize space usage 

    items.sort(key=lambda x: x[0] * x[1] * x[2], reverse=True) 

    placed_items = [] 

 

    for item in items: 

      item_dimensions = item[:3] 

      item_weight = item[3] 

      item_volume = item[0] * item[1] * item[2] 

 

      if self.total_weight + item_weight > self.cutoff_weight: 

        break # Stop if adding this item exceeds the weight limit 

 

      if self.total_volume + item_volume > self.max_fillable_volume: 

        break # Stop if adding this item exceeds the box volume limit 

 

      # Find the best point and orientation to place the item 

      best_point, best_orientation = self.find_best_fit_point(item_dimensions, placed_items) 

 

      if best_point: 

        # Place the item at the best point with the best orientation 

        rotated_item = self.rotate_item(item_dimensions, best_orientation) 

        placed_items.append((*best_point, *rotated_item)) 

        self.packed_items.append({ 

          'dimensions': rotated_item, 

          'position': best_point, 

          'weight': item_weight 

        }) 

        self.total_weight += item_weight 

        self.total_volume += rotated_item[0] * rotated_item[1] * rotated_item[2] 

 

        # Update extreme points based on the new placement 

        self.update_extreme_points((*best_point, *rotated_item)) 

 

    return placed_items, self.total_volume, self.total_weight 

 

  def plot_box(self): 

    fig = plt.figure() 

    ax = fig.add_subplot(111, projection='3d') 

 

    # Draw the box boundaries 

    ax.plot([0, self.box_length, self.box_length, 0, 0], [0, 0, self.box_width, self.box_width, 0], [0, 0, 0, 0, 0], color='b') 

    ax.plot([0, self.box_length, self.box_length, 0, 0], [0, 0, self.box_width, self.box_width, 0], [self.box_height] * 5, color='b') 

 

    # Plot each packed item 

    for item in self.packed_items: 

      x, y, z = item['position'] 

      l, w, h = item['dimensions'] 

      color = plt.cm.viridis(item['weight'] / self.cutoff_weight) 

 

      vertices = [[(x, y, z), (x+l, y, z), (x+l, y+w, z), (x, y+w, z)], # Bottom face 

            [(x, y, z+h), (x+l, y, z+h), (x+l, y+w, z+h), (x, y+w, z+h)], # Top face 

            [(x, y, z), (x, y+w, z), (x, y+w, z+h), (x, y, z+h)], # Left face 

            [(x+l, y, z), (x+l, y+w, z), (x+l, y+w, z+h), (x+l, y, z+h)], # Right face 

            [(x, y, z), (x+l, y, z), (x+l, y, z+h), (x, y, z+h)], # Front face 

            [(x, y+w, z), (x+l, y+w, z), (x+l, y+w, z+h), (x, y+w, z+h)]] # Back face 

 

      ax.add_collection3d(Poly3DCollection(vertices, facecolors=color, linewidths=1, edgecolors='r', alpha=.25)) 

      ax.set_xlabel('Length') 

      ax.set_ylabel('Width') 

      ax.set_zlabel('Height') 

      plt.show() 

 

# Example usage 

items = [ 

  (10, 5, 2, 1.5), # length, width, height, weight 

  (15, 10, 5, 3.0), 

  (5, 5, 5, 0.5), 

  (8, 8, 8, 2.5), 

  (20, 15, 10, 6.0), 

  (20, 15, 10, 6.0), 

  (16, 15, 10, 6.0), 

  (20, 15, 13, 6.0), 

  (5, 7, 10, 6.0), 

  (9, 1, 10, 6.0), 

  (5, 5, 5, 6.0), 

  (5, 5, 5, 6.0), 

  (5, 5, 5, 6.0), 

  (5, 5, 5, 6.0), 

  (5, 5, 5, 6.0), 

  (10, 10, 5, 6.0) 

] 

 

box_dimensions = (30, 25, 20) # Box length, width, height 

cutoff_weight = 100 # Maximum weight 

buffer_percentage = 90 # Fill up to 90% of the box 

 

box_packer = AdvancedBoxPacker3D(box_dimensions, cutoff_weight, buffer_percentage) 

packed_items, total_volume, total_weight = box_packer.pack_items(items) 

 

print(f"Packed items: {packed_items}") 

print(f"Total packed volume: {total_volume}") 

print(f"Total packed weight: {total_weight}") 

 

# Plot the box and packing result 

box_packer.plot_box() 

 
from django.shortcuts import render, redirect
from .forms import WarehouseConfigForm
from .models import WarehouseConfig

def warehouse_settings(request):
    config = WarehouseConfig.objects.first()  # use latest or create default
    if not config:
        config = WarehouseConfig.objects.create()

    if request.method == "POST":
        form = WarehouseConfigForm(request.POST, instance=config)
        if form.is_valid():
            form.save()
            return redirect("warehouse_viewer")  # go to 3D viewer page
    else:
        form = WarehouseConfigForm(instance=config)

    return render(request, "settings.html", {"form": form})

from django.http import JsonResponse
from .models import WarehouseConfig

from django.http import JsonResponse
from .models import WarehouseConfig

def get_warehouse_config(request):
    # Try to fetch config
    config = WarehouseConfig.objects.first()

    # If none found → create a default
    if not config:
        config = WarehouseConfig.objects.create(
            rows=5,
            shelves_per_row=8,
            levels_per_shelf=4,
            bin_width=1.2,
            bin_height=0.7,
            bin_depth=1.2,
            use_pallet_racking=True,
        )

    # Return JSON to frontend
    return JsonResponse({
        "rows": config.rows,
        "shelves_per_row": config.shelves_per_row,
        "levels_per_shelf": config.levels_per_shelf,
        "bin_width": float(config.bin_width),
        "bin_height": float(config.bin_height),
        "bin_depth": float(config.bin_depth),
        "use_pallet_racking": config.use_pallet_racking,
    })



import os
import matplotlib.pyplot as plt
import numpy as np

from django.conf import settings
from django.shortcuts import render


def slotting_summary_view(request):
    # -----------------------------
    # KPI DATA (replace with DB later)
    # -----------------------------
    total_orders = 15326
    total_replens = 550
    urgent_replens = 300
    normal_replens = 250
    avg_replens_per_week = 138

    # -----------------------------
    # WEEKLY DATA
    # -----------------------------
    weeks = ["27-May", "3-Jun", "10-Jun", "17-Jun"]
    urgent_weekly = np.array([49, 55, 56, 60])
    normal_weekly = np.array([74, 83, 84, 91])

    # -----------------------------
    # CHART PATH
    # -----------------------------
    chart_dir = os.path.join(settings.MEDIA_ROOT, "charts")
    os.makedirs(chart_dir, exist_ok=True)

    chart_path = os.path.join(chart_dir, "slotting_summary.png")

    # -----------------------------
    # PLOT
    # -----------------------------
    plt.rcParams["font.family"] = "Calibri"
    fig = plt.figure(figsize=(12, 10))
    fig.suptitle("Summary", fontsize=18, fontweight="bold")

    # KPI TEXT
    kpi_text = (
        f"Total Orders\n{total_orders:,}\n\n"
        f"Total Replens\n{total_replens}\n\n"
        f"Urgent Replens\n{urgent_replens}\n\n"
        f"Normal Replens\n{normal_replens}\n\n"
        f"Avg Replens / Week\n{avg_replens_per_week}"
    )
    fig.text(0.05, 0.85, kpi_text, fontsize=11, va="top")

    # Horizontal stacked bar
    ax1 = fig.add_axes([0.25, 0.72, 0.65, 0.08])

    urgent_pct = urgent_replens / total_replens * 100
    normal_pct = normal_replens / total_replens * 100

    ax1.barh(["Total Replens"], urgent_pct, color="#F28E2B", label="Urgent Replens")
    ax1.barh(["Total Replens"], normal_pct, left=urgent_pct, color="#2E7D32", label="Normal Replens")
    ax1.set_xlim(0, 100)
    ax1.set_xlabel("%")
    ax1.legend()
    ax1.grid(axis="x", linestyle="--", alpha=0.5)

    # Weekly stacked bar
    ax2 = fig.add_axes([0.25, 0.35, 0.65, 0.28])
    x = np.arange(len(weeks))

    ax2.bar(x, urgent_weekly, 0.5, label="Urgent", color="#F28E2B")
    ax2.bar(x, normal_weekly, 0.5, bottom=urgent_weekly, label="Normal", color="#2E7D32")

    ax2.set_xticks(x)
    ax2.set_xticklabels(weeks)
    ax2.set_ylabel("Replen Count")
    ax2.set_title("Weekly Replenishments")
    ax2.legend()
    ax2.grid(axis="y", linestyle="--", alpha=0.5)

    # Labels
    for i in range(len(weeks)):
        ax2.text(x[i], urgent_weekly[i] / 2, str(urgent_weekly[i]),
                 ha="center", va="center", color="white", fontweight="bold")
        ax2.text(x[i], urgent_weekly[i] + normal_weekly[i] / 2, str(normal_weekly[i]),
                 ha="center", va="center", color="white", fontweight="bold")

    plt.savefig(chart_path, dpi=300, bbox_inches="tight")
    plt.close()

    context = {
        "chart_url": settings.MEDIA_URL + "charts/slotting_summary.png",
        "total_orders": total_orders,
        "total_replens": total_replens,
        "urgent_replens": urgent_replens,
        "normal_replens": normal_replens,
        "avg_replens_per_week": avg_replens_per_week,
    }

    return render(request, "api/summary.html", context)


def warehouse_heatmap(request):
    return render(request, "warehouse-heatmap.html")



# *********************************************************************************
from django.http import JsonResponse
from .services.bin_heatmap_service import generate_bin_heatmap_data

def bin_heatmap_api(request):
    data = generate_bin_heatmap_data()
    return JsonResponse({"bins": data}, safe=False)



from rest_framework.views import APIView
from rest_framework.response import Response

from .models import Warehouse, WarehouseSnapshot, BinSnapshot
from .serializers import BinSnapshotSerializer


# api/views.py
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import Warehouse, WarehouseSnapshot, BinSnapshot
from .serializers import BinSnapshotSerializer


# api/views.py
from django.http import JsonResponse
from .models import Warehouse, WarehouseSnapshot, BinSnapshot
from .serializers import BinSnapshotSerializer


def warehouse_3d_snapshot(request):
    warehouse = Warehouse.objects.first()
    snapshot = WarehouseSnapshot.objects.filter(
        warehouse=warehouse
    ).first()

    if not warehouse or not snapshot:
        return JsonResponse({"bins": []})

    bins = BinSnapshot.objects.filter(snapshot=snapshot)

    return JsonResponse({
        "meta": {
            "warehouse_code": warehouse.code,
            "snapshot_version": snapshot.version,
            "bin_count": bins.count(),
        },
        "warehouse": {
            "bounds": {
                "x": warehouse.bounds_x,
                "y": warehouse.bounds_y,
                "z": warehouse.bounds_z,
            },
            "floor_y": 0,
        },
        "bins": BinSnapshotSerializer(bins, many=True).data,
    })


from .models import WarehouseConfig
from django.http import JsonResponse

def warehouse_config_api(request):
    cfg, _ = WarehouseConfig.objects.get_or_create(id=1)
    return JsonResponse({
        "layout": {
            "rows": cfg.rows,
            "racksPerRow": cfg.racks_per_row,
            "levels": cfg.max_levels,
        },
        "rack": {
            "type": cfg.rack_type,
            "width": cfg.rack_width,
            "depth": cfg.rack_depth,
            "shelfGap": cfg.shelf_gap,
        },
        "bin": {
            "width": cfg.bin_width,
            "height": cfg.bin_height,
            "depth": cfg.bin_depth,
        }
    })


from django.shortcuts import render, redirect
from .models import WarehouseConfig

def warehouse_settings(request):
    config, _ = WarehouseConfig.objects.get_or_create(id=1)

    if request.method == "POST":
        config.rows = request.POST["rows"]
        config.racks_per_row = request.POST["racks_per_row"]
        config.max_levels = request.POST["levels"]
        config.rack_type = request.POST["rack_type"]
        config.rack_width = request.POST["rack_width"]
        config.rack_depth = request.POST["rack_depth"]
        config.bin_width = request.POST["bin_width"]
        config.bin_height = request.POST["bin_height"]
        config.bin_depth = request.POST["bin_depth"]
        config.save()

        return redirect("/api/viewer/")

    return render(request, "api/settings.html", {"config": config})


from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import StorageBin

@api_view(["GET"])
def warehouse_3d_view(request):
    bins = []

    for b in StorageBin.objects.select_related("binstock"):
        stock = getattr(b, "binstock", None)

        bins.append({
            "bin_id": b.bin_code,
            "x": b.x,
            "y": b.y,
            "z": b.z,
            "width": b.width,
            "height": b.height,
            "depth": b.depth,
            "qty": stock.quantity if stock else 0,
            "abc": stock.abc_class if stock else "C",
            "hits": stock.hit_count if stock else 0,
            "occupied": bool(stock and stock.quantity > 0),
        })

    return Response({
        "warehouse": "WH01",
        "bins": bins
    })
