"""Provision the checkout sandbox and a bounded pool of private reviewer environments."""
import json

from django.db import transaction
from api_keys.models import MasterAPIKey
from environments.models import Environment
from features.models import Feature, FeatureState
from organisations.models import Organisation
from projects.models import Project


@transaction.atomic
def provision():
    organisation, _ = Organisation.objects.get_or_create(name="Rollback Rehearsal sandbox")
    project, _ = Project.objects.get_or_create(name="Checkout rehearsal", organisation=organisation)
    features = [
        Feature.objects.get_or_create(name=flag, project=project)[0]
        for flag in SCENARIO_FLAGS
    ]

    def scope(name):
        environment, _ = Environment.objects.get_or_create(name=name, project=project)
        states = {
            flag.name: FeatureState.objects.get_or_create(
                feature=flag, environment=environment, defaults={"enabled": False},
            )[0].pk
            for flag in features
        }
        return {"environmentKey": environment.api_key, "states": states}

    _, key = MasterAPIKey.objects.create_key(name="Local rehearsal runner", organisation=organisation)
    return {
        "version": 2,
        "managementKey": key,
        "default": scope("Sandbox"),
        "pool": [scope(f"Reviewer {index:02d}") for index in range(1, 21)],
    }


print("ROLLBACK_CONFIG=" + json.dumps(provision()))
