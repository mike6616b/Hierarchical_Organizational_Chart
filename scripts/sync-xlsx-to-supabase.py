#!/usr/bin/env python3
"""
ETL Script: Sync member data from Excel to Supabase
- Parses membersdata.xlsx (Sheet2: ref.會員資料) using pure Python stdlib.
- Uploads to SupabaseREST API in batches.
"""
import zipfile
import xml.etree.ElementTree as ET
import urllib.request
import urllib.error
import json
import datetime
import re
import sys
import time

import os

XLSX_PATH = 'membersdata.xlsx'
SUPABASE_URL = os.environ.get("SUPABASE_URL", "YOUR_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "YOUR_SUPABASE_KEY")
BATCH_SIZE = 1000  # Upload 1000 rows at a time

def parse_excel_date(val):
    if not val:
        return None
    try:
        # Check if float (Excel serial date)
        days = float(val)
        delta = datetime.timedelta(days=days)
        d = datetime.date(1899, 12, 30) + delta
        return d.strftime('%Y-%m-%d')
    except ValueError:
        # If it's already a string like "2026-03-24 09:19:03"
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

def col_letter_to_index(col):
    res = 0
    for char in col:
        res = res * 26 + (ord(char.upper()) - ord('A')) + 1
    return res - 1

def upload_batch(records, max_retries=3):
    url = f"{SUPABASE_URL}/rest/v1/members?on_conflict=member_no"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    data = json.dumps(records).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req) as response:
                if response.status not in (200, 201, 204):
                    print(f"Error: {response.status} {response.read()}")
                    return False
                return True
        except urllib.error.HTTPError as e:
            print(f"HTTPError on upload: {e.code} {e.read().decode('utf-8')}")
            return False
        except Exception as e:
            print(f"Upload failed (attempt {attempt+1}/{max_retries}): {e}")
            time.sleep(2)
    return False

def sync_data():
    print("Reading shared strings...")
    try:
        z = zipfile.ZipFile(XLSX_PATH, 'r')
    except Exception as e:
        print(f"Could not open {XLSX_PATH}: {e}")
        return

    shared_strings = read_shared_strings(z)
    sheet_path = 'xl/worksheets/sheet2.xml'
    
    if sheet_path not in z.namelist():
        print(f"Sheet {sheet_path} not found!")
        return

    print("Parsing sheet 2 (ref.會員資料)...")
    batch = []
    total_processed = 0
    total_uploaded = 0
    skipped = 0

    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    
    # Using iterparse for memory efficiency
    with z.open(sheet_path) as f:
        context = ET.iterparse(f, events=('end',))
        
        for event, elem in context:
            if event == 'end' and elem.tag == f"{{{ns['s']}}}row":
                row_num = int(elem.get('r', 0))
                
                # Skip headers
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

                # Process row mapping
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
                    # Missing node path - LTREE cannot be null in our schema for this field, but let's safely skip
                    skipped += 1
                    elem.clear()
                    continue
                
                # Format node_path
                clean_path = S.strip('/')
                node_path = clean_path.replace('/', '.')
                
                # Valid ltree contains only A-Za-z0-9_
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
                    
                record = {
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
                }
                
                batch.append(record)
                total_processed += 1
                
                if len(batch) >= BATCH_SIZE:
                    print(f"Uploading batch... (Processed: {total_processed})")
                    if upload_batch(batch):
                        total_uploaded += len(batch)
                    else:
                        print("Batch upload failed! Aborting to prevent data inconsistency.")
                        sys.exit(1)
                    batch = []
                    
                # Free memory
                elem.clear()

    # Upload remaining
    if batch:
        print(f"Uploading final batch... (Processed: {total_processed})")
        if upload_batch(batch):
            total_uploaded += len(batch)
            
    print("-" * 30)
    print(f"Sync complete!")
    print(f"Total processed: {total_processed}")
    print(f"Total uploaded:  {total_uploaded}")
    print(f"Total skipped (missing/invalid node): {skipped}")

if __name__ == '__main__':
    sync_data()
