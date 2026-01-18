from collections import defaultdict

from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.views.decorators.http import require_GET
from django.views import View
from django.contrib import messages

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    Product,
    Warehouse,
    WarehouseConfig,
    StorageBin,
    WarehouseSnapshot,
    BinSnapshot,
)


# ============================================================
# BASIC PAGES
# ============================================================

def viewer(request):
    """
    Main 3D viewer page (Three.js frontend)
    """
    return render(request, "api/new.html")

def viewer_2(request):
    """
    Main 3D viewer page (Three.js frontend)
    """
    return render(request, "api/viewer.html")

def viewer_3(request):
    """
    Main 3D viewer page (Three.js frontend)
    """
    return render(request, "api/viewer_3.html")
def warehouse_heatmap(request):
    """
    Heatmap UI page wrapper
    """
    return render(request, "warehouse-heatmap.html")


# ============================================================
# WAREHOUSE CONFIG (UI + API)
# ============================================================

def warehouse_settings(request):
    """
    Simple settings UI for warehouse layout
    """
    config, _ = WarehouseConfig.objects.get_or_create(id=1)

    if request.method == "POST":
        config.rows = int(request.POST.get("rows", config.rows))
        config.racks_per_row = int(request.POST.get("racks_per_row", config.racks_per_row))
        config.max_levels = int(request.POST.get("levels", config.max_levels))
        config.rack_type = request.POST.get("rack_type", config.rack_type)
        config.rack_width = float(request.POST.get("rack_width", config.rack_width))
        config.rack_depth = float(request.POST.get("rack_depth", config.rack_depth))
        config.bin_width = float(request.POST.get("bin_width", config.bin_width))
        config.bin_height = float(request.POST.get("bin_height", config.bin_height))
        config.bin_depth = float(request.POST.get("bin_depth", config.bin_depth))
        config.save()

        return redirect("/api/viewer/")

    return render(request, "api/settings.html", {"config": config})


@require_GET
def warehouse_config_api(request):
    """
    Configuration API used by frontend
    """
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


# ============================================================
# ✅ MAIN API FOR THREE.JS (LIVE DATA)
# ============================================================

@require_GET
def bin_heatmap_api(request):
    """
    Canonical API for the 3D warehouse viewer.
    Returns data in row → shelf → level → bin structure.
    """
    bins = (
        StorageBin.objects
        .select_related("warehouse")
        .prefetch_related("stocks__product")
        .order_by("row", "shelf", "level")
    )

    rows = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))

    for b in bins:
        products = []
        hits = 0
        qty = 0
        abc = "C"

        for s in b.stocks.all():
            products.append({
                "sku": s.product.sku if s.product else "",
                "name": s.product.name if s.product else "",
                "batch": s.batch,
                "expiry": s.expiry_date.isoformat() if s.expiry_date else None,
                "quantity": s.quantity,
                "image": s.product.image_url if s.product else None,
            })
            hits += s.hit_count
            qty += int(s.quantity)
            abc = s.abc_class or abc

        rows[b.row][b.shelf][b.level].append({
            "id": b.id,
            "label": b.bin_code,
            "type": "container",
            "width": b.width,
            "height": b.height,
            "depth": b.depth,
            "x": b.x,
            "y": b.y,
            "z": b.z,
            "qty": qty,
            "hits": hits,
            "abc": abc,
            "zone": b.zone,
            "products": products,
        })

    response = {"rows": []}

    for row_id, shelves in rows.items():
        row_obj = {"row_id": row_id, "shelves": []}
        for shelf_id, levels in shelves.items():
            shelf_obj = {"shelf_id": shelf_id, "levels": []}
            for level, bins_at_level in levels.items():
                shelf_obj["levels"].append({
                    "level": level,
                    "bin": bins_at_level[0],  # one bin per level
                })
            row_obj["shelves"].append(shelf_obj)
        response["rows"].append(row_obj)

    return JsonResponse(response)


# ============================================================
# SNAPSHOT API (READ-ONLY / HISTORY)
# ============================================================

@require_GET
def warehouse_3d_snapshot(request):
    """
    Returns the latest snapshot for historical replay
    """
    warehouse = Warehouse.objects.first()
    snapshot = (
        WarehouseSnapshot.objects
        .filter(warehouse=warehouse)
        .order_by("-created_at")
        .first()
    )

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
        "bins": [
            {
                "bin_code": b.bin_code,
                "x": b.x,
                "y": b.y,
                "z": b.z,
                "width": b.width,
                "height": b.height,
                "depth": b.depth,
                "row": b.row,
                "shelf": b.shelf,
                "level": b.level,
                "abc": b.abc,
                "hits": b.hits,
                "qty": b.qty,
                "zone": b.zone,
                "occupied": b.occupied,
            }
            for b in bins
        ]
    })


