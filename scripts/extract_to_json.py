#!/usr/bin/env python3
"""
Step 1: Parse membersdata.xlsx and export to JSON (no internet required).
"""
import zipfile
import xml.etree.ElementTree as ET
import json
import datetime
import re
import sys

XLSX_PATH = 'membersdata.xlsx'
JSON_OUT = 'src/members.json'

def parse_excel_date(val):
    if not val:
        return None
    try:
        days = float(val)
        delta = datetime.timedelta(days=days)
        d = datetime.date(1899, 12, 30) + delta
        return d.strftime('%Y-%m-%d')
    except ValueError:
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

def extract_data():
    try:
        z = zipfile.ZipFile(XLSX_PATH, 'r')
    except Exception as e:
        print(f"Error opening Excel file: {e}")
        return

    shared_strings = read_shared_strings(z)
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    
    print("Parsing Excel data...")
    all_data = []
    skipped = 0
    
    with z.open('xl/worksheets/sheet2.xml') as f:
        context = ET.iterparse(f, events=('end',))
        
        for event, elem in context:
            if event == 'end' and elem.tag == f"{{{ns['s']}}}row":
                row_num = int(elem.get('r', 0))
                
                if row_num < 3:
                    elem.clear()
                    continue
                
                cells = {}
                for cell in elem.findall('s:c', ns):
                    ref = cell.get('r', '')
                    cell_type = cell.get('t', '')
                    val_el = cell.find('s:v', ns)
                    val = val_el.text if val_el is not None else ''
                    
                    if cell_type == 's' and val:
                        idx = int(val)
                        val = shared_strings[idx] if idx < len(shared_strings) else val
                        
                    col_match = re.match(r'([A-Z]+)', ref)
                    col = col_match.group(1) if col_match else ''
                    if col:
                        cells[col] = str(val).strip()

                # Rule constraints
                B = cells.get('B', '')
                if not B:
                    skipped += 1
                    elem.clear()
                    continue
                    
                C = cells.get('C', '')
                E = cells.get('E', '')
                M = cells.get('M', '')
                S = cells.get('S', '')
                
                if not S:
                    skipped += 1
                    elem.clear()
                    continue
                
                node_path = S.strip('/').replace('/', '.')
                if not re.match(r'^[A-Za-z0-9_.]+$', node_path):
                    skipped += 1
                    elem.clear()
                    continue
                    
                parts = node_path.split('.')
                parent_path = '.'.join(parts[:-1]) if len(parts) > 1 else None

                name = C
                company_name = None
                if M == '經銷商' and E:
                    company_name = C
                    name = E
                    
                try:
                    inventory = float(cells.get('K', 0))
                except ValueError:
                    inventory = 0
                    
                all_data.append({
                    "member_no": B,
                    "name": name,
                    "company_name": company_name,
                    "representative": E,
                    "node_path": node_path,
                    "level": M,
                    "parent_path": parent_path,
                    "nationality": cells.get('F'),
                    "phone": cells.get('I'),
                    "email": cells.get('H'),
                    "registered_at": parse_excel_date(cells.get('L')),
                    "birthday": parse_excel_date(cells.get('N')),
                    "inviter_no": cells.get('O'),
                    "inventory": inventory
                })
                
                elem.clear()

    print(f"Extracted {len(all_data)} valid records (Skipped: {skipped})")
    
    with open(JSON_OUT, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False)
        
    print(f"Data saved to {JSON_OUT}. Ready for browser upload.")

if __name__ == '__main__':
    extract_data()
