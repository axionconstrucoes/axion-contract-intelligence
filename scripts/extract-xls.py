import json
import sys
import xlrd

if len(sys.argv) != 3:
    raise SystemExit("usage: extract-xls.py <input.xls> <output.json>")

input_path, output_path = sys.argv[1], sys.argv[2]
book = xlrd.open_workbook(input_path, on_demand=True)

segments = []
complete = []

for sheet in book.sheets():
    for row_index in range(sheet.nrows):
        values = []
        for col_index in range(sheet.ncols):
            value = sheet.cell_value(row_index, col_index)
            text = str(value).strip()
            values.append(text)

        line = " | ".join(values).strip()
        if not line:
            continue

        locator = f'Planilha "{sheet.name}", linha {row_index + 1}'
        complete.append(f'[{sheet.name} - linha {row_index + 1}] {line}')
        segments.append({
            "pageNumber": None,
            "locator": locator,
            "text": line,
        })

payload = {
    "extractor": "xlrd",
    "extractorVersion": "2.0.1",
    "pageCount": None,
    "text": "\n".join(complete).strip(),
    "segments": segments,
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False)
