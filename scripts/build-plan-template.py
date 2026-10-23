#!/usr/bin/env python3
"""
将彩色《代销管理系统变更方案（优化版）.docx》转换为 docxtemplater 模板，
同时生成前端表单/后端校验共用的字段 Schema。

用法:
    python3 scripts/build-plan-template.py [源模板路径]

源模板约定:
- 红色（FF0000）文字是需要手工输入的字段；
- 橙黄色（FFC000）文字是下拉多选字段；
- 黑色文字是固定内容。
"""
from __future__ import annotations

import copy
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"

RED = "FF0000"
YELLOW = "FFC000"

# 红色段落字段定义，顺序必须与文档中红色段落出现顺序一致。
MANUAL_FIELDS = [
    ("packageFile", "变更包", "变更文件清单", "input"),
    ("packageNote", "说明", "变更文件清单", "textarea"),
    ("dbStep1", "数据库变更步骤", "数据库变更", "textarea"),
    ("dbStep2", "数据库变更步骤 2", "数据库变更", "textarea"),
    ("dbStep3", "数据库变更步骤 3", "数据库变更", "textarea"),
    ("dbStep4", "数据库变更步骤 4", "数据库变更", "textarea"),
    ("dbStep5", "数据库变更步骤 5", "数据库变更", "textarea"),
    ("configStep1", "配置文件修改步骤", "修改配置文件", "textarea"),
    ("configStep2", "配置文件修改步骤 2", "修改配置文件", "textarea"),
    ("manualStep1", "手工变更步骤", "手工变更", "textarea"),
    ("manualStep2", "手工变更步骤 2", "手工变更", "textarea"),
    ("manualStep3", "手工变更步骤 3", "手工变更", "textarea"),
    ("manualStep4", "手工变更步骤 4", "手工变更", "textarea"),
    ("manualStep5", "手工变更步骤 5", "手工变更", "textarea"),
    ("appRollbackIntro", "应用回退内容", "应用回退", "textarea"),
    ("appRollbackStep1", "应用回退步骤 1", "应用回退", "textarea"),
    ("appRollbackStep2", "应用回退步骤 2", "应用回退", "textarea"),
    ("appRollbackStep3", "应用回退步骤 3", "应用回退", "textarea"),
    ("appRollbackStep4", "应用回退步骤 4", "应用回退", "textarea"),
    ("appRollbackStep5", "应用回退步骤 5", "应用回退", "textarea"),
    ("appRollbackStep6", "应用回退步骤 6", "应用回退", "textarea"),
    ("dbRollback", "数据库回退", "数据库回退", "textarea"),
]

# 每个步骤分组只保留第一个段落/输入框；被合并的段落从 Word 模板中删除。
MERGED_GROUPS = {
    "dbStep1": ["dbStep1", "dbStep2", "dbStep3", "dbStep4", "dbStep5"],
    "configStep1": ["configStep1", "configStep2"],
    "manualStep1": ["manualStep1", "manualStep2", "manualStep3", "manualStep4", "manualStep5"],
    "appRollbackIntro": [
        "appRollbackIntro",
        "appRollbackStep1",
        "appRollbackStep2",
        "appRollbackStep3",
        "appRollbackStep4",
        "appRollbackStep5",
        "appRollbackStep6",
    ],
}
REMOVED_KEYS = {
    key
    for keys in MERGED_GROUPS.values()
    for key in keys[1:]
}

RED_INDICES = [4, 5, 11, 12, 13, 14, 15, 20, 21, 24, 25, 26, 27, 28,
               31, 32, 33, 34, 35, 36, 37, 39]
YELLOW_FIELDS = [
    (10, "dbChanges", "数据库变更", "（一）数据库变更"),
    (16, "autoDeployChanges", "自动化部署", "（二）自动化部署"),
    (19, "configFileChanges", "修改配置文件", "（三）修改配置文件"),
]
HEADER_TAGS = [
    (0, "{requirementText}"),
    (1, "{changeSystem}"),
    (2, "{changeMethod}"),
]
SERVER_COLUMNS = [
    ("assetName", "资产名称"),
    ("ip", "IP 地址"),
    ("username", "用户名"),
    ("assetType", "资产类型"),
]
CHANGE_METHOD_OPTIONS = ["自动化部署", "手工部署", "自动化+手工部署"]


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def register_namespaces(xml_text: str) -> None:
    for prefix, uri in re.findall(r'xmlns:([\w.-]+)="([^"]+)"', xml_text):
        try:
            ET.register_namespace(prefix, uri)
        except ValueError:
            pass


