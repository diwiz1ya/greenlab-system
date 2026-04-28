from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


def pick_font():
    candidates = [
        (r"C:/Windows/Fonts/arial.ttf", r"C:/Windows/Fonts/arialbd.ttf", "GLArial"),
        (r"C:/Windows/Fonts/segoeui.ttf", r"C:/Windows/Fonts/segoeuib.ttf", "GLSegoe"),
        (r"C:/Windows/Fonts/calibri.ttf", r"C:/Windows/Fonts/calibrib.ttf", "GLCalibri"),
        (r"C:/Windows/Fonts/tahoma.ttf", r"C:/Windows/Fonts/tahomabd.ttf", "GLTahoma"),
    ]
    for regular, bold, family in candidates:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont(f"{family}-Regular", regular))
            pdfmetrics.registerFont(TTFont(f"{family}-Bold", bold))
            return f"{family}-Regular", f"{family}-Bold"
    return "Helvetica", "Helvetica-Bold"


regular_font, bold_font = pick_font()

out_path = Path(r"C:/Users/Kitkacx/Desktop/GreenLab_QR_Machines_Architecture_v1.pdf")
out_path.parent.mkdir(parents=True, exist_ok=True)

doc = SimpleDocTemplate(
    str(out_path),
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=14 * mm,
    bottomMargin=14 * mm,
    title="Green Lab - QR архитектура корзин и машин",
    author="Codex",
)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="GLTitle",
    parent=styles["Title"],
    fontName=bold_font,
    fontSize=18,
    leading=22,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#0E2D24"),
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="GLSub",
    parent=styles["Normal"],
    fontName=regular_font,
    fontSize=10,
    leading=13,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#4D5C57"),
    spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="GLH2",
    parent=styles["Heading2"],
    fontName=bold_font,
    fontSize=13,
    leading=16,
    textColor=colors.HexColor("#10362B"),
    spaceBefore=8,
    spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="GLBody",
    parent=styles["Normal"],
    fontName=regular_font,
    fontSize=10.5,
    leading=14,
    alignment=TA_LEFT,
    spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="GLBullet",
    parent=styles["Normal"],
    fontName=regular_font,
    fontSize=10.3,
    leading=13.5,
    leftIndent=10,
    bulletIndent=0,
    spaceAfter=2,
))

story = []

story.append(Paragraph("GREEN LAB: СХЕМА ВНЕДРЕНИЯ QR ДЛЯ КОРЗИН И МАШИН", styles["GLTitle"]))
story.append(Paragraph(
    f"Документ для заказчика · Версия v1 · Дата: {datetime.now().strftime('%d.%m.%Y')}",
    styles["GLSub"],
))

story.append(Paragraph("1. Цель решения", styles["GLH2"]))
story.append(Paragraph(
    "Внедрить управляемый поток вещей по станциям с полной трассировкой: от сортировки до выдачи, "
    "с контролем перемещений между корзинами и машинами, без потерь и без смешивания заказов.",
    styles["GLBody"],
))

story.append(Paragraph("2. Базовые принципы", styles["GLH2"]))
for item in [
    "Каждая физическая корзина имеет постоянный QR (наклейка один раз).",
    "Каждая стиральная и сушильная машина имеет постоянный QR (Machine ID).",
    "Ключевая сущность учета - партия загрузки (Load), а не сама машина и не только корзина.",
    "QC выполняется после сушки: sorting -> washing -> drying -> qc -> ironing -> pickup.",
    "Любая свободная корзина может стать приемной после выгрузки, если соблюдены правила безопасности.",
]:
    story.append(Paragraph(item, styles["GLBullet"], bulletText="-"))

story.append(Paragraph("3. Объекты системы", styles["GLH2"]))
objects_table = Table([
    ["Сущность", "Назначение", "Ключ"],
    ["Basket", "Физическая корзина с постоянным QR", "QR:BASKET-XXXX"],
    ["Machine", "Стиралка/сушка с постоянным QR", "QR:MACHINE-W01 ... D06"],
    ["Load", "Партия, запущенная в машине", "LOAD-ID (wash/dry)"],
    ["Order", "Клиентский заказ", "GL-XXXX"],
    ["Transfer", "Факт перекладки между корзинами", "TRANSFER-ID"],
], colWidths=[40 * mm, 95 * mm, 35 * mm])
objects_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DDEBE5")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F2F25")),
    ("FONTNAME", (0, 0), (-1, 0), bold_font),
    ("FONTNAME", (0, 1), (-1, -1), regular_font),
    ("FONTSIZE", (0, 0), (-1, -1), 9.5),
    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#B7C9C2")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
]))
story.append(objects_table)
story.append(Spacer(1, 5))