# ============================================================
# SIMPLE FLAT API (OPTIONAL / DEBUG)
# ============================================================

@api_view(["GET"])
def warehouse_3d_view(request):
    """
    Flat list of bins (debug / legacy support)
    """
    bins = []

    for b in StorageBin.objects.prefetch_related("stocks"):
        stock = b.stocks.first()

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
        "warehouse": "DEFAULT",
        "bins": bins
    })


from django.http import JsonResponse
from .models import StorageBin

def warehouse_bins(request):
    code = request.GET.get("warehouse")
    print("WAREHOUSE CODE:", code)

    wh = Warehouse.objects.get(code=code)
    bins = StorageBin.objects.filter(warehouse=wh)

    print("BIN COUNT:", bins.count())

from django.http import JsonResponse
from django.db.models import Sum
from .models import StorageBin, BinStock

def warehouse_bins_api(request, warehouse_code):
    bins = (
        StorageBin.objects
        .filter(warehouse__code=warehouse_code)
        .prefetch_related("stocks")
    )

    data = []

    for b in bins:
        stocks = b.stocks.all()

        total_qty = sum(s.quantity for s in stocks)
        total_hits = sum(s.hit_count for s in stocks)

        abc = "C"
        if stocks:
            abc = max(
                stocks,
                key=lambda s: {"A": 3, "B": 2, "C": 1}[s.abc_class]
            ).abc_class

        data.append({
            # Identity
            "bin_code": b.bin_code,
            "warehouse": b.warehouse.code if b.warehouse else None,

            # Layout
            "row": b.row,
            "shelf": b.shelf,
            "level": b.level,

            # Geometry
            "x": b.x,
            "y": b.y,
            "z": b.z,
            "width": b.width,
            "height": b.height,
            "depth": b.depth,

            # Zone
            "zone": b.zone,

            # Metrics
            "qty": total_qty,
            "hits": total_hits,
            "abc": abc,
            "occupied": total_qty > 0,
        })

    return JsonResponse(data, safe=False)



from django.views.decorators.csrf import csrf_exempt
import json

@csrf_exempt
def update_bin_position(request):
    data = json.loads(request.body)

    bin = StorageBin.objects.get(bin_code=data["bin_code"])
    bin.zone = data.get("zone")
    bin.x = data.get("x", bin.x)
    bin.z = data.get("z", bin.z)
    bin.save(update_fields=["zone", "x", "z"])

    return JsonResponse({"status": "ok"})

from django.db.models import Sum, Count
from django.views.decorators.http import require_GET

@require_GET
def warehouse_bins_3js(request):
    warehouse_code = request.GET.get("warehouse")

    bins = (
        StorageBin.objects
        .filter(warehouse__code__iexact=warehouse_code)
        .prefetch_related("stocks__product")
    )

    payload = {
        "warehouse": warehouse_code,
        "total_bins": bins.count(),
        "bins": []
    }

    for b in bins:
        stocks = b.stocks.all()

        total_qty = 0
        hits = 0
        abc = "C"

        products = []

        for s in stocks:
            total_qty += s.quantity
            hits += s.hit_count
            abc = s.abc_class or abc

            if s.product:
                products.append({
                    "sku": s.product.sku,
                    "name": s.product.name,
                    "qty": s.quantity,
                })

        payload["bins"].append({
            "bin_code": b.bin_code,

            # geometry (unchanged)
            "x": b.x,
            "y": b.y,
            "z": b.z,
            "width": b.width,
            "height": b.height,
            "depth": b.depth,

            # logical
            "row": b.row,
            "shelf": b.shelf,
            "level": b.level,
            "zone": b.zone,

            # metrics
            "product_count": len(products),
            "qty": total_qty,
            "hits": hits,
            "abc": abc,
            "occupied": total_qty > 0,

            # UI
            "products": products
        })

    return JsonResponse(payload)



# ************************************************

from django.shortcuts import render, redirect
from .forms import StorageBinForm
from .models import StorageBin

def create_bin(request):
    if request.method == "POST":
        form = StorageBinForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("bin_list")
    else:
        form = StorageBinForm()

    return render(request, "api/create_bin.html", {"form": form})


