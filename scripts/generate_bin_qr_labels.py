from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def build_bins(total=50):
    bins = []
    for index in range(1, total + 1):
        label = f"BIN-{index:03d}"
        bins.append({"label": label, "qr": f"QR:{label}"})
    return bins


def draw_qr(c, value, x, y, size):
    widget = qr.QrCodeWidget(value)
    x1, y1, x2, y2 = widget.getBounds()
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, c, x, y)


def generate_pdf(out_path, bins):
    page_w, page_h = A4
    margin_x = 10 * mm
    margin_y = 10 * mm
    cols = 5
    rows = 5
    cell_w = (page_w - margin_x * 2) / cols
    cell_h = (page_h - margin_y * 2) / rows

    c = canvas.Canvas(str(out_path), pagesize=A4)
    c.setAuthor("Codex")
    c.setTitle("Green Lab BIN QR labels")

    border_color = HexColor("#B7C9C2")
    title_color = HexColor("#0F2F25")
    payload_color = HexColor("#5A6D67")

    cells_per_page = cols * rows
    for idx, item in enumerate(bins):
        page_index = idx % cells_per_page
        if idx > 0 and page_index == 0:
            c.showPage()

        row = page_index // cols
        col = page_index % cols
        x = margin_x + col * cell_w
        y = page_h - margin_y - (row + 1) * cell_h

        c.setStrokeColor(border_color)
        c.setLineWidth(0.6)
        c.roundRect(x + 1.5 * mm, y + 1.5 * mm, cell_w - 3 * mm, cell_h - 3 * mm, 3 * mm, stroke=1, fill=0)

        c.setFillColor(title_color)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(x + cell_w / 2, y + cell_h - 6.8 * mm, item["label"])

        qr_size = min(cell_w - 12 * mm, cell_h - 20 * mm)
        qr_x = x + (cell_w - qr_size) / 2
        qr_y = y + 8.6 * mm
        draw_qr(c, item["qr"], qr_x, qr_y, qr_size)

        c.setFillColor(payload_color)
        c.setFont("Helvetica", 7.5)
        c.drawCentredString(x + cell_w / 2, y + 4.8 * mm, item["qr"])

    c.save()


def main():
    workspace = Path(__file__).resolve().parents[1]
    output_dir = workspace / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    out_pdf = output_dir / "bin-qr-labels-001-050.pdf"

    bins = build_bins(50)
    generate_pdf(out_pdf, bins)
    print(str(out_pdf))


if __name__ == "__main__":
    main()
