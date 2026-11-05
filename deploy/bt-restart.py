#!/usr/bin/env python3
"""Start or stop only the Synconym project through aaPanel's Node model."""
import os
import sys
import psutil

os.chdir('/www/server/panel')
sys.path.insert(0, 'class')
import public
from projectModel.nodejsModel import main

args = public.dict_obj()
args.project_name = 'synconym'
manager = main()
if len(sys.argv) > 1 and sys.argv[1] == 'stop':
    pidfile = '/www/server/nodejs/vhost/pids/synconym.pid'
    processes = []
    try:
        with open(pidfile) as f:
            parent = psutil.Process(int(f.read().strip()))
        processes = parent.children(recursive=True) + [parent]
    except (OSError, ValueError, psutil.Error):
        pass
    result = manager.stop_project(args)
    _, alive = psutil.wait_procs(processes, timeout=5)
    for process in alive:
        try:
            process.kill()
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs(alive, timeout=5)
    if alive:
        print('Could not stop all Synconym processes', file=sys.stderr)
        sys.exit(1)
else:
    result = manager.start_project(args)
print(result)
if not result.get('status'):
    sys.exit(1)