story.append(Paragraph("4. Целевой процесс по станциям", styles["GLH2"]))
for item in [
    "Сортировка: заказ разбивается на 1..N корзин, каждая корзина привязывается к order_id.",
    "Стирка: оператор сканирует QR машины и одну/несколько корзин, создается wash_load.",
    "Выгрузка из стирки: оператор закрывает wash_load, сканирует приемные корзины, фиксируется transfer.",
    "Сушка: оператор создает dry_load из приемных корзин после стирки.",
    "Выгрузка из сушки: снова допускается пересборка в любые свободные корзины с полным аудитом transfer.",
    "QC: проверка каждой корзины после сушки, решение OK/HOLD/Rework.",
    "Далее: глажка -> выдача, с обязательным сканом всех корзин заказа на выдаче.",
]:
    story.append(Paragraph(item, styles["GLBullet"], bulletText="-"))

story.append(Paragraph("5. Как исключаем потери и путаницу", styles["GLH2"]))
for item in [
    "Запрет смешивания разных заказов в одной активной корзине.",
    "Запрет двойной загрузки: корзина и машина не могут одновременно участвовать в двух открытых Load.",
    "Обязательное закрытие Load перед переходом на следующую станцию.",
    "Любая перекладка вещей фиксируется как отдельный Transfer Event (кто, когда, откуда, куда).",
    "Scan-events журналируем в неизменяемый лог для аудита и разборов инцидентов.",
    "Система блокирует выдачу, пока не подтверждены все корзины заказа.",
]:
    story.append(Paragraph(item, styles["GLBullet"], bulletText="-"))

story.append(Paragraph("6. Скан-сценарии (операционный минимум)", styles["GLH2"]))
scenarios_table = Table([
    ["Сценарий", "Сканы", "Результат"],
    ["Запуск стирки", "Machine QR + Basket QR(1..N)", "Создан wash_load, машина занята"],
    ["Выгрузка стирки", "Load/Machine QR + Target Basket QR(1..N)", "Закрыт wash_load, создан transfer"],
    ["Запуск сушки", "Machine QR + Basket QR(1..N)", "Создан dry_load"],
    ["Выгрузка сушки", "Load/Machine QR + Target Basket QR(1..N)", "Корзины переходят в QC"],
    ["QC", "Basket QR", "Решение OK / HOLD / Rework"],
], colWidths=[44 * mm, 60 * mm, 66 * mm])
scenarios_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF3EF")),
    ("FONTNAME", (0, 0), (-1, 0), bold_font),
    ("FONTNAME", (0, 1), (-1, -1), regular_font),
    ("FONTSIZE", (0, 0), (-1, -1), 9.3),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#BDD0C8")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
]))
story.append(scenarios_table)

story.append(Paragraph("7. План внедрения без остановки работы", styles["GLH2"]))
for item in [
    "Этап 1 (1 неделя): справочник машин, QR-наклейки, сущности Load и Transfer на backend.",
    "Этап 2 (1-2 недели): UI для запуска/закрытия загрузок стирки и сушки, валидации блокировок.",
    "Этап 3 (1 неделя): расширение отчета менеджера (очереди машин, незакрытые load, SLA риски).",
    "Этап 4 (3-5 дней): пилот на 1 смене, затем включение для всех смен.",
    "Rollback: старый поток остается доступен флагом конфигурации до завершения пилота.",
]:
    story.append(Paragraph(item, styles["GLBullet"], bulletText="-"))

story.append(Paragraph("8. KPI и критерии приемки", styles["GLH2"]))
for item in [
    "0 инцидентов смешивания заказов в корзинах за 30 дней.",
    "100% корзин имеют сквозную историю scan/load/transfer.",
    "Снижение ручных уточнений по местонахождению заказа минимум на 60%.",
    "Сокращение времени поиска потерянной вещи до 1-3 минут через аудит лог.",
]:
    story.append(Paragraph(item, styles["GLBullet"], bulletText="-"))

story.append(Spacer(1, 6))
story.append(Paragraph(
    "Вывод: модель QR корзин + QR машин + сущность Load позволяет безопасно перекладывать вещи "
    "в любые свободные корзины после стирки/сушки и сохранять полный контроль над движением заказа.",
    styles["GLBody"],
))


def add_page_number(canvas, _doc):
    canvas.saveState()
    canvas.setFont(regular_font, 8.5)
    canvas.setFillColor(colors.HexColor("#51635E"))
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Страница {_doc.page}")
    canvas.restoreState()


doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
print(str(out_path))
