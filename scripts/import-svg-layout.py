"""Extract v3 static artwork; text, frames and animated ornaments remain live components."""
import copy
import pathlib
import sys
import xml.etree.ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)
source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\Affinity\STREAMUI_v2_21-9.svg")
output = pathlib.Path(__file__).resolve().parent.parent / "public" / "stage"
output.mkdir(parents=True, exist_ok=True)
root = ET.parse(source).getroot()
theme = next(e for e in root if e.get("id") == "左侧-themebar")

# All text, barcodes and ornaments are live components. Keep only the background.
art = ET.Element(f"{{{SVG}}}g", dict(theme.attrib))
for index, child in enumerate(theme):
    if index == 0:
        art.append(copy.deepcopy(child))
for rectangle in art.iter(f"{{{SVG}}}rect"):
    rectangle.set('style', 'fill:#40009e;')
header = ET.Element(f"{{{SVG}}}svg", {"viewBox": "0 0 2265.558 276.2784", "preserveAspectRatio": "none"})
header.append(art)
ET.ElementTree(header).write(output / "themebar.svg", encoding="utf-8", xml_declaration=True)

backdrop = ET.Element(f"{{{SVG}}}svg", {"viewBox": "0 0 3840 2160", "preserveAspectRatio": "none"})
ET.SubElement(backdrop, f"{{{SVG}}}rect", {"width": "3840", "height": "2160", "fill": "black"})
ET.ElementTree(backdrop).write(output / "backdrop.svg", encoding="utf-8", xml_declaration=True)
print("Extracted v3 purple header background; barcode and ornaments remain live.")