def run_text(run: ET.Element) -> str:
    out = []
    for el in run.iter():
        if el.tag == w("t"):
            out.append(el.text or "")
        elif el.tag == w("br"):
            out.append("\n")
        elif el.tag == w("tab"):
            out.append("\t")
    return "".join(out)


def para_text(paragraph: ET.Element) -> str:
    return "".join(run_text(run) for run in paragraph.findall(w("r")))


def run_color(run: ET.Element) -> str | None:
    rpr = run.find(w("rPr"))
    if rpr is None:
        return None
    color = rpr.find(w("color"))
    return color.get(w("val")) if color is not None else None


def red_runs(paragraph: ET.Element) -> list[ET.Element]:
    return [r for r in paragraph.findall(w("r")) if run_color(r) == RED]


def yellow_runs(paragraph: ET.Element) -> list[ET.Element]:
    return [r for r in paragraph.findall(w("r")) if run_color(r) == YELLOW]


def strip_edit_marks(rpr: ET.Element) -> None:
    for tag in ("color", "shd", "highlight"):
        el = rpr.find(w(tag))
        if el is not None:
            rpr.remove(el)


def clean_rpr(run: ET.Element) -> ET.Element | None:
    """复制 run 的 rPr，并去掉红色/橙色、底纹等编辑标记。"""
    rpr = run.find(w("rPr"))
    if rpr is None:
        return None
    rpr = copy.deepcopy(rpr)
    strip_edit_marks(rpr)
    return rpr


def clean_ppr(paragraph: ET.Element) -> ET.Element | None:
    """复制段落 pPr，并清理段落标记上的红色。"""
    ppr = paragraph.find(w("pPr"))
    if ppr is None:
        return None
    ppr = copy.deepcopy(ppr)
    rpr = ppr.find(w("rPr"))
    if rpr is not None:
        strip_edit_marks(rpr)
    return ppr


def make_tag_run(run: ET.Element, text: str) -> ET.Element:
    tag_run = ET.Element(w("r"))
    rpr = clean_rpr(run)
    if rpr is not None:
        tag_run.append(rpr)
    t = ET.SubElement(tag_run, w("t"))
    t.set(f"{{{XML_NS}}}space", "preserve")
    t.text = text
    return tag_run


def last_text_element(run: ET.Element) -> ET.Element | None:
    for t in reversed(run.findall(w("t"))):
        if t.text:
            return t
    return None


def strip_trailing_char_before(paragraph: ET.Element, target_run: ET.Element, char: str) -> None:
    runs = paragraph.findall(w("r"))
    index = runs.index(target_run)
    for run in reversed(runs[:index]):
        t = last_text_element(run)
        if t is not None:
            assert_true(t.text.endswith(char),
                        f"未找到标题中橙色字段前的“{char}”: {t.text!r}")
            t.text = t.text[:-1]
            return
    raise SystemExit(f"未找到标题中橙色字段前的“{char}”")


def strip_leading_char_after(paragraph: ET.Element, target_run: ET.Element, char: str) -> None:
    runs = paragraph.findall(w("r"))
    index = runs.index(target_run)
    for run in runs[index + 1:]:
        texts = run.findall(w("t"))
        for t in texts:
            if t.text:
                assert_true(t.text.startswith(char),
                            f"未找到标题中橙色字段后的“{char}”: {t.text!r}")
                t.text = t.text[1:]
                if not any((text.text or "") for text in texts):
                    paragraph.remove(run)
                return
    raise SystemExit(f"未找到标题中橙色字段后的“{char}”")


def replace_paragraph_with_tag(paragraph: ET.Element, tag: str) -> None:
    """保留段落样式与首个 run 的字体，清空内容后写入 tag。"""
    first_run = paragraph.find(w("r"))
    rpr = clean_rpr(first_run) if first_run is not None else None
    for child in list(paragraph):
        if child.tag != w("pPr"):
            paragraph.remove(child)
    run = ET.SubElement(paragraph, w("r"))
    if rpr is not None:
        run.append(rpr)
    t = ET.SubElement(run, w("t"))
    t.set(f"{{{XML_NS}}}space", "preserve")
    t.text = tag


