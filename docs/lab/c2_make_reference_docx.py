"""Build docs/lab/c2_reference.docx: the Word style sheet for C2_SRS.docx.

Starts from pandoc's default reference.docx (argv[1]) and applies the report conventions
used for the RVCE submissions (constraint C11 of the SRS):
  * A4, 2.54 cm margins; running header with institution, department and course; page number;
  * body text Times New Roman 12 pt, line spacing 1.15; headings Times New Roman, bold, black;
  * tables with single-line borders; captions 10 pt italic;
  * a centred "Cover" paragraph style for the RVCE cover block (see c2_rvce.lua).
Run:  uv run --no-project --with python-docx python c2_make_reference_docx.py default.docx out.docx
"""
import sys

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

SERIF = "Times New Roman"
MONO = "Courier New"


def set_font(style, name, size=None, bold=None, italic=None, color=RGBColor(0, 0, 0)):
    f = style.font
    f.name = name
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), name)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rfonts.get(qn(attr)) is not None:
            del rfonts.attrib[qn(attr)]
    if size is not None:
        f.size = Pt(size)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic
    if color is not None:
        f.color.rgb = color


def get_style(doc, name, kind=WD_STYLE_TYPE.PARAGRAPH):
    try:
        return doc.styles[name]
    except KeyError:
        return doc.styles.add_style(name, kind)


def add_page_field(paragraph):
    run = paragraph.add_run()
    for tag, attrs, text in (("w:fldChar", {"w:fldCharType": "begin"}, None),
                             ("w:instrText", {"xml:space": "preserve"}, " PAGE "),
                             ("w:fldChar", {"w:fldCharType": "end"}, None)):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        if text:
            el.text = text
        run._r.append(el)


def table_borders(style):
    tblPr = style.element.find(qn("w:tblPr"))
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        style.element.append(tblPr)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = OxmlElement(f"w:{edge}")
        b.set(qn("w:val"), "single")
        b.set(qn("w:sz"), "4")
        b.set(qn("w:space"), "0")
        b.set(qn("w:color"), "808080")
        borders.append(b)
    old = tblPr.find(qn("w:tblBorders"))
    if old is not None:
        tblPr.remove(old)
    tblPr.append(borders)


def main(src, dst):
    doc = Document(src)

    for name in ("Normal", "Body Text", "First Paragraph", "Compact", "Block Text"):
        try:
            st = doc.styles[name]
        except KeyError:
            continue
        set_font(st, SERIF, 12 if name != "Compact" else 11)
        pf = st.paragraph_format
        pf.line_spacing = 1.15
        pf.space_after = Pt(6)
    for name, size in (("Heading 1", 14), ("Heading 2", 13), ("Heading 3", 12), ("Heading 4", 12)):
        st = doc.styles[name]
        set_font(st, SERIF, size, bold=True)
        st.paragraph_format.space_before = Pt(12)
        st.paragraph_format.space_after = Pt(6)
    for name in ("Title", "Subtitle", "Author", "Date", "TOC Heading"):
        try:
            set_font(doc.styles[name], SERIF, None, bold=True if name in ("Title", "TOC Heading") else None)
        except KeyError:
            pass
    for st in doc.styles:
        if st.name in ("Caption", "Image Caption", "Table Caption"):
            set_font(st, SERIF, 10, italic=True)
    for name, kind in (("Source Code", WD_STYLE_TYPE.PARAGRAPH), ("Verbatim Char", WD_STYLE_TYPE.CHARACTER)):
        try:
            set_font(doc.styles[name], MONO, 10 if kind == WD_STYLE_TYPE.PARAGRAPH else None, color=None)
        except KeyError:
            pass

    cover = get_style(doc, "Cover")
    cover.base_style = doc.styles["Normal"]
    set_font(cover, SERIF, 13)
    cover.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cover.paragraph_format.space_after = Pt(8)

    try:
        table_borders(doc.styles["Table"])
    except KeyError:
        pass

    for section in doc.sections:
        section.orientation = WD_ORIENT.PORTRAIT
        section.page_width, section.page_height = Cm(21.0), Cm(29.7)
        for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
            setattr(section, side, Cm(2.54))
        hp = section.header.paragraphs[0] if section.header.paragraphs else section.header.add_paragraph()
        hp.text = ("RV College of Engineering, Bengaluru · Dept. of CSE · CD252IA Database Management "
                   "Systems · Lab Component 2: SRS")
        hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for r in hp.runs:
            r.font.size = Pt(9)
            r.font.name = SERIF
        fp = section.footer.paragraphs[0] if section.footer.paragraphs else section.footer.add_paragraph()
        fp.text = ""
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_page_field(fp)

    doc.save(dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
