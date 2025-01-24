#!/usr/bin/env python3

import re
from git_filter_repo import FilteringOptions, Blob, Reset, GitFilterRepo

def clean_sensitive_data(blob, message):
    data = blob.data
    
    # Patterns to match and replace
    patterns = [
        (rb'AKIANQNIYDNXHOIGO', b'YOUR_ACCESS_KEY_ID'),
        (rb'(?s)aws_access_key_id\s*=\s*["\']?[A-Z0-9]+["\']?', b'aws_access_key_id = "YOUR_ACCESS_KEY_ID"'),
        (rb'(?s)AWS_ACCESS_KEY_ID\s*=\s*["\']?[A-Z0-9]+["\']?', b'AWS_ACCESS_KEY_ID = "YOUR_ACCESS_KEY_ID"'),
        (rb'(?s)aws_secret_access_key\s*=\s*["\']?[A-Za-z0-9/+=]+["\']?', b'aws_secret_access_key = "YOUR_SECRET_ACCESS_KEY"'),
        (rb'(?s)AWS_SECRET_ACCESS_KEY\s*=\s*["\']?[A-Za-z0-9/+=]+["\']?', b'AWS_SECRET_ACCESS_KEY = "YOUR_SECRET_ACCESS_KEY"')
    ]
    
    for pattern, replacement in patterns:
        data = re.sub(pattern, replacement, data, flags=re.IGNORECASE)
    
    return data

args = FilteringOptions.default_options()
args.force = True
args.partial = True
args.refs = ['refs/heads/master', 'refs/heads/feature/secure-config']
args.debug = True

filter = GitFilterRepo(
    args,
    blob_callback=clean_sensitive_data
) 