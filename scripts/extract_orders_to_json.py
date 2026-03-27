import zipfile
import xml.etree.ElementTree as ET
import json
import datetime
import re

XLSX_PATH = '訂貨資料_DB.xlsx'
JSON_OUT = 'private-data/transactions.json'

def parse_excel_date(val):
    if not val:
        return None
    try:
        # Excel dates are usually float days since 1899-12-30
        days = float(val)
        delta = datetime.timedelta(days=days)
        d = datetime.date(1899, 12, 30) + delta
        return d.strftime('%Y-%m-%d')
    except Exception:
        return str(val).split(' ')[0][:10] if str(val) else None

def read_shared_strings(z):
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss_xml = z.read('xl/sharedStrings.xml')
        ss_root = ET.fromstring(ss_xml)
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        for si in ss_root.findall('.//s:si', ns):
            texts = si.findall('.//s:t', ns)
            shared_strings.append(''.join(t.text or '' for t in texts))
    return shared_strings

def extract_orders():
    try:
        z = zipfile.ZipFile(XLSX_PATH, 'r')
    except Exception as e:
        print(f"Error opening Excel file: {e}")
        return

    # 0. Load valid members from members.json to prevent Foreign Key errors
    valid_members = set()
    try:
        with open('private-data/members.json', 'r', encoding='utf-8') as f:
            for m in json.load(f):
                valid_members.add(m.get('member_no'))
        print(f"Loaded {len(valid_members)} valid members for FK validation.")
    except Exception as e:
        print(f"Error loading members.json: {e}")
        return

    # 1. Find the target sheet 'rawdata'
    wb_xml = z.read('xl/workbook.xml')
    wb_root = ET.fromstring(wb_xml)
    ns_main = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
    
    sheet_rel_id = None
    for sheet in wb_root.findall('.//main:sheet', ns_main):
        if sheet.get('name') == 'rawdata':
            sheet_rel_id = sheet.get('{' + ns_main['r'] + '}id')
            break
            
    if not sheet_rel_id:
        print("Sheet 'rawdata' not found.")
        return
        
    # 2. Find the target file for the relationship
    rels_xml = z.read('xl/_rels/workbook.xml.rels')
    rels_root = ET.fromstring(rels_xml)
    ns_rels = {'rels': 'http://schemas.openxmlformats.org/package/2006/relationships'}
    
    target_path = None
    for rel in rels_root.findall('.//rels:Relationship', ns_rels):
        if rel.get('Id') == sheet_rel_id:
            target_path = 'xl/' + rel.get('Target')
            break
            
    if not target_path:
        print("Could not find relationship target for rawdata sheet.")
        return
        
    print(f"Target sheet path: {target_path}")

    # 3. Read data
    shared_strings = read_shared_strings(z)
    
    print("Parsing Excel data...")
    all_data = []
    
    with z.open(target_path) as f:
        context = ET.iterparse(f, events=('end',))
        
        for event, elem in context:
            if event == 'end' and elem.tag == f"{{{ns_main['main']}}}row":
                row_num = int(elem.get('r', 0))
                
                # Header row is 3, data starts at 4
                if row_num < 4:
                    elem.clear()
                    continue
                
                cells = {}
                for cell in elem.findall('main:c', ns_main):
                    ref = cell.get('r', '')
                    cell_type = cell.get('t', '')
                    val_el = cell.find('main:v', ns_main)
                    val = val_el.text if val_el is not None else ''
                    
                    if cell_type == 's' and val:
                        idx = int(val)
                        val = shared_strings[idx] if idx < len(shared_strings) else val
                        
                    col_match = re.match(r'([A-Z]+)', ref)
                    col = col_match.group(1) if col_match else ''
                    if col:
                        cells[col] = str(val).strip()

                C = cells.get('C', '') # member_no / user id
                K = cells.get('K', '') # amount
                L = cells.get('L', '') # quantity
                R = cells.get('R', '') # order date
                
                if not C or C not in valid_members: # Skip empty or invalid members
                    elem.clear()
                    continue
                    
                # Parse numeric values securely
                try: amount = float(K) if K else 0.0
                except ValueError: amount = 0.0
                
                try: quantity = float(L) if L else 0.0
                except ValueError: quantity = 0.0
                    
                all_data.append({
                    "member_no": C,
                    "type": "order",
                    "amount": amount,
                    "quantity": quantity,
                    "transaction_date": parse_excel_date(R) if R else None
                })
                
                elem.clear()

    print(f"Extracted {len(all_data)} order records.")
    
    with open(JSON_OUT, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False)
        
    print(f"Data saved to {JSON_OUT}. Ready for browser upload.")

if __name__ == '__main__':
    extract_orders()
