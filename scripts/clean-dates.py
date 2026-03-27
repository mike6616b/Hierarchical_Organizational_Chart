#!/usr/bin/env python3
import json
import re

def clean_date(val):
    if not val:
        return None
    val = str(val).strip()
    
    # Clean up standard format (might have time attached)
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', val)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        
    # Clean up Chinese format: 1978年12月15[日...]
    m = re.match(r'^(\d{4})年(\d{1,2})月(\d{1,2})', val)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        
    # Clean up slash format: 1978/12/15
    m = re.match(r'^(\d{4})/(\d{1,2})/(\d{1,2})', val)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        
    # If unparseable or dirty string, set to Null to avoid Postgres error
    return None

def main():
    print("Loading private-data/members.json...")
    with open('private-data/members.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    fixes = 0
    nullified = 0
    
    for row in data:
        for field in ['registered_at', 'birthday']:
            old_val = row.get(field)
            if old_val:
                new_val = clean_date(old_val)
                row[field] = new_val
                if new_val != old_val:
                    if new_val:
                        fixes += 1
                    else:
                        nullified += 1
                        
    print(f"Fixed {fixes} dates. Nullified {nullified} unparseable dates.")
    
    print("Saving cleaned private-data/members.json...")
    with open('private-data/members.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print("Done!")

if __name__ == '__main__':
    main()