def bin_list(request):
    bins = StorageBin.objects.select_related("warehouse").all()
    return render(request, "api/bin_list.html", {"bins": bins})



from django.http import JsonResponse
from django.db.models import Sum, Max
from .models import StorageBin, WarehouseConfig

def warehouse_heatmap_api(request):
    bins_qs = (
        StorageBin.objects
        .select_related("warehouse")
        .prefetch_related("stocks")
    )

    bins = []
    for b in bins_qs:
        stock = b.stocks.first()

        bins.append({
            "bin_code": b.bin_code,
            "row": b.row,
            "shelf": b.shelf,
            "level": b.level,
            "abc": stock.abc_class if stock else "C",
            "hits": stock.hit_count if stock else 0,
            "qty": stock.quantity if stock else 0,
            "occupied": bool(stock),
            "zone": b.zone,
        })

    cfg = WarehouseConfig.objects.first()

    return JsonResponse({
        "config": {
            "rows": cfg.rows,
            "racks_per_row": cfg.racks_per_row,
            "max_levels": cfg.max_levels,
            "rack_type": cfg.rack_type,
        },
        "bins": bins,
    })



from django.shortcuts import render
from django.http import HttpResponse
from rest_framework.test import APIRequestFactory


def upload_excel_page(request):
    if request.method == "POST":
        file = request.FILES.get("file")
        if not file:
            return HttpResponse("No file selected", status=400)

        # 🔑 Call APIView correctly
        factory = APIRequestFactory()
        api_request = factory.post(
            "/api/bins/upload-excel/",
            {"file": file},
            format="multipart"
        )

        response = BinExcelUpload.as_view()(api_request)

        if response.status_code != 200:
            return HttpResponse(
                f"Upload failed: {response.data}",
                status=response.status_code
            )

        return HttpResponse("Excel uploaded successfully")

    return render(request, "upload_excel.html")


import pandas as pd
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from api.models import Warehouse, StorageBin


def safe_val(row, key, default=None):
    """
    Safely read Excel cell values.
    Handles NaN / missing columns gracefully.
    """
    try:
        value = row.get(key)
        if pd.isna(value):
            return default
        return value
    except Exception:
        return default

import pandas as pd
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from api.models import Warehouse, StorageBin


def norm(v):
    if pd.isna(v):
        return ""
    return str(v).strip().upper()


class BinExcelUpload(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        if "file" not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)

        df = pd.read_excel(request.FILES["file"], sheet_name="Bins")

        required = {"warehouse_code", "bin_code", "row", "shelf", "level"}
        missing = required - set(df.columns)
        if missing:
            return Response(
                {"error": f"Missing columns: {', '.join(missing)}"},
                status=400,
            )

        created = 0
        errors = []

        for idx, r in df.iterrows():
            try:
                wh_code = norm(r["warehouse_code"])
                bin_code = norm(r["bin_code"])

                wh, _ = Warehouse.objects.get_or_create(
                    code=wh_code,
                    defaults={"name": wh_code},
                )

                StorageBin.objects.update_or_create(
                    warehouse=wh,
                    bin_code=bin_code,
                    defaults={
                        "row": int(r["row"]),
                        "shelf": int(r["shelf"]),
                        "level": int(r["level"]),
                        "x": float(r.get("x", 0)),
                        "y": float(r.get("y", 0)),
                        "z": float(r.get("z", 0)),
                        "width": float(r.get("width", 1.2)),
                        "height": float(r.get("height", 0.7)),
                        "depth": float(r.get("depth", 1.2)),
                        "zone": norm(r.get("zone")) or None,
                    },
                )
                created += 1
            except Exception as e:
                errors.append({"row": idx + 2, "error": str(e)})

        return Response({
            "status": "Bins uploaded",
            "created": created,
            "errors": errors,
        })


from .models import Product, BinStock


