
# api/urls.py
from django import views
from django.urls import path
from django.shortcuts import render
from .views import  *
from .views import bin_heatmap_api



urlpatterns = [
    path("viewer/", viewer, name="viewer"),
    path("api/config/", warehouse_config_api, name="api_config"),
    path("warehouse/heatmap/", warehouse_heatmap),
    path("bin-heatmap/", bin_heatmap_api),
    path("warehouse/3d-snapshot/", warehouse_3d_snapshot),
    path("warehouse/config/", warehouse_config_api),
    path("settings/", warehouse_settings),
    path("api/warehouse-bins/", warehouse_bins_3js),
    path("bins/update-position/", update_bin_position, name="update_bin_position"),
    path("bins/create/", create_bin, name="create_bin"),
    path("bins/", bin_list, name="bin_list"),
    path("bins/upload-excel/", BinExcelUpload.as_view()),
    path("warehouse-heatmap-api/", WarehouseHeatmapAPI.as_view()),
    path("bins/upload-ui/", upload_excel_page),
    path("products/", ProductListView.as_view(), name="product-list"),
    path("products/create/", ProductCreateView.as_view(), name="product-create"),
    path("products/assign/", AssignProductToBinView.as_view(), name="product-assign"),
    path("viewer-2", viewer_2, name="viewer_2"),
    path("viewer-3", viewer_3, name="viewer_3"),
    path("products/bulk-upload-ui/", ProductBulkUploadPage.as_view()),
    path("products/bulk-upload-ui/", product_bulk_upload_ui),
    path("products/bulk-upload/", BinProductBulkExcelUpload.as_view()),
    path("upload/combined-excel/",upload_combined_excel,name="upload-combined-excel"),
    # Bars, pie, line charts
    path("picking-heatmap/", picking_heatmap_dashboard, name="picking-heatmap"),
    path("replenishment-data/", replenishment_dashboard, name="replenishment-data"),

    

]