SAP_TO_METER = 0.01

def normalize_xyz(x, y, z):
    return (
        round(float(x) * SAP_TO_METER, 3),
        round(float(y) * SAP_TO_METER, 3),
        round(float(z) * SAP_TO_METER, 3),
    )