def rebuild_cell(cell: ET.Element, text: str) -> None:
    """把单元格重建为单个段落、单个 run，保留 tcPr/pPr/rPr 样式。"""
    first_p = cell.find(w("p"))
    ppr = None
    rpr = None
    if first_p is not None:
        ppr = clean_ppr(first_p)
        first_run = first_p.find(w("r"))
        if first_run is not None:
            rpr = clean_rpr(first_run)

    for child in list(cell):
        if child.tag != w("tcPr"):
            cell.remove(child)

    paragraph = ET.SubElement(cell, w("p"))
    if ppr is not None:
        paragraph.append(ppr)
    run = ET.SubElement(paragraph, w("r"))
    if rpr is not None:
        run.append(rpr)
    t = ET.SubElement(run, w("t"))
    t.set(f"{{{XML_NS}}}space", "preserve")
    t.text = text


def cell_text(cell: ET.Element) -> str:
    return "".join(paragraph_text(p) for p in cell.findall(w("p"))).strip()


def paragraph_text(p: ET.Element) -> str:
    return "".join(run_text(r) for r in p.findall(w("r")))


def get_row(table: ET.Element, index: int) -> ET.Element:
    return table.findall(w("tr"))[index]


def get_cell(row: ET.Element, index: int) -> ET.Element:
    return row.findall(w("tc"))[index]


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"模板结构校验失败：{message}")


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    default_source = Path(__file__).resolve().parent / "change-plan-template-source.docx"
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else default_source
    template_output = project_root / "server" / "templates" / "change-plan-template.docx"
    schema_output = project_root / "server" / "templates" / "change-plan-schema.json"

    if not source.exists():
        raise SystemExit(f"找不到源模板: {source}")

    with zipfile.ZipFile(source) as archive:
        document_xml = archive.read("word/document.xml").decode("utf-8")
        register_namespaces(document_xml)
        root = ET.fromstring(document_xml)
        body = root.find(w("body"))
        assert_true(body is not None, "缺少 w:body")

        children = list(body)
        assert_true(len(children) == 51, f"body 子元素应为 51 个，实际 {len(children)} 个")

        # ---------- 结构断言 ----------
        table_top = children[1]
        table_server = children[8]
        assert_true(table_top.tag == w("tbl"), "index 1 应为表头表格")
        assert_true(table_server.tag == w("tbl"), "index 8 应为服务器表格")

        top_rows = table_top.findall(w("tr"))
        assert_true(len(top_rows) == 3, f"表头表格应为 3 行，实际 {len(top_rows)} 行")
        for row in top_rows:
            assert_true(len(row.findall(w("tc"))) == 2, "表头表格应为 2 列")
        top_labels = [cell_text(get_cell(row, 0)) for row in top_rows]
        assert_true(top_labels == ["变更需求", "变更系统", "变更方式"],
                    f"表头标签不匹配: {top_labels}")

        server_rows = table_server.findall(w("tr"))
        assert_true(len(server_rows) == 4, f"服务器表格应为 4 行，实际 {len(server_rows)} 行")
        for row in server_rows:
            assert_true(len(row.findall(w("tc"))) == 4, "服务器表格应为 4 列")
        server_header = [cell_text(cell) for cell in server_rows[0].findall(w("tc"))]
        expected_header = [label for _, label in SERVER_COLUMNS]
        assert_true(server_header == expected_header,
                    f"服务器表头不匹配: {server_header}")

        for index in RED_INDICES:
            assert_true(children[index].tag == w("p"), f"index {index} 应为段落")
            assert_true(len(red_runs(children[index])) > 0,
                        f"index {index} 未找到红色文字")
        for index, _, _, _ in YELLOW_FIELDS:
            assert_true(children[index].tag == w("p"), f"index {index} 应为段落")
            assert_true(len(yellow_runs(children[index])) == 1,
                        f"index {index} 应恰好有一个橙色 run")

        all_red_paragraphs = {
            i for i, child in enumerate(children)
            if child.tag == w("p") and red_runs(child)
        }
        assert_true(all_red_paragraphs == set(RED_INDICES),
                    f"红色段落索引不匹配，实际: {sorted(all_red_paragraphs)}")
        all_yellow_paragraphs = {
            i for i, child in enumerate(children)
            if child.tag == w("p") and yellow_runs(child)
        }
        assert_true(all_yellow_paragraphs == {i for i, *_ in YELLOW_FIELDS},
                    f"橙色段落索引不匹配，实际: {sorted(all_yellow_paragraphs)}")

        assert_true("代销管理系统变更方案" in paragraph_text(children[0]),
                    "标题内容不匹配")
        assert_true(paragraph_text(children[4]).startswith("变更包："),
                    "index 4 应以“变更包：”开头")
        assert_true(paragraph_text(children[5]).startswith("说明："),
                    "index 5 应以“说明：”开头")

        # ---------- 提取服务器表格示例行（用于前端 placeholder） ----------
        sample_rows = []
        for row in server_rows[1:]:
            values = [cell_text(cell) for cell in row.findall(w("tc"))]
            if any(values):
                sample_rows.append(dict(zip([key for key, _ in SERVER_COLUMNS], values)))

        # ---------- 表头表格: 值单元格改为 tag ----------
        for row_index, tag in HEADER_TAGS:
            rebuild_cell(get_cell(top_rows[row_index], 1), tag)

        # ---------- 红色段落: 替换为 tag ----------
        placeholders = {}
        field_index_by_key = {}
        for (key, label, section, kind), index in zip(MANUAL_FIELDS, RED_INDICES):
            field_index_by_key[key] = index
            paragraph = children[index]
            runs = red_runs(paragraph)
            # 校验红色文字是连续的一组
            direct_runs = paragraph.findall(w("r"))
            positions = [direct_runs.index(run) for run in runs]
            assert_true(
                positions == list(range(min(positions), max(positions) + 1)),
                f"index {index} 的红色文字不是连续的一组: {positions}",
            )
            placeholder = "".join(run_text(run) for run in runs).strip()
            assert_true(placeholder, f"index {index} 红色文字为空")
            placeholders[key] = placeholder
            insert_at = list(paragraph).index(runs[0])
            for run in runs:
                paragraph.remove(run)
            paragraph.insert(insert_at, make_tag_run(runs[0], "{" + key + "}"))
            ppr = paragraph.find(w("pPr"))
            if ppr is not None:
                ppr_rpr = ppr.find(w("rPr"))
                if ppr_rpr is not None:
                    strip_edit_marks(ppr_rpr)

        # 每个步骤分组只保留第一个字段，placeholder 汇总整组参考内容
        manual_fields = []
        for key, label, section, kind in MANUAL_FIELDS:
            if key in REMOVED_KEYS:
                continue
            members = MERGED_GROUPS.get(key, [key])
            combined_placeholder = "\n".join(
                placeholders[member] for member in members if placeholders.get(member)
            ).strip()
            manual_fields.append({
                "key": key,
                "label": label,
                "section": section,
                "kind": kind,
                "placeholder": combined_placeholder,
            })

        # ---------- 橙色 run: 改为可空的多选后缀 tag ----------
        multi_selects = []
        for index, key, label, heading in YELLOW_FIELDS:
            paragraph = children[index]
            run = yellow_runs(paragraph)[0]
            placeholder = run_text(run).strip()
            # 去掉固定括号，改为由后缀 tag 决定是否输出“（需求1、需求2）”
            strip_trailing_char_before(paragraph, run, "（")
            strip_leading_char_after(paragraph, run, "）")
            text_els = run.findall(w("t"))
            assert_true(len(text_els) >= 1, f"index {index} 的橙色 run 没有文本")
            for extra in text_els[1:]:
                run.remove(extra)
            text_els[0].set(f"{{{XML_NS}}}space", "preserve")
            text_els[0].text = "{" + key + "Suffix}"
            rpr = run.find(w("rPr"))
            if rpr is not None:
                color = rpr.find(w("color"))
                if color is not None:
                    rpr.remove(color)
            multi_selects.append({
                "key": key,
                "suffixKey": key + "Suffix",
                "label": label,
                "heading": heading,
                "placeholder": placeholder,
            })

        # ---------- 服务器表格: 第一条数据行改为循环行 ----------
        loop_cells = [
            "{#serverRows}{assetName}",
            "{ip}",
            "{username}",
            "{assetType}{/serverRows}",
        ]
        for cell, tag in zip(server_rows[1].findall(w("tc")), loop_cells):
            rebuild_cell(cell, tag)
        table_server.remove(server_rows[2])
        table_server.remove(server_rows[3])

        # ---------- 固定内容说明（供前端只读提示） ----------
        fixed_sections = []

        def collect_section(title_index: int) -> dict:
            title = paragraph_text(children[title_index]).strip()
            lines = []
            cursor = title_index + 1
            while cursor < len(children) and children[cursor].tag == w("p"):
                text = paragraph_text(children[cursor]).strip()
                if not text:
                    cursor += 1
                    continue
                if re.match(r"^[一二三四五六七八九十]+、", text):
                    break
                lines.append(text)
                cursor += 1
            return {"title": title, "lines": lines}

        for index, child in enumerate(children):
            if child.tag == w("p") and paragraph_text(child).strip() == "六、变更注意事项":
                fixed_sections.append(collect_section(index))

        # ---------- 变更验证方案改为取自申请表内容 ----------
        verification_title_index = next(
            (i for i, child in enumerate(children)
             if child.tag == w("p") and paragraph_text(child).strip() == "五、变更验证方案"),
            None,
        )
        notes_title_index = next(
            (i for i, child in enumerate(children)
             if child.tag == w("p") and paragraph_text(child).strip() == "六、变更注意事项"),
            None,
        )
        assert_true(verification_title_index is not None, "缺少“五、变更验证方案”标题")
        assert_true(notes_title_index is not None, "缺少“六、变更注意事项”标题")
        verification_paragraphs = [
            children[i] for i in range(verification_title_index + 1, notes_title_index)
            if children[i].tag == w("p")
        ]
        assert_true(bool(verification_paragraphs), "变更验证方案下没有可替换的段落")
        replace_paragraph_with_tag(verification_paragraphs[0], "{verificationPlan}")
        for paragraph in verification_paragraphs[1:]:
            body.remove(paragraph)

        # ---------- 删除被合并的步骤段落，只保留每组第一个输入框 ----------
        for key in REMOVED_KEYS:
            body.remove(children[field_index_by_key[key]])

        # ---------- 序列化 document.xml ----------
        new_document_xml = ET.tostring(root, encoding="unicode")
        original_open = re.search(r"<w:document\b[^>]*>", document_xml, re.S)
        new_open = re.search(r"<w:document\b[^>]*>", new_document_xml, re.S)
        if original_open and new_open:
            new_document_xml = (
                new_document_xml[: new_open.start()]
                + original_open.group(0)
                + new_document_xml[new_open.end():]
            )
        new_document_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
            + new_document_xml.split("?>", 1)[-1].lstrip()
        )

        # 再次确认保留的 tag 已写入、被合并字段的 tag 已删除
        for field in manual_fields:
            key = field["key"]
            assert_true("{" + key + "}" in new_document_xml,
                        f"模板中缺少 tag: {key}")
        for key in REMOVED_KEYS:
            assert_true("{" + key + "}" not in new_document_xml,
                        f"模板中仍存在应删除的 tag: {key}")
        for _, key, _, _ in YELLOW_FIELDS:
            assert_true("{" + key + "Suffix}" in new_document_xml,
                        f"模板中缺少多选后缀 tag: {key}Suffix")
        assert_true("{verificationPlan}" in new_document_xml,
                    "模板中缺少变更验证方案 tag: verificationPlan")

        # ---------- core.xml ----------
        core_xml = archive.read("docProps/core.xml").decode("utf-8")
        if "<dc:title>" in core_xml:
            core_xml = re.sub(r"<dc:title>.*?</dc:title>",
                              "<dc:title>变更方案</dc:title>", core_xml)
        else:
            core_xml = core_xml.replace(
                "</cp:coreProperties>",
                "<dc:title>变更方案</dc:title></cp:coreProperties>",
            )

        template_output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(template_output, "w", compression=zipfile.ZIP_DEFLATED) as target:
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

    schema = {
        "version": 1,
        "templateFile": "change-plan-template.docx",
        "changeMethodOptions": CHANGE_METHOD_OPTIONS,
        "headerFields": [
            {"key": "requirementText", "label": "变更需求", "type": "lines"},
            {"key": "changeSystem", "label": "变更系统", "type": "readonly"},
            {"key": "expectedChangeDate", "label": "期望变更日期", "type": "date"},
            {"key": "changeMethod", "label": "变更方式", "type": "select"},
        ],
        "serverTable": {
            "key": "serverRows",
            "columns": [{"key": key, "label": label} for key, label in SERVER_COLUMNS],
            "sampleRows": sample_rows,
        },
        "multiSelects": multi_selects,
        "manualFields": manual_fields,
        "verificationField": {
            "key": "verificationPlan",
            "label": "变更验证方案",
            "section": "变更验证方案",
            "kind": "textarea",
            "placeholder": "取自变更申请表的变更验证方案",
        },
        "fixedSections": fixed_sections,
    }
    schema_output.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"模板已生成: {template_output}")
    print(f"字段 Schema 已生成: {schema_output}")
    print(f"手工字段 {len(manual_fields)} 个；多选字段 {len(multi_selects)} 个；"
          f"服务器示例行 {len(sample_rows)} 条")
    for field in manual_fields:
        print(f"  - {field['key']}: {field['placeholder'][:48]}")


if __name__ == "__main__":
    main()
