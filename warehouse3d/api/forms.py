from django import forms
from .models import WarehouseConfig

class WarehouseConfigForm(forms.ModelForm):
    class Meta:
        model = WarehouseConfig
        fields = [
            'rows', 'racks_per_row', 'max_levels',
            'rack_type', 'rack_width', 'rack_depth', 'shelf_gap',
            'bin_width', 'bin_height', 'bin_depth'
        ]


from django import forms
from .models import StorageBin

class StorageBinForm(forms.ModelForm):
    class Meta:
        model = StorageBin
        fields = [
            "warehouse",
            "bin_code",
            "row",
            "shelf",
            "level",
            "x",
            "y",
            "z",
            "zone",
        ]

        widgets = {
            "warehouse": forms.Select(attrs={"class": "form-control"}),
            "bin_code": forms.TextInput(attrs={"class": "form-control"}),
            "row": forms.NumberInput(attrs={"class": "form-control"}),
            "shelf": forms.NumberInput(attrs={"class": "form-control"}),
            "level": forms.NumberInput(attrs={"class": "form-control"}),
            "x": forms.NumberInput(attrs={"class": "form-control"}),
            "y": forms.NumberInput(attrs={"class": "form-control"}),
            "z": forms.NumberInput(attrs={"class": "form-control"}),
            "zone": forms.TextInput(attrs={"class": "form-control"}),
        }
       


from django import forms
from .models import PickingHeatmap

class PickingHeatmapUploadForm(forms.ModelForm):
    class Meta:
        model = PickingHeatmap
        fields = ["file"]

    def clean_file(self):
        file = self.cleaned_data["file"]
        if not file.name.endswith((".xlsx", ".xls")):
            raise forms.ValidationError("Upload only Excel files")
        return file

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