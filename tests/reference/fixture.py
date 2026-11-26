"""Test-only Flagsmith fixture. Run through Django shell in the reference container."""

import base64
import json
import sys

from django.db import connection, transaction
from environments.models import Environment, EnvironmentAPIKey
from features.models import Feature, FeatureSegment, FeatureState
from organisations.models import Organisation
from projects.models import Project
from rest_framework.renderers import JSONRenderer
from segments.models import Condition, Segment, SegmentRule

sys.path.insert(0, "/verification")
from rollout_rehearsal.rehearsal import RehearsalError, fingerprint, parse_plan, rehearse


def seed():
    organisation = Organisation.objects.create(name="Reference rollout")
    project = Project.objects.create(name="Checkout", organisation=organisation)
    environment = Environment.objects.create(name="Reference checkout", project=project)
    feature = Feature.objects.create(name="new_checkout", project=project)
    segment = Segment.objects.create(name="Paid US customers", project=project)
    outer = SegmentRule.objects.create(segment=segment, type=SegmentRule.ALL_RULE)
    inner = SegmentRule.objects.create(rule=outer, type=SegmentRule.ALL_RULE)
    Condition.objects.create(rule=inner, property="plan", operator="EQUAL", value="paid")
    Condition.objects.create(rule=inner, property="country", operator="EQUAL", value="US")
    link = FeatureSegment.objects.create(
        segment=segment, feature=feature, environment=environment, priority=0
    )
    override = FeatureState.objects.create(
        feature=feature, environment=environment, feature_segment=link, enabled=True
    )
    override.feature_state_value.string_value = "redesigned"
    override.feature_state_value.save()
    key = EnvironmentAPIKey.objects.create(environment=environment, name="Reference probe")
    return {"environment_id": environment.pk, "server_key": key.key}


def perform(request):
    if request["action"] == "seed":
        return seed()

    # Every writer in this disposable fixture participates in the same lock.
    # Live installations need their own release system's revision guard.
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", [70121, request["environment_id"]])
        environment = Environment.objects.select_for_update().get(pk=request["environment_id"])
        if request["action"] == "drift":
            environment.name = "Reference checkout after drift"
            environment.save(update_fields=["name", "updated_at"])
            return {"status": "updated"}

        if request["action"] != "publish":
            raise ValueError("Unknown reference fixture action")
        if fingerprint(request["plan"]) != request["plan_sha256"]:
            return {"status": "blocked", "message": "Reviewed plan fingerprint changed"}
        edits, cases = parse_plan(request["plan"])
        if len(edits) != 1:
            raise ValueError("The reference publisher expects one rule edit")

        raw_document = Environment._get_environment_document_from_db(environment.api_key)
        document = json.loads(JSONRenderer().render(raw_document))
        try:
            report = rehearse(
                document, edits, cases, required_baseline=request["baseline_sha256"], summary_only=True
            )
        except RehearsalError as error:
            return {"status": "blocked", "message": str(error)}
        if report["summary"]["failed"]:
            return {"status": "blocked", "message": "Flag assertions failed"}

        edit = edits[0]
        current = Segment.live_objects.get(project=environment.project, name=edit.segment)
        for index in edit.path:
            current = list(current.rules.all())[index]
        current.type = edit.proposed_type
        current.save(update_fields=["type", "updated_at"])
        return {
            "status": "published", "baseline_sha256": report["baseline_sha256"],
            "plan_sha256": request["plan_sha256"],
        }


request = json.loads(base64.b64decode(REFERENCE_REQUEST))
print("REFERENCE_RESULT=" + json.dumps(perform(request)))