class BinStockExcelUpload(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        df = pd.read_excel(request.FILES["file"], sheet_name="BinStock")

        required = {"warehouse_code", "bin_code", "product_sku"}
        missing = required - set(df.columns)
        if missing:
            return Response(
                {"error": f"Missing columns: {', '.join(missing)}"},
                status=400,
            )

        created = 0
        skipped = 0
        errors = []

        for idx, r in df.iterrows():
            try:
                wh = Warehouse.objects.get(code=norm(r["warehouse_code"]))
                bin_obj = StorageBin.objects.get(
                    warehouse=wh,
                    bin_code=norm(r["bin_code"]),
                )

                product, _ = Product.objects.get_or_create(
                    sku=norm(r["product_sku"]),
                    defaults={"name": norm(r.get("product_name"))},
                )

                BinStock.objects.update_or_create(
                    bin=bin_obj,
                    product=product,
                    batch=norm(r.get("batch")) or None,
                    defaults={
                        "expiry_date": r.get("expiry_date"),
                        "quantity": float(r.get("quantity", 0)),
                        "uom": norm(r.get("uom")) or "EA",
                        "abc_class": norm(r.get("abc_class")) or "C",
                        "hit_count": int(r.get("hit_count", 0)),
                    },
                )
                created += 1

            except Exception as e:
                skipped += 1
                errors.append({"row": idx + 2, "error": str(e)})

        return Response({
            "created": created,
            "skipped": skipped,
            "errors": errors,
        })




def serialize_bin(bin):
    stocks = bin.stocks.all()

    total_qty = sum(s.quantity for s in stocks)
    total_hits = sum(s.hit_count for s in stocks)

    abc = (
        "A" if any(s.abc_class == "A" for s in stocks)
        else "B" if any(s.abc_class == "B" for s in stocks)
        else "C"
    )

    return {
        "bin_code": bin.bin_code,
        "row": bin.row,
        "shelf": bin.shelf,
        "level": bin.level,
        "x": bin.x,
        "y": bin.y,
        "z": bin.z,
        "width": bin.width,
        "height": bin.height,
        "depth": bin.depth,
        "zone": bin.zone,
        "abc": abc,
        "hits": total_hits,
        "qty": total_qty,
        "occupied": total_qty > 0,
        "products": [
            {
                "sku": s.product.sku,
                "name": s.product.name,
                "batch": s.batch,
                "expiry": s.expiry_date,
                "quantity": s.quantity,
            }
            for s in stocks
        ],
    }

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer

from api.models import (
    Warehouse,
    WarehouseConfig,
    StorageBin,
)

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer

from api.models import (
    Warehouse,
    WarehouseConfig,
    StorageBin,
)


class WarehouseHeatmapAPI(APIView):
    renderer_classes = [JSONRenderer]

    def get(self, request):
        # 🔑 Pick warehouse by code
        warehouse_code = request.GET.get("warehouse", "WH1")

        try:
            wh = Warehouse.objects.get(code__iexact=warehouse_code)
        except Warehouse.DoesNotExist:
            return Response({"config": {}, "bins": []})

        # Ensure warehouse config exists
        config, _ = WarehouseConfig.objects.get_or_create(
            warehouse=wh,
            defaults={
                "rows": 6,
                "racks_per_row": 8,
                "max_levels": 4,
                "rack_type": "pallet",
                "rack_width": 4.0,
                "rack_depth": 2.0,
                "shelf_gap": 2.0,
            }
        )

        # Fetch bins + products
        bins_qs = (
            StorageBin.objects
            .filter(warehouse=wh)
            .prefetch_related("stocks__product")
        )

        bins_payload = []

        for b in bins_qs:
            stocks = list(b.stocks.all())

            total_qty = sum(s.quantity for s in stocks)
            total_hits = sum(s.hit_count for s in stocks)

            # Prefer stock ABC, fallback to bin ABC
            abc = (
                "A" if any(s.abc_class == "A" for s in stocks)
                else "B" if any(s.abc_class == "B" for s in stocks)
                else "C"
            )

            products_payload = [
                {
                    "sku": s.product.sku,
                    "name": s.product.name,
                    "batch": s.batch,
                    "expiry": s.expiry_date.isoformat() if s.expiry_date else None,
                    "quantity": s.quantity,
                    "image": s.product.image_url,
                }
                for s in stocks if s.product
            ]

            bins_payload.append({
                "bin_code": b.bin_code,
                "row": b.row,
                "shelf": b.shelf,
                "level": b.level,
                "x": b.x,
                "y": b.y,
                "z": b.z,
                "width": b.width,
                "height": b.height,
                "depth": b.depth,
                "zone": b.zone,
                "abc": abc,
                "hits": total_hits,
                "qty": total_qty,
                "occupied": total_qty > 0,
                "products": products_payload,
            })

        return Response({
            "config": {
                "rows": config.rows,
                "racks_per_row": config.racks_per_row,
                "max_levels": config.max_levels,
                "rack_type": config.rack_type,
            },
            "bins": bins_payload,
        })


# product

class ProductListView(View):
    def get(self, request):
        products = Product.objects.all().order_by("sku")
        return render(request, "products/product_list.html", {
            "products": products
        })

class ProductCreateView(View):
    def get(self, request):
        return render(request, "products/product_create.html")

    def post(self, request):
        sku = request.POST.get("sku")
        name = request.POST.get("name")
        image = request.POST.get("image_url")

        if not sku or not name:
            messages.error(request, "SKU and Name are required")
            return redirect("product-create")

        Product.objects.get_or_create(
            sku=sku.strip().upper(),
            defaults={
                "name": name.strip(),
                "image_url": image
            }
        )

        messages.success(request, "Product created successfully")
        return redirect("product-list")

class AssignProductToBinView(View):
    def get(self, request):
        bins = StorageBin.objects.select_related("warehouse").all()
        products = Product.objects.all()

        return render(request, "products/assign_product.html", {
            "bins": bins,
            "products": products,
        })

    def post(self, request):
        bin_id = request.POST.get("bin_id")
        product_id = request.POST.get("product_id")
        quantity = request.POST.get("quantity", 0)
        abc = request.POST.get("abc_class", "C")
        hits = request.POST.get("hit_count", 0)

        bin_obj = StorageBin.objects.get(id=bin_id)
        product = Product.objects.get(id=product_id)

        BinStock.objects.update_or_create(
            bin=bin_obj,
            product=product,
            defaults={
                "quantity": quantity,
                "abc_class": abc,
                "hit_count": hits,
            }
        )

        messages.success(
            request,
            f"Product {product.sku} assigned to bin {bin_obj.bin_code}"
        )

        return redirect("product-assign")
import pandas as pd
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework import status

from api.models import Warehouse, StorageBin, Product, BinStock



from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
import pandas as pd

from api.models import Warehouse, StorageBin, Product, BinStock


def norm(v):
    if pd.isna(v):
        return ""
    return str(v).strip().upper()


@method_decorator(csrf_exempt, name="dispatch")
class BinProductBulkExcelUpload(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        if "file" not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)

        df = pd.read_excel(request.FILES["file"], sheet_name="BinProduct")

        required = {
            "warehouse_code",
            "bin_code",
            "product_sku",
            "quantity",
        }
        missing = required - set(df.columns)
        if missing:
            return Response(
                {
                    "error": "Missing columns",
                    "missing": list(missing),
                    "found": list(df.columns),
                },
                status=400,
            )

        created = 0
        errors = []

        for idx, r in df.iterrows():
            try:
                warehouse_code = norm(r["warehouse_code"])
                bin_code = norm(r["bin_code"])
                sku = norm(r["product_sku"])

                if not warehouse_code or not bin_code or not sku:
                    raise ValueError("warehouse_code / bin_code / sku empty")

                wh = Warehouse.objects.get(code__iexact=warehouse_code)

                bin_obj = StorageBin.objects.get(
                    warehouse=wh,
                    bin_code__iexact=bin_code,
                )

                product, _ = Product.objects.get_or_create(
                    sku=sku,
                    defaults={
                        "name": norm(r.get("product_name")) or sku
                    },
                )

                BinStock.objects.update_or_create(
                    bin=bin_obj,
                    product=product,
                    batch=norm(r.get("odo_number")) or None,
                    defaults={
                        "quantity": float(r.get("quantity", 0)),
                        "uom": norm(r.get("uom")) or "EA",
                        "abc_class": norm(r.get("abc_class")) or "C",
                        "hit_count": int(r.get("hit_count", 0)),
                    },
                )

                created += 1

            except Exception as e:
                errors.append({
                    "row": idx + 2,
                    "warehouse_code": r.get("warehouse_code"),
                    "bin_code": r.get("bin_code"),
                    "error": str(e),
                })

        return Response({
            "created": created,
            "errors": errors,
        })

from django.shortcuts import render
from django.views import View

class ProductBulkUploadPage(View):
    def get(self, request):
        return render(request, "products/product_bulk_upload.html")

from django.shortcuts import render
from django.http import HttpResponse
from rest_framework.test import APIRequestFactory
from .views import BinProductBulkExcelUpload  # your APIView

def product_bulk_upload_ui(request):
    if request.method == "POST":
        file = request.FILES.get("file")

        if not file:
            return render(request, "products/bulk_upload.html", {
                "error": "No file selected"
            })

        factory = APIRequestFactory()
        api_request = factory.post(
            "/api/products/bulk-upload/",
            {"file": file},
            format="multipart"
        )

        response = BinProductBulkExcelUpload.as_view()(api_request)

        if response.status_code != 200:
            return render(request, "products/bulk_upload.html", {
                "error": response.data
            })

        return render(request, "products/bulk_upload.html", {
            "message": f"Upload successful. Rows processed: {response.data.get('created')}"
        })

    return render(request, "products/bulk_upload.html")


import pandas as pd
from django.db import transaction
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from api.models import (
    Warehouse,
    StorageBin,
    Product,
    BinStock,
)

def norm(v):
    if pd.isna(v):
        return ""
    return str(v).strip().upper()

class CombinedBinProductExcelUpload(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        if "file" not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)

        try:
            bins_df = pd.read_excel(request.FILES["file"], sheet_name="Bins")
            prod_df = pd.read_excel(request.FILES["file"], sheet_name="BinProduct")
        except Exception as e:
            return Response(
                {"error": f"Excel read failed: {str(e)}"},
                status=400,
            )

        created_bins = 0
        created_products = 0
        assigned_products = 0
        errors = []

        # 🔐 ATOMIC TRANSACTION
        with transaction.atomic():
            # =========================
            # 1️⃣ CREATE / UPDATE BINS
            # =========================
            for idx, r in bins_df.iterrows():
                try:
                    wh_code = norm(r["warehouse_code"])
                    bin_code = norm(r["bin_code"])

                    wh, _ = Warehouse.objects.get_or_create(
                        code=wh_code,
                        defaults={"name": wh_code},
                    )

                    StorageBin.objects.update_or_create(
                        warehouse=wh,
                        bin_code=bin_code,
                        defaults={
                            "row": int(r["row"]),
                            "shelf": int(r["shelf"]),
                            "level": int(r["level"]),
                            "x": float(r.get("x", 0)),
                            "y": float(r.get("y", 0)),
                            "z": float(r.get("z", 0)),
                            "width": float(r.get("width", 1.2)),
                            "height": float(r.get("height", 0.7)),
                            "depth": float(r.get("depth", 1.2)),
                        },
                    )
                    created_bins += 1
                except Exception as e:
                    errors.append({
                        "sheet": "Bins",
                        "row": idx + 2,
                        "error": str(e),
                    })

            # =========================
            # 2️⃣ CREATE PRODUCTS + ASSIGN TO BINS
            # =========================
            for idx, r in prod_df.iterrows():
                try:
                    wh = Warehouse.objects.get(code__iexact=norm(r["warehouse_code"]))

                    bin_obj = StorageBin.objects.get(
                        warehouse=wh,
                        bin_code__iexact=norm(r["bin_code"]),
                    )

                    product, _ = Product.objects.get_or_create(
                        sku=norm(r["product_sku"]),
                        defaults={
                            "name": norm(r.get("product_name")) or norm(r["product_sku"])
                        },
                    )
                    created_products += 1

                    BinStock.objects.update_or_create(
                        bin=bin_obj,
                        product=product,
                        batch=norm(r.get("odo_number")) or None,
                        defaults={
                            "quantity": float(r.get("quantity", 0)),
                            "uom": norm(r.get("uom")) or "EA",
                            "abc_class": norm(r.get("abc_class")) or "C",
                            "hit_count": int(r.get("hit_count", 0)),
                        },
                    )
                    assigned_products += 1

                except Exception as e:
                    errors.append({
                        "sheet": "BinProduct",
                        "row": idx + 2,
                        "error": str(e),
                    })

            # ❌ If any error → rollback everything
            if errors:
                raise Exception("Upload failed, transaction rolled back")

        return Response({
            "status": "success",
            "bins_created": created_bins,
            "products_created": created_products,
            "products_assigned": assigned_products,
            "errors": errors,
        })

import pandas as pd
from django.shortcuts import render, redirect
from django.contrib import messages
from django.db import transaction

from .models import Warehouse, StorageBin, Product, BinStock


def norm(v):
    if pd.isna(v):
        return ""
    return str(v).strip().upper()


def upload_combined_excel(request):
    if request.method == "POST":
        file = request.FILES.get("file")

        if not file:
            messages.error(request, "No file selected")
            return redirect("upload-combined-excel")

        try:
            bins_df = pd.read_excel(file, sheet_name="Bins")
            prod_df = pd.read_excel(file, sheet_name="BinProduct")
        except Exception as e:
            messages.error(request, f"Excel read failed: {e}")
            return redirect("upload-combined-excel")

        created_bins = 0
        assigned_products = 0

        try:
            with transaction.atomic():

                # =========================
                # 1️⃣ CREATE / UPDATE BINS
                # =========================
                for _, r in bins_df.iterrows():
                    wh_code = norm(r["warehouse_code"])
                    bin_code = norm(r["bin_code"])

                    wh, _ = Warehouse.objects.get_or_create(
                        code=wh_code,
                        defaults={"name": wh_code},
                    )

                    StorageBin.objects.update_or_create(
                        warehouse=wh,
                        bin_code=bin_code,
                        defaults={
                            "row": int(r["row"]),
                            "shelf": int(r["shelf"]),
                            "level": int(r["level"]),
                            "x": float(r.get("x", 0)),
                            "y": float(r.get("y", 0)),
                            "z": float(r.get("z", 0)),
                            "width": float(r.get("width", 1.2)),
                            "height": float(r.get("height", 0.7)),
                            "depth": float(r.get("depth", 1.2)),
                        },
                    )
                    created_bins += 1

                # =========================
                # 2️⃣ CREATE PRODUCTS + ASSIGN TO BINS
                # =========================
                for _, r in prod_df.iterrows():
                    wh = Warehouse.objects.get(code__iexact=norm(r["warehouse_code"]))

                    bin_obj = StorageBin.objects.get(
                        warehouse=wh,
                        bin_code__iexact=norm(r["bin_code"]),
                    )

                    product, _ = Product.objects.get_or_create(
                        sku=norm(r["product_sku"]),
                        defaults={
                            "name": norm(r.get("product_name")) or norm(r["product_sku"])
                        },
                    )

                    BinStock.objects.update_or_create(
                        bin=bin_obj,
                        product=product,
                        defaults={
                            "quantity": float(r.get("quantity", 0)),
                            "uom": norm(r.get("uom")) or "EA",
                            "abc_class": norm(r.get("abc_class")) or "C",
                            "hit_count": int(r.get("hit_count", 0)),
                        },
                    )
                    assigned_products += 1

        except Exception as e:
            messages.error(request, f"Upload failed: {e}")
            return redirect("upload-combined-excel")

        messages.success(
            request,
            f"Upload successful! Bins: {created_bins}, Products assigned: {assigned_products}"
        )
        return redirect("upload-combined-excel")

    return render(request, "upload_combined_excel.html")


# graph data
import pandas as pd
from django.shortcuts import render
from .forms import PickingHeatmapUploadForm


def picking_heatmap_dashboard(request):
    """
    Picking Analytics Dashboard
    - Upload Excel
    - Filters: Date range + AUoM
    - Charts: Bar, Line, Pie
    """

    chart_data = {}
    df = None

    # ----------------------------
    # Upload
    # ----------------------------
    if request.method == "POST":
        form = PickingHeatmapUploadForm(request.POST, request.FILES)
        if form.is_valid():
            instance = form.save()
            df = pd.read_excel(instance.file.path)
    else:
        form = PickingHeatmapUploadForm()

    # ----------------------------
    # If file already uploaded earlier
    # (optional enhancement later: session-based)
    # ----------------------------
    if df is not None:

        # Normalize column names
        df.columns = df.columns.str.strip().str.lower()

        required_cols = {"auom", "confirmed qty", "confirm date"}
        if not required_cols.issubset(df.columns):
            raise ValueError(f"Excel must contain columns: {required_cols}")

        # Clean data
        df["auom"] = df["auom"].str.upper()
        df = df[df["auom"].isin(["PAL", "CTN", "EA"])]

        df["confirm date"] = pd.to_datetime(df["confirm date"], errors="coerce")
        df = df.dropna(subset=["confirm date"])

        # ----------------------------
        # Filters (GET)
        # ----------------------------
        from_date = request.GET.get("from_date")
        to_date = request.GET.get("to_date")
        auom_filter = request.GET.get("auom")

        if from_date:
            df = df[df["confirm date"] >= pd.to_datetime(from_date)]

        if to_date:
            df = df[df["confirm date"] <= pd.to_datetime(to_date)]

        if auom_filter:
            df = df[df["auom"] == auom_filter]

        if not df.empty:
            df["date"] = df["confirm date"].dt.strftime("%d-%m-%Y")

            # Aggregate
            grouped = (
                df.groupby(["date", "auom"])["confirmed qty"]
                .sum()
                .unstack(fill_value=0)
                .reset_index()
            )

            for col in ["PAL", "CTN", "EA"]:
                if col not in grouped.columns:
                    grouped[col] = 0

            labels = grouped["date"].tolist()
            pal = grouped["PAL"].tolist()
            ct = grouped["CTN"].tolist()
            ea = grouped["EA"].tolist()

            chart_data = {
                "labels": labels,
                "pal": pal,
                "ct": ct,
                "ea": ea,
                "pie": {
                    "PAL": sum(pal),
                    "CTN": sum(ct),
                    "EA": sum(ea),
                },
            }

    return render(
        request,
        "api/picking_heatmap.html",
        {
            "form": form,
            "chart_data": chart_data,
        },
    )

import pandas as pd
from django.shortcuts import render
from django import forms
from .models import ReplenishmentUpload




# ----------------------------
# Replenishment Dashboard
# ----------------------------
import pandas as pd
from django.shortcuts import render
from .models import ReplenishmentUpload
from django import forms


# ----------------------------
# Upload Form
# ----------------------------
class ReplenishmentUploadForm(forms.ModelForm):
    class Meta:
        model = ReplenishmentUpload
        fields = ["file"]


def replenishment_dashboard(request):
    """
    Replenishment Dashboard
    - Works with REPL transaction Excel
    - No strict column dependency
    """

    chart_data = {}
    kpi = {}
    df = None

    # ----------------------------
    # Upload
    # ----------------------------
    if request.method == "POST":
        form = ReplenishmentUploadForm(request.POST, request.FILES)
        if form.is_valid():
            instance = form.save()
            df = pd.read_excel(instance.file.path)
    else:
        form = ReplenishmentUploadForm()

    if df is not None:

        # ----------------------------
        # Normalize column names
        # ----------------------------
        df.columns = (
            df.columns
              .str.strip()
              .str.lower()
              .str.replace(" ", "_")
        )

        # ----------------------------
        # REQUIRED COLUMNS CHECK
        # ----------------------------
        REQUIRED = {"product", "confirmed_qty", "src_bin", "dsbin"}

        missing = REQUIRED - set(df.columns)
        if missing:
            raise ValueError(
                f"Excel missing required columns: {missing}. "
                f"Found columns: {df.columns.tolist()}"
            )

        # ----------------------------
        # Standardize Columns
        # ----------------------------
        df = df.rename(columns={
            "product": "sku",
            "confirmed_qty": "current_qty",
            "src_bin": "source_bin",
            "dsbin": "dest_bin",
        })

        # Ensure numeric
        df["current_qty"] = pd.to_numeric(df["current_qty"], errors="coerce").fillna(0)

        # ----------------------------
        # DERIVED INVENTORY RULES
        # ----------------------------
        df["min_qty"] = 50          # business rule
        df["reorder_qty"] = 100     # business rule

        # ----------------------------
        # Replenishment Status
        # ----------------------------
        df["status"] = "OK"

        df.loc[df["current_qty"] <= df["min_qty"], "status"] = "CRITICAL"
        df.loc[
            (df["current_qty"] > df["min_qty"]) &
            (df["current_qty"] <= df["reorder_qty"]),
            "status"
        ] = "WARNING"

        # ----------------------------
        # KPIs
        # ----------------------------
        kpi = {
            "critical": int((df["status"] == "CRITICAL").sum()),
            "warning": int((df["status"] == "WARNING").sum()),
            "ok": int((df["status"] == "OK").sum()),
            "total_moves": int(len(df)),
        }

        # ----------------------------
        # Bar Chart – Top Critical
        # ----------------------------
        critical_df = df[df["status"] == "CRITICAL"].head(10)

        chart_data["bar"] = {
            "labels": critical_df["sku"].astype(str).tolist(),
            "current": critical_df["current_qty"].tolist(),
            "reorder": critical_df["reorder_qty"].tolist(),
        }

        # ----------------------------
        # Pie Chart
        # ----------------------------
        chart_data["pie"] = {
            "Critical": kpi["critical"],
            "Warning": kpi["warning"],
            "OK": kpi["ok"],
        }

    return render(
        request,
        "api/replenishment_dashboard.html",
        {
            "form": form,
            "chart_data": chart_data,
            "kpi": kpi,
        },
    )
