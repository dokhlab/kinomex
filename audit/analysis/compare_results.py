import json, math, sys
exp = json.load(open(sys.argv[1])); obs = json.load(open(sys.argv[2]))
diffs = []; n = [0]
def walk(e, o, path):
    if isinstance(e, dict):
        if not isinstance(o, dict): diffs.append((path, "type", e, o)); return
        for k in e:
            if k not in o: diffs.append((path + "/" + k, "missing", e[k], None)); continue
            walk(e[k], o[k], path + "/" + k)
    elif isinstance(e, list):
        if not isinstance(o, list) or len(e) != len(o): diffs.append((path, "list", e if len(str(e))<200 else str(e)[:200], o if len(str(o))<200 else str(o)[:200])); return
        for i, (a, b) in enumerate(zip(e, o)): walk(a, b, f"{path}[{i}]")
    elif isinstance(e, float) or isinstance(o, float):
        n[0] += 1
        if e is None or o is None or not (isinstance(o,(int,float))) : diffs.append((path, "val", e, o)); return
        if (math.isnan(e) and math.isnan(o)): return
        if abs(e - o) > max(1e-6, 1e-6 * abs(e)): diffs.append((path, "val", e, o))
    else:
        n[0] += 1
        if e != o: diffs.append((path, "val", e, o))
walk(exp, obs, "")
print("compared leaf values:", n[0], "differences:", len(diffs))
for d in diffs[:80]: print(d)
json.dump(diffs, open(sys.argv[3], "w"), indent=1, default=str)
