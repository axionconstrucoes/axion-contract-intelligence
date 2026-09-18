import sys
import json
import re
import jpype
import mpxj

jpype.startJVM()

from org.mpxj.reader import UniversalProjectReader


def iso(value):
    if value is None:
        return None
    return str(value)


def numeric_duration(value):
    if value is None:
        return (None, None)

    text = str(value)
    match = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$", text)

    if not match:
        return (None, text)

    return (float(match.group(1)), match.group(2))


if len(sys.argv) != 3:
    print("Uso: python scripts/extract-mpp.py arquivo.mpp saida.json")
    sys.exit(1)

input_path = sys.argv[1]
output_path = sys.argv[2]

project = UniversalProjectReader().read(input_path)

activities = []
relations = []

for task in project.getTasks():
    if task is None or not task.getName():
        continue

    uid = str(task.getUniqueID())
    parent = task.getParentTask()

    duration_value, duration_unit = numeric_duration(task.getDuration())

    activities.append({
        "external_task_id": str(task.getID()) if task.getID() is not None else None,
        "unique_id": uid,
        "wbs": str(task.getWBS()) if task.getWBS() is not None else None,
        "outline_level": int(task.getOutlineLevel()) if task.getOutlineLevel() is not None else None,

        "name": str(task.getName()),

        "parent_unique_id": (
            str(parent.getUniqueID())
            if parent is not None
            else None
        ),

        "planned_start": iso(task.getStart()),
        "planned_end": iso(task.getFinish()),

        "duration_value": duration_value,
        "duration_unit": duration_unit,

        "percent_complete": (
            float(task.getPercentageComplete())
            if task.getPercentageComplete() is not None
            else None
        ),

        "is_milestone": bool(task.getMilestone()),
        "is_summary_task": bool(task.getSummary()),
        "is_critical": bool(task.getCritical()),
    })

    for rel in task.getPredecessors():
        predecessor = rel.getPredecessorTask()

        if predecessor is None:
            continue

        lag_value, lag_unit = numeric_duration(rel.getLag())

        relations.append({
            "predecessor_unique_id": str(predecessor.getUniqueID()),
            "successor_unique_id": uid,
            "relation_type": str(rel.getType()),
            "lag_value": lag_value,
            "lag_unit": lag_unit,
        })


result = {
    "source_file": input_path,
    "activity_count": len(activities),
    "relation_count": len(relations),
    "activities": activities,
    "relations": relations,
}

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("MPP_EXTRACTION_OK")
print("ATIVIDADES:", len(activities))
print("RELACOES:", len(relations))
print("JSON:", output_path)

jpype.shutdownJVM()