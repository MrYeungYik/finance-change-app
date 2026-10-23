#!/usr/bin/env python3
"""
将原始《财务管理系统变更申请表.docx》转换为 docxtemplater 模板。

用法:
    python3 scripts/build-template.py [原始 docx 路径]

转换内容:
- 将示例数据替换为 {字段} 占位符；
- 将变更功能点表格的一行改为循环行，删除其余示例空行；
- 复选框使用动态 ● / ○ 标记；
- 清除正文中的红色示例文字与文档作者等元数据。
"""
from __future__ import annotations

import copy
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def wa(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def register_namespaces(xml_text: str) -> None:
    """保留原文档使用的命名空间前缀，避免序列化后前缀冲突。"""
    for prefix, uri in re.findall(r'xmlns:([\w.-]+)="([^"]+)"', xml_text):
        try:
            ET.register_namespace(prefix, uri)
        except ValueError:
            pass


def make_rpr(bold: bool) -> ET.Element:
    rpr = ET.Element(w("rPr"))
    fonts = ET.SubElement(rpr, w("rFonts"))
    fonts.set(wa("ascii"), "仿宋_GB2312")
    fonts.set(wa("hAnsi"), "仿宋_GB2312")
    fonts.set(wa("eastAsia"), "仿宋_GB2312")
    fonts.set(wa("hint"), "eastAsia")
    if bold:
        ET.SubElement(rpr, w("b"))
        ET.SubElement(rpr, w("bCs"))
    size = ET.SubElement(rpr, w("sz"))
    size.set(wa("val"), "32")
    size_cs = ET.SubElement(rpr, w("szCs"))
    size_cs.set(wa("val"), "32")
    return rpr


def add_run(paragraph: ET.Element, text: str, bold: bool) -> None:
    """添加一个文本 run；文本中的 \\n 会转换为 Word 软换行 <w:br/>。"""
    run = ET.SubElement(paragraph, w("r"))
    run.append(make_rpr(bold))
    for index, part in enumerate(text.split("\n")):
        if index > 0:
            ET.SubElement(run, w("br"))
        text_el = ET.SubElement(run, w("t"))
        text_el.set(f"{{{XML_NS}}}space", "preserve")
        text_el.text = part


def rebuild_cell(cell: ET.Element, segments: list[tuple[str, bool]]) -> None:
    """重建单元格为单个段落。segments 为 (文本, 是否加粗) 列表。"""
    first_p = cell.find(w("p"))
    ppr = None
    if first_p is not None and first_p.find(w("pPr")) is not None:
        ppr = copy.deepcopy(first_p.find(w("pPr")))

    # 保留 tcPr，删除原有所有段落
    for child in list(cell):
        if child.tag != w("tcPr"):
            cell.remove(child)

    paragraph = ET.SubElement(cell, w("p"))
    if ppr is not None:
        paragraph.append(ppr)
    for text, bold in segments:
        add_run(paragraph, text, bold)


def cell_text(cell: ET.Element) -> str:
    return "".join(t.text or "" for t in cell.iter(w("t")))


def get_row(table: ET.Element, index: int) -> ET.Element:
    return table.findall(w("tr"))[index]


def get_cell(row: ET.Element, index: int) -> ET.Element:
    return row.findall(w("tc"))[index]


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else project_root.parent / "财务管理系统变更申请表.docx"
    output = project_root / "server" / "templates" / "change-application-template.docx"
    if not source.exists():
        raise SystemExit(f"找不到原始文档: {source}")

    with zipfile.ZipFile(source) as archive:
        document_xml = archive.read("word/document.xml").decode("utf-8")
        register_namespaces(document_xml)
        root = ET.fromstring(document_xml)
        body = root.find(w("body"))
        table = body.find(w("tbl"))
        if table is None:
            raise SystemExit("原始文档中未找到表格")

        # ---- 基础信息 ----
        row = get_row(table, 0)
        rebuild_cell(get_cell(row, 1), [("{applicant}", False)])
        rebuild_cell(get_cell(row, 3), [("{department}", False)])
        rebuild_cell(get_cell(row, 5), [("{applicationDateText}", False)])

        row = get_row(table, 1)
        rebuild_cell(get_cell(row, 1), [("{devOwnerA}", False)])
        rebuild_cell(get_cell(row, 3), [("{devOwnerB}", False)])

        row = get_row(table, 2)
        rebuild_cell(get_cell(row, 1), [("{changeSystem}", False)])

        row = get_row(table, 3)
        rebuild_cell(get_cell(row, 1), [("{reportYesMark} 是", False)])
        rebuild_cell(get_cell(row, 2), [("{reportNoMark} 否", False)])
        rebuild_cell(get_cell(row, 4), [("{expectedChangeDateText}", False)])

        # ---- 变更功能点循环行：开标签在首格、闭标签在末格 ----
        row = get_row(table, 6)
        rebuild_cell(get_cell(row, 0), [("{#changeItems}{seq}", False)])
        rebuild_cell(get_cell(row, 1), [("{category}", False)])
        rebuild_cell(get_cell(row, 2), [("{featureName}{/changeItems}", False)])

        # ---- 风险与关联变更 ----
        row = get_row(table, 10)
        rebuild_cell(
            get_cell(row, 0),
            [
                ("变更影响及范围等变更风险说明：\n", True),
                ("{riskDescription}", False),
            ],
        )

        row = get_row(table, 11)
        rebuild_cell(get_cell(row, 1), [("{relatedChangeYesMark} 是", False)])
        rebuild_cell(get_cell(row, 2), [("{relatedChangeNoMark} 否", False)])

        row = get_row(table, 12)
        rebuild_cell(get_cell(row, 0), [("{relatedSystemsText}", False)])

        # ---- 数据库 / DDL / DML ----
        row = get_row(table, 13)
        rebuild_cell(get_cell(row, 1), [("{dbStructureMark} 表结构", False)])
        rebuild_cell(get_cell(row, 2), [("{dbIndexMark} 索引", False)])
        rebuild_cell(get_cell(row, 3), [("{dbTriggerMark} 触发器", False)])
        rebuild_cell(get_cell(row, 4), [("{dbProcedureMark} 存储过程", False)])

        row = get_row(table, 14)
        rebuild_cell(get_cell(row, 0), [("{ddlDml}", False)])

        # ---- 网络与资源 ----
        row = get_row(table, 15)
        rebuild_cell(get_cell(row, 1), [("{networkMark} 网络", False)])
        rebuild_cell(get_cell(row, 2), [("{resourceMark} 资源", False)])

        row = get_row(table, 16)
        rebuild_cell(
            get_cell(row, 0),
            [
                ("网络变更时间：", True),
                ("{networkChangeTimeText}", False),
                ("\n资源变更时间：", True),
                ("{resourceChangeTimeText}", False),
            ],
        )

        # ---- 实施 / 回退 / 验证 ----
        row = get_row(table, 17)
        rebuild_cell(
            get_cell(row, 0),
            [("变更实施方案：\n", True), ("{implementationPlan}", False)],
        )

        row = get_row(table, 18)
        rebuild_cell(
            get_cell(row, 0),
            [
                ("数据及程序的备份回退方案", True),
                ("(如有关联变更,需说明关联变更之间的回退策略)", False),
                ("：\n", True),
                ("{rollbackPlan}", False),
            ],
        )

        row = get_row(table, 19)
        rebuild_cell(get_cell(row, 1), [("{verifier1}", False)])
        rebuild_cell(get_cell(row, 3), [("{verifierContact}", False)])

        row = get_row(table, 20)
        rebuild_cell(get_cell(row, 1), [("{nextDayDuty}", False)])
        rebuild_cell(get_cell(row, 3), [("{dutyContact}", False)])

        row = get_row(table, 21)
        rebuild_cell(
            get_cell(row, 0),
            [
                ("变更验证方案", True),
                ("（如果在现有条件下变更结果无法得到有效验证,请注明原因）", False),
                ("：\n", True),
                ("{verificationPlan}", False),
            ],
        )

        # 删除原始表格中多余的三行示例数据（最后删除，避免行号错位）
        for row_index in (9, 8, 7):
            table.remove(table.findall(w("tr"))[row_index])

        new_document_xml = ET.tostring(root, encoding="unicode")
        # 恢复原始根节点声明，确保 mc:Ignorable 引用到的命名空间仍然存在
        original_open = re.search(r"<w:document\b[^>]*>", document_xml, re.S)
        new_open = re.search(r"<w:document\b[^>]*>", new_document_xml, re.S)
        if original_open and new_open:
            new_document_xml = (
                new_document_xml[: new_open.start()]
                + original_open.group(0)
                + new_document_xml[new_open.end() :]
            )
        new_document_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
            + new_document_xml.split("?>", 1)[-1].lstrip()
        )

        # 清理文档元数据
        core_xml = archive.read("docProps/core.xml").decode("utf-8")
        core_xml = re.sub(r"<dc:creator>.*?</dc:creator>", "<dc:creator>变更申请系统</dc:creator>", core_xml)
        core_xml = re.sub(
            r"<cp:lastModifiedBy>.*?</cp:lastModifiedBy>",
            "<cp:lastModifiedBy>变更申请系统</cp:lastModifiedBy>",
            core_xml,
        )
        core_xml = re.sub(r"<dc:title>.*?</dc:title>", "<dc:title>财务管理系统变更申请表</dc:title>", core_xml)

        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                if info.filename == "word/document.xml":
                    data = new_document_xml.encode("utf-8")
                elif info.filename == "docProps/core.xml":
                    data = core_xml.encode("utf-8")
                else:
                    data = archive.read(info.filename)
                target.writestr(info, data)

    # 输出模板表格内容，便于人工核对
    print(f"模板已生成: {output}")
    template_root = ET.fromstring(new_document_xml)
    template_table = template_root.find(w("body")).find(w("tbl"))
    for index, table_row in enumerate(template_table.findall(w("tr"))):
        print(index, [cell_text(cell).replace("\n", " / ") for cell in table_row.findall(w("tc"))])


if __name__ == "__main__":
    main()
